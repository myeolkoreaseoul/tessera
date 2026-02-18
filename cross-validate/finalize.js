#!/usr/bin/env node
/**
 * finalize.js
 * 교차검증 결과를 최종 results.json으로 변환
 * - 만장일치/다수결 항목: 자동 확정
 * - 전원불일치 항목: dispute-resolved.json에서 로드 (없으면 보수적으로 '확인')
 */

const fs = require('fs');
const path = require('path');

const BASE_DIR = path.resolve(__dirname, '..');
const CV_DIR = __dirname;

// Load comparison results
const comparison = JSON.parse(
  fs.readFileSync(path.join(CV_DIR, 'comparison.json'), 'utf-8')
);

// Load dispute resolutions if available
let disputeResolved = {};
const disputeFile = path.join(CV_DIR, 'dispute-resolved.json');
if (fs.existsSync(disputeFile)) {
  const data = JSON.parse(fs.readFileSync(disputeFile, 'utf-8'));
  if (Array.isArray(data)) {
    data.forEach(r => { disputeResolved[r.rowNum] = r; });
  }
  console.log(`Loaded ${Object.keys(disputeResolved).length} dispute resolutions`);
}

// Load metadata for type/amount info
const metadata = JSON.parse(
  fs.readFileSync(path.join(CV_DIR, 'metadata.json'), 'utf-8')
);
const metaMap = {};
metadata.forEach(m => { metaMap[m.rowNum] = m; });

// Build final results
const finalResults = [];

// 1. Unanimous items
comparison.unanimous.forEach(item => {
  const meta = metaMap[item.rowNum] || {};
  finalResults.push({
    rowNum: item.rowNum,
    type: meta.budgetCategory || '',
    amount: meta.totalAmount || 0,
    vendor: meta.vendorName || '',
    status: item.status,
    issues: [],
    source: 'unanimous',
    models: item.models.join(',')
  });
});

// 2. Majority items
comparison.majority.forEach(item => {
  const meta = metaMap[item.rowNum] || {};
  const minIssues = item.minority.length > 0 ?
    item.minority.map(m => `[${m.model}:${m.status}] ${m.issues.join(', ')}`).filter(Boolean) : [];

  finalResults.push({
    rowNum: item.rowNum,
    type: meta.budgetCategory || '',
    amount: meta.totalAmount || 0,
    vendor: meta.vendorName || '',
    status: item.majorityStatus,
    issues: item.majorityStatus === '확인' ?
      (item.minority.length > 0 && item.minority[0].issues.length > 0 ?
        item.minority[0].issues : ['다수결 확인']) : [],
    source: 'majority',
    models: item.majorityModels.join(',')
  });
});

// 3. Disputed items
comparison.disputed.forEach(item => {
  const meta = metaMap[item.rowNum] || {};
  const resolved = disputeResolved[item.rowNum];

  if (resolved) {
    finalResults.push({
      rowNum: item.rowNum,
      type: meta.budgetCategory || '',
      amount: meta.totalAmount || 0,
      vendor: meta.vendorName || '',
      status: resolved.status,
      issues: resolved.issues || [],
      source: 'dispute-resolved',
      reasoning: resolved.reasoning || ''
    });
  } else {
    // Default: conservative '확인'
    finalResults.push({
      rowNum: item.rowNum,
      type: meta.budgetCategory || '',
      amount: meta.totalAmount || 0,
      vendor: meta.vendorName || '',
      status: '확인',
      issues: ['전원불일치-보수적판정'],
      source: 'dispute-unresolved'
    });
  }
});

// 4. Missing items (data not available from enough models)
if (comparison.missing) {
  comparison.missing.forEach(item => {
    const meta = metaMap[item.rowNum] || {};
    // Use whatever is available
    const available = item.available || {};
    const status = Object.values(available)[0] || '확인';

    finalResults.push({
      rowNum: item.rowNum,
      type: meta.budgetCategory || '',
      amount: meta.totalAmount || 0,
      vendor: meta.vendorName || '',
      status,
      issues: ['일부모델누락'],
      source: 'partial'
    });
  });
}

// Sort by rowNum
finalResults.sort((a, b) => a.rowNum - b.rowNum);

// Verify completeness
const resultRows = new Set(finalResults.map(r => r.rowNum));
for (let i = 1; i <= 180; i++) {
  if (!resultRows.has(i)) {
    const meta = metaMap[i] || {};
    console.warn(`Missing R${i} - adding as 확인`);
    finalResults.push({
      rowNum: i,
      type: meta.budgetCategory || '',
      amount: meta.totalAmount || 0,
      vendor: meta.vendorName || '',
      status: '확인',
      issues: ['교차검증 데이터 없음'],
      source: 'missing'
    });
  }
}

finalResults.sort((a, b) => a.rowNum - b.rowNum);

// Save final results (review-generic.js format)
const reviewResults = finalResults.map(r => ({
  rowNum: r.rowNum,
  type: r.type,
  amount: r.amount,
  vendor: r.vendor,
  status: r.status,
  issues: r.issues
}));

const outputFile = path.join(BASE_DIR, '대구경북재단-results-final.json');
fs.writeFileSync(outputFile, JSON.stringify(reviewResults, null, 2), 'utf-8');

// Save detailed results with source info
fs.writeFileSync(
  path.join(CV_DIR, 'final-detailed.json'),
  JSON.stringify(finalResults, null, 2),
  'utf-8'
);

// Print summary
const stats = { 적정: 0, 확인: 0, SKIP: 0 };
reviewResults.forEach(r => {
  stats[r.status] = (stats[r.status] || 0) + 1;
});

const sourceStats = {};
finalResults.forEach(r => {
  sourceStats[r.source] = (sourceStats[r.source] || 0) + 1;
});

console.log('\n========================================');
console.log('  최종 교차검증 결과');
console.log('========================================\n');
console.log(`전체: ${reviewResults.length}건`);
console.log(`적정: ${stats['적정']}건`);
console.log(`확인: ${stats['확인']}건`);
console.log(`SKIP: ${stats['SKIP']}건`);
console.log('\n--- 판정 근거 ---');
Object.entries(sourceStats).forEach(([source, count]) => {
  console.log(`${source}: ${count}건`);
});
console.log(`\n저장: ${outputFile}`);

// Generate report
const report = `# 대구경북재단 교차검증 리포트

## 요약
- 전체: ${reviewResults.length}건
- 적정: ${stats['적정']}건 (${(stats['적정']/reviewResults.length*100).toFixed(1)}%)
- 확인: ${stats['확인']}건 (${(stats['확인']/reviewResults.length*100).toFixed(1)}%)
- SKIP: ${stats['SKIP']}건

## 판정 근거
${Object.entries(sourceStats).map(([s, c]) => `- ${s}: ${c}건`).join('\n')}

## 상세
| rowNum | 비목 | 금액 | 업체 | 판정 | 사유 | 근거 |
|--------|------|------|------|------|------|------|
${finalResults.map(r =>
  `| ${r.rowNum} | ${r.type} | ${r.amount.toLocaleString()} | ${r.vendor} | ${r.status} | ${r.issues.join('; ')} | ${r.source} |`
).join('\n')}
`;

fs.writeFileSync(path.join(CV_DIR, 'report.md'), report, 'utf-8');
console.log('리포트 저장: cross-validate/report.md');
