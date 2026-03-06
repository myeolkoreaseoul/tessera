#!/usr/bin/env node
/**
 * associate-evidence.js — 증빙 PDF/HWP ↔ 엑셀 행 연결
 *
 * 전략 2가지:
 *   folder:   evidence/1/, evidence/2/ ... (폴더명 = 행 번호)
 *   filename: evidence/001_세금계산서.pdf   (접두사 = 행 번호)
 *
 * 사용법:
 *   const { associateEvidence } = require('./associate-evidence');
 *   const enriched = await associateEvidence(rows, 'evidence/', { strategy: 'folder' });
 *
 *   CLI:
 *   node paper/associate-evidence.js --rows=data.json --dir=evidence/ [--strategy=folder]
 */
const fs = require('fs');
const path = require('path');
const { extractPdfText, extractHwpText, extractImageText, extractExcelText } = require('../lib/collect-generic');

const SUPPORTED_EXTS = ['.pdf', '.hwp', '.xlsx', '.xls', '.jpg', '.jpeg', '.png'];
const TEXT_CAP = 12000; // 파일당 텍스트 최대 길이

// 파일명에서 행 번호를 추출하는 기본 패턴
const DEFAULT_FILENAME_PATTERN = /^(?:순번|R|r|No\.?\s*)?0*(\d+)/;

/**
 * 파일에서 텍스트 추출 (확장자별 분기)
 */
async function extractText(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  let text = '';
  try {
    if (ext === '.pdf') text = await extractPdfText(filePath);
    else if (ext === '.hwp') text = extractHwpText(filePath);
    else if (ext === '.xlsx' || ext === '.xls') text = await extractExcelText(filePath);
    else if (['.jpg', '.jpeg', '.png'].includes(ext)) text = extractImageText(filePath);
  } catch (e) {
    console.warn(`    [WARN] 텍스트 추출 실패: ${path.basename(filePath)} — ${e.message}`);
  }
  return text.substring(0, TEXT_CAP);
}

/**
 * 디렉토리에서 지원 파일 목록 반환
 */
function listSupportedFiles(dirPath) {
  if (!fs.existsSync(dirPath)) return [];
  return fs.readdirSync(dirPath).filter(f => {
    const ext = path.extname(f).toLowerCase();
    return SUPPORTED_EXTS.includes(ext);
  });
}

/**
 * folder 전략: evidence/1/, evidence/r1/, evidence/01/ 등
 */
async function associateByFolder(rows, evidenceDir) {
  // 먼저 폴더 목록 스캔하여 행 번호 매핑
  const subdirs = fs.readdirSync(evidenceDir, { withFileTypes: true })
    .filter(d => d.isDirectory())
    .map(d => d.name);

  const folderMap = {}; // rowNum → folderPath
  for (const dir of subdirs) {
    const m = dir.match(/^(?:r|R)?0*(\d+)$/);
    if (m) folderMap[parseInt(m[1])] = path.join(evidenceDir, dir);
  }

  let matched = 0;
  let totalFiles = 0;

  for (const row of rows) {
    const folderPath = folderMap[row.rowNum];
    if (!folderPath) continue;

    const fileNames = listSupportedFiles(folderPath);
    if (fileNames.length === 0) continue;

    matched++;
    for (const fn of fileNames) {
      const fp = path.join(folderPath, fn);
      const text = await extractText(fp);
      row.files.push({ name: fn, text, path: fp });
      totalFiles++;
    }

    if (matched % 20 === 0) {
      console.log(`    [${matched}/${rows.length}] 증빙 연결 중...`);
    }
  }

  return { matched, totalFiles };
}

/**
 * filename 전략: 001_세금계산서.pdf → row 1
 */
async function associateByFilename(rows, evidenceDir, pattern) {
  const regex = pattern || DEFAULT_FILENAME_PATTERN;
  const fileNames = listSupportedFiles(evidenceDir);

  // 파일 → 행 번호 매핑
  const fileMap = {}; // rowNum → [filePath, ...]
  for (const fn of fileNames) {
    const m = fn.match(regex);
    if (m) {
      const rn = parseInt(m[1]);
      if (!fileMap[rn]) fileMap[rn] = [];
      fileMap[rn].push(path.join(evidenceDir, fn));
    }
  }

  let matched = 0;
  let totalFiles = 0;

  for (const row of rows) {
    const files = fileMap[row.rowNum];
    if (!files || files.length === 0) continue;

    matched++;
    for (const fp of files) {
      const text = await extractText(fp);
      row.files.push({ name: path.basename(fp), text, path: fp });
      totalFiles++;
    }
  }

  return { matched, totalFiles };
}

/**
 * 메인 함수: 증빙 연결
 */
async function associateEvidence(rows, evidenceDir, options = {}) {
  const strategy = options.strategy || 'folder';
  const pattern = options.pattern;

  if (!fs.existsSync(evidenceDir)) {
    console.warn(`  [경고] 증빙 디렉토리 없음: ${evidenceDir}`);
    return rows;
  }

  console.log(`  [증빙 연결] 전략: ${strategy}, 디렉토리: ${evidenceDir}`);

  let result;
  if (strategy === 'folder') {
    result = await associateByFolder(rows, evidenceDir);
  } else {
    result = await associateByFilename(rows, evidenceDir, pattern);
  }

  const noEvidence = rows.filter(r => r.files.length === 0).length;
  console.log(`  [증빙 연결 완료] ${result.matched}건 매칭, ${result.totalFiles}개 파일, 미매칭 ${noEvidence}건`);

  return rows;
}

module.exports = { associateEvidence, extractText };

// ── CLI ──
if (require.main === module) {
  const args = Object.fromEntries(
    process.argv.slice(2).filter(a => a.startsWith('--')).map(a => {
      const [k, ...v] = a.slice(2).split('=');
      return [k, v.length ? v.join('=') : true];
    })
  );

  const rowsFile = args.rows;
  const evidenceDir = args.dir;
  const strategy = args.strategy || 'folder';

  if (!rowsFile || !evidenceDir) {
    console.log('사용법: node paper/associate-evidence.js --rows=data.json --dir=evidence/ [--strategy=folder|filename]');
    process.exit(1);
  }

  const rows = JSON.parse(fs.readFileSync(rowsFile, 'utf-8'));
  associateEvidence(rows, evidenceDir, { strategy }).then(enriched => {
    const outFile = rowsFile.replace(/\.json$/, '-with-evidence.json');
    fs.writeFileSync(outFile, JSON.stringify(enriched, null, 2), 'utf-8');
    console.log(`저장: ${outFile}`);
  }).catch(console.error);
}
