#!/usr/bin/env node
/**
 * run-paper.js — 페이퍼 정산 메인 파이프라인
 *
 * 웹 시스템 없이 엑셀 + PDF 증빙으로 정산검토하는 오케스트레이터.
 * Gemini CLI(gemini-3-pro-preview, 1M 컨텍스트)를 판정 엔진으로 사용.
 *
 * 사용법:
 *   node paper/run-paper.js \
 *     --excel=기관제출.xlsx \
 *     --evidence=evidence/ \
 *     --project=사업명 \
 *     --institution=기관명 \
 *     [--criteria=projects/사업명/criteria.md] \
 *     [--association=folder|filename] \
 *     [--batch-size=150] \
 *     [--dry-run]
 */
const fs = require('fs');
const path = require('path');
const { readPaperExcel } = require('./read-paper-excel');
const { associateEvidence } = require('./associate-evidence');
const { normalize } = require('../lib/normalize');
const { analyze: deepAnalyze, printSummary: printDeepSummary } = require('../lib/deep-analyze');
const { getConfig } = require('../lib/configs');
const { judgePaper } = require('./gemini-judge-paper');
const { writeJudgmentLog } = require('./write-judgment-log');

// ── CLI 파싱 ──
const args = Object.fromEntries(
  process.argv.slice(2)
    .filter(a => a.startsWith('--'))
    .map(a => {
      const [k, ...v] = a.slice(2).split('=');
      return [k, v.length ? v.join('=') : true];
    })
);

const EXCEL_PATH = args.excel;
const EVIDENCE_DIR = args.evidence;
const PROJECT = args.project || '';
const INSTITUTION = args.institution || '';
const CRITERIA_PATH = args.criteria;
const ASSOCIATION = args.association || 'folder';
const BATCH_SIZE = parseInt(args['batch-size']) || 150;
const DRY_RUN = !!args['dry-run'];

if (!EXCEL_PATH) {
  console.log('페이퍼 정산 파이프라인');
  console.log('');
  console.log('사용법:');
  console.log('  node paper/run-paper.js \\');
  console.log('    --excel=기관제출.xlsx \\');
  console.log('    --evidence=evidence/ \\');
  console.log('    --project=사업명 \\');
  console.log('    --institution=기관명 \\');
  console.log('    [--criteria=criteria.md] \\');
  console.log('    [--association=folder|filename] \\');
  console.log('    [--batch-size=150] \\');
  console.log('    [--dry-run]');
  console.log('');
  console.log('옵션:');
  console.log('  --excel          기관 제출 엑셀 파일 (필수)');
  console.log('  --evidence       증빙 PDF 폴더');
  console.log('  --project        사업 config 이름 (configs/index.js)');
  console.log('  --institution    기관명');
  console.log('  --criteria       판정 기준 파일 (.md)');
  console.log('  --association    증빙 연결 전략: folder (기본) 또는 filename');
  console.log('  --batch-size     Gemini 배치 크기 (기본: 150)');
  console.log('  --dry-run        판정 안 하고 data.json까지만');
  console.log('  --header-row     엑셀 헤더 행 번호 (자동감지 대신 수동 지정)');
  console.log('  --data-start     데이터 시작 행 번호');
  process.exit(1);
}

// ── 출력 디렉토리 결정 ──
const dirName = `${PROJECT || 'paper'}-${INSTITUTION || 'unknown'}`.replace(/[^가-힣a-zA-Z0-9_-]/g, '');
const OUT_DIR = path.join(__dirname, '..', 'projects', dirName);

