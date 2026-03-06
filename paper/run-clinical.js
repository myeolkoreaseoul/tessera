#!/usr/bin/env node
/**
 * run-clinical.js — 사용자 임상평가 지원사업 전용 파이프라인
 *
 * 1. 엑셀 로드
 * 2. Smart Collector로 맥락 기반 증빙 수집
 * 3. 사용자임상평가 전용 룰 + Gemini 판정
 */
const fs = require('fs');
const path = require('path');
const { readPaperExcel } = require('./read-paper-excel');
const { scanAllFiles, findEvidence } = require('./smart-collector');
const { normalize } = require('../lib/normalize');
const { analyze } = require('../lib/deep-analyze');
const { judgePaper } = require('./gemini-judge-paper');
const { writeJudgmentLog } = require('./write-judgment-log');
const { writeResultToExcel } = require('./write-result-to-excel');

// CLI Arguments
const args = Object.fromEntries(process.argv.slice(2).map(a => a.split('=')));
const EXCEL_PATH = args['--excel'];
const ROOT_EVIDENCE_DIR = args['--evidence'];
const PROJECT = '사용자임상평가';
const INSTITUTION = args['--institution'] || 'Unknown';
const DRY_RUN = process.argv.includes('--dry-run');

if (!EXCEL_PATH || !ROOT_EVIDENCE_DIR) {
  console.log('Usage: node run-clinical.js --excel=... --evidence=... --institution=...');
  process.exit(1);
}

const OUT_DIR = path.join(__dirname, '..', 'projects', `${PROJECT}-${INSTITUTION}`.replace(/\s/g, '_'));

async function main() {
  console.log(`
🩺 [사용자 임상평가] 정산 파이프라인 시작: ${INSTITUTION}`);
  fs.mkdirSync(OUT_DIR, { recursive: true });

  // 1. 엑셀 읽기
  console.log(`
[1] 집행내역(엑셀) 로드: ${EXCEL_PATH}`);
  const { rows } = await readPaperExcel(EXCEL_PATH);
  console.log(`    -> ${rows.length}건 로드 완료`);

  // 2. 증빙 파일 스캐닝 (전체 인덱싱)
  console.log(`
[2] 증빙 폴더 인덱싱: ${ROOT_EVIDENCE_DIR}`);
  const allFiles = scanAllFiles(ROOT_EVIDENCE_DIR);
  console.log(`    -> 총 ${allFiles.length}개 파일 발견`);

  // 3. 지능형 매칭
  console.log(`
[3] 지능형 증빙 매칭 (Context-Aware Matching)...`);
  for (const row of rows) {
    const matches = await findEvidence(row, allFiles);
    row.files = matches; // [{name, path, text, score}, ...]
    if (matches.length > 0) {
      console.log(`    R${row.rowNum} [${row.subCategory}] ${row.amount.toLocaleString()}원 -> 파일 ${matches.length}개 매칭 (Top: ${matches[0].name}, Score: ${matches[0].score})`);
    } else {
      console.log(`    R${row.rowNum} [${row.subCategory}] ${row.amount.toLocaleString()}원 -> ❌ 매칭 실패`);
    }
  }

  // 4. 정규화
  const normalized = normalize(rows, {
    source: 'paper',
    project: PROJECT,
    institution: INSTITUTION,
    legalBasis: '보조금'
  });

  // 5. 심층 분석 (전용 룰 salary-check.js 적용)
  console.log(`
[4] 심층 분석 (인건비 세전/세후 등)...`);
  const config = {
    legalBasis: '보조금', // rules/보조금/common + rules/보조금/사용자임상평가 로드됨
    institutionName: INSTITUTION,
  };
  const enriched = analyze(normalized, config);

  // 저장
  fs.writeFileSync(path.join(OUT_DIR, 'data-enriched.json'), JSON.stringify(enriched, null, 2));

  if (DRY_RUN) {
    console.log(`
[DRY-RUN] 종료. 결과: ${path.join(OUT_DIR, 'data-enriched.json')}`);
    return;
  }

  // 6. Gemini 판정
  console.log(`
[5] Gemini 판정 (Criteria 적용)...`);
  const criteriaPath = path.join(__dirname, '..', 'guidelines/보조금/페이퍼정산/사용자임상평가.md');
  const results = await judgePaper(enriched, {
    criteriaPath,
    project: PROJECT,
    institution: INSTITUTION,
    outDir: OUT_DIR,
    batchSize: 50 // 배치 사이즈 조절
  });

  // 7. 로그 작성
  await writeJudgmentLog(enriched, results, { outDir: OUT_DIR, project: PROJECT, institution: INSTITUTION });
  
  // 8. 원본 엑셀 업데이트 (G/H열)
  console.log(`\n[6] 원본 엑셀 업데이트...`);
  await writeResultToExcel(EXCEL_PATH, results, enriched, { headerRow: 1 });

  console.log(`\n✅ 정산 완료.`);
}

main().catch(console.error);
