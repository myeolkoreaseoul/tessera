#!/usr/bin/env node
/**
 * extract-metadata.js
 * data.json (또는 data-enriched.json)에서 메타데이터 + 파일명 + 심층분석 플래그 추출
 * 배치별로 분할하여 프롬프트 파일 생성
 *
 * 사용법:
 *   node extract-metadata.js --data=../기관명-data-enriched.json [--criteria=criteria-v3.md] [--batch=30]
 *   (인자 없으면 기존 하드코딩 경로 사용)
 */

const fs = require('fs');
const path = require('path');

const OUT_DIR = __dirname;

// CLI 인자 파싱
const args = Object.fromEntries(
  process.argv.slice(2).filter(a => a.startsWith('--')).map(a => {
    const [k, ...v] = a.slice(2).split('=');
    return [k, v.length ? v.join('=') : true];
  })
);

const BASE_DIR = path.resolve(__dirname, '..');
const DATA_FILE = args.data
  ? path.resolve(args.data)
  : path.join(BASE_DIR, '대구경북재단-data.json');
const CRITERIA_FILE = args.criteria || 'criteria-v3.md';
const BATCH_SIZE = parseInt(args.batch) || 30;

const promptFile = path.join(OUT_DIR, 'prompt-template.md');
const criteriaFile = path.join(OUT_DIR, CRITERIA_FILE);

const promptTemplate = fs.existsSync(promptFile)
  ? fs.readFileSync(promptFile, 'utf-8')
  : null;

const data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8'));
console.log(`Data: ${DATA_FILE} (${data.length} rows)`);

// Extract metadata (no OCR text, but include analysis flags if present)
const metadata = data.map(row => {
  const base = {
    rowNum: row.rowNum,
    purpose: row.purpose,
    budgetCategory: row.budgetCategory,
    subCategory: row.subCategory,
    totalAmount: row.totalAmount,
    supplyAmount: row.supplyAmount,
    vat: row.vat,
    vendorName: row.vendorName,
    evidenceType: row.evidenceType,
    evidenceSub: row.evidenceSub,
    reviewStatus: row.reviewStatus,
    fileCount: row.files ? row.files.length : 0,
    fileNames: row.files ? row.files.map(f => f.name) : [],
  };

  // enriched data의 analysis 플래그 포함
  if (row.analysis) {
    base.analysis = row.analysis;
  }

  return base;
});

// Save full metadata
fs.writeFileSync(
  path.join(OUT_DIR, 'metadata.json'),
  JSON.stringify(metadata, null, 2),
  'utf-8'
);
console.log(`Saved metadata.json (${metadata.length} rows)`);

// Split into batches and create prompt files
const totalBatches = Math.ceil(metadata.length / BATCH_SIZE);
for (let i = 0; i < totalBatches; i++) {
  const start = i * BATCH_SIZE;
  const end = Math.min(start + BATCH_SIZE, metadata.length);
  const batch = metadata.slice(start, end);

  // Save batch data
  fs.writeFileSync(
    path.join(OUT_DIR, `batch-${i + 1}.json`),
    JSON.stringify(batch, null, 2),
    'utf-8'
  );

  // Create prompt file with data embedded
  if (promptTemplate) {
    let prompt = promptTemplate.replace('{DATA}', JSON.stringify(batch, null, 2));
    // criteria 파일이 있으면 삽입
    if (fs.existsSync(criteriaFile) && prompt.includes('{CRITERIA}')) {
      prompt = prompt.replace('{CRITERIA}', fs.readFileSync(criteriaFile, 'utf-8'));
    }
    fs.writeFileSync(
      path.join(OUT_DIR, `batch-${i + 1}-prompt.txt`),
      prompt,
      'utf-8'
    );
  }

  console.log(`Batch ${i + 1}: R${batch[0].rowNum}-R${batch[batch.length - 1].rowNum} (${batch.length} rows)`);
}

console.log(`\nCreated ${totalBatches} batches of ${BATCH_SIZE} rows each`);
console.log(`Criteria: ${CRITERIA_FILE}`);