async function main() {
  const t0 = Date.now();

  console.log('╔══════════════════════════════════════════════════╗');
  console.log(`║  페이퍼 정산: ${PROJECT || '-'} / ${INSTITUTION || '-'}`);
  console.log(`║  엑셀: ${EXCEL_PATH}`);
  console.log(`║  증빙: ${EVIDENCE_DIR || '(없음)'}`);
  console.log(`║  출력: ${OUT_DIR}`);
  console.log(`║  ${DRY_RUN ? 'DRY-RUN (판정 안 함)' : 'FULL (Gemini 판정 포함)'}`);
  console.log('╚══════════════════════════════════════════════════╝\n');

  fs.mkdirSync(OUT_DIR, { recursive: true });

  // ═══════ Phase 1: 엑셀 읽기 ═══════
  console.log('[Phase 1] 엑셀 읽기...');
  const readOptions = {};
  if (args['header-row']) readOptions.headerRow = parseInt(args['header-row']);
  if (args['data-start']) readOptions.dataStartRow = parseInt(args['data-start']);

  const { rows: rawRows, detectedMap, headerRow } = await readPaperExcel(EXCEL_PATH, readOptions);

  if (rawRows.length === 0) {
    console.error('  [오류] 엑셀에서 데이터를 읽지 못했습니다.');
    process.exit(1);
  }

  // ═══════ Phase 2: 증빙 연결 ═══════
  if (EVIDENCE_DIR) {
    console.log('\n[Phase 2] 증빙 연결...');
    await associateEvidence(rawRows, EVIDENCE_DIR, { strategy: ASSOCIATION });
  } else {
    console.log('\n[Phase 2] 증빙 디렉토리 미지정 — 스킵');
  }

  // ═══════ Phase 3: 정규화 ═══════
  console.log('\n[Phase 3] 정규화...');
  const config = getConfig(PROJECT || '페이퍼-템플릿', {
    system: 'paper',
    institutionName: INSTITUTION,
    evidenceStrategy: ASSOCIATION,
  });

  const normalized = normalize(rawRows, {
    source: 'paper',
    legalBasis: config.legalBasis || '보조금',
    project: PROJECT,
    institution: INSTITUTION,
  });
  console.log(`  ${normalized.length}건 정규화 완료`);

  // data.json 저장
  const dataFile = path.join(OUT_DIR, 'data.json');
  fs.writeFileSync(dataFile, JSON.stringify(normalized, null, 2), 'utf-8');
  console.log(`  저장: ${dataFile}`);

  // ═══════ Phase 4: 심층분석 ═══════
  console.log('\n[Phase 4] 심층분석...');
  const enriched = deepAnalyze(normalized, config);
  printDeepSummary(enriched);

  // data-enriched.json 저장
  const enrichedFile = path.join(OUT_DIR, 'data-enriched.json');
  fs.writeFileSync(enrichedFile, JSON.stringify(enriched, null, 2), 'utf-8');
  console.log(`  저장: ${enrichedFile}`);

  if (DRY_RUN) {
    const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
    console.log(`\n[DRY-RUN 완료] ${elapsed}s — Gemini 판정은 --dry-run 제거 후 재실행`);
    return;
  }

  // ═══════ Phase 5: Gemini 판정 ═══════
  console.log('\n[Phase 5] Gemini 판정...');

  // criteria 경로 결정
  let criteriaPath = CRITERIA_PATH;
  if (!criteriaPath) {
    // config에서 찾기
    criteriaPath = config.criteriaPath || config.guidelinesPath;
  }
  if (criteriaPath) {
    // criteria를 프로젝트 디렉토리에 복사
    const criteriaCopy = path.join(OUT_DIR, 'criteria.md');
    if (fs.existsSync(criteriaPath)) {
      fs.copyFileSync(criteriaPath, criteriaCopy);
      console.log(`  criteria 복사: ${criteriaPath} → ${criteriaCopy}`);
    }
  }

  const results = await judgePaper(enriched, {
    criteriaPath,
    project: PROJECT,
    institution: INSTITUTION,
    outDir: OUT_DIR,
    batchSize: BATCH_SIZE,
  });

  // ═══════ Phase 6: 판정로그 (제2원칙) ═══════
  console.log('\n[Phase 6] 판정로그 작성...');
  await writeJudgmentLog(enriched, results, {
    outDir: OUT_DIR,
    project: PROJECT,
    institution: INSTITUTION,
  });

  // ═══════ 최종 요약 ═══════
  const okCount = results.filter(r => r.status === '적정').length;
  const checkCount = results.filter(r => r.status === '확인').length;
  const skipCount = results.filter(r => r.status === 'SKIP').length;
  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);

  console.log('\n╔══════════════════════════════════════════════════╗');
  console.log(`║  페이퍼 정산 완료: ${PROJECT} / ${INSTITUTION}`);
  console.log(`║  총 ${results.length}건: 적정 ${okCount} / 확인 ${checkCount} / SKIP ${skipCount}`);
  console.log(`║  소요시간: ${elapsed}s`);
  console.log(`║  출력: ${OUT_DIR}`);
  console.log('╚══════════════════════════════════════════════════╝');
}

main().catch(err => {
  console.error('\n!! 파이프라인 오류 !!');
  console.error(err);
  process.exit(1);
});
