#!/usr/bin/env node
/**
 * compare.js
 * 3자 교차검증 비교 — Claude, Gemini, Codex 판정 결과 비교
 */

const fs = require('fs');
const path = require('path');

const OUT_DIR = __dirname;
const MODELS = ['claude', 'gemini', 'codex'];

// Load all results
const allResults = {};
for (const model of MODELS) {
  const file = path.join(OUT_DIR, `${model}-all.json`);
  if (!fs.existsSync(file)) {
    console.error(`Missing: ${file}`);
    process.exit(1);
  }
  const data = JSON.parse(fs.readFileSync(file, 'utf-8'));
  allResults[model] = {};
  data.forEach(r => {
    allResults[model][r.rowNum] = r;
  });
}

// Get all row numbers
const allRows = new Set();
for (const model of MODELS) {
  Object.keys(allResults[model]).forEach(r => allRows.add(parseInt(r)));
}
const sortedRows = [...allRows].sort((a, b) => a - b);

console.log(`Total rows to compare: ${sortedRows.length}`);

const comparison = {
  unanimous: [],
  majority: [],
  disputed: [],
  missing: []
};

const stats = {
  total: sortedRows.length,
  unanimous: 0,
  majority: 0,
  disputed: 0,
  missing: 0,
  finalStatus: { 적정: 0, 확인: 0, SKIP: 0 }
};

const modelStats = {};
MODELS.forEach(m => {
  modelStats[m] = { 적정: 0, 확인: 0, SKIP: 0, missing: 0 };
});

for (const rowNum of sortedRows) {
  const verdicts = {};
  const details = {};
  let missingModels = [];

  for (const model of MODELS) {
    const r = allResults[model][rowNum];
    if (r) {
      verdicts[model] = r.status;
      details[model] = r;
      modelStats[model][r.status] = (modelStats[model][r.status] || 0) + 1;
    } else {
      missingModels.push(model);
      modelStats[model].missing++;
    }
  }

  const availableModels = MODELS.filter(m => verdicts[m]);

  if (availableModels.length < 2) {
    // Not enough data
    comparison.missing.push({ rowNum, missingModels, available: verdicts });
    stats.missing++;
    continue;
  }

  const statusValues = availableModels.map(m => verdicts[m]);
  const uniqueStatuses = [...new Set(statusValues)];

  if (uniqueStatuses.length === 1) {
    // Unanimous (all available agree)
    const status = uniqueStatuses[0];
    comparison.unanimous.push({
      rowNum,
      status,
      models: availableModels,
      confidence: availableModels.map(m => details[m].confidence)
    });
    stats.unanimous++;
    stats.finalStatus[status] = (stats.finalStatus[status] || 0) + 1;
  } else {
    // Count votes
    const voteCounts = {};
    availableModels.forEach(m => {
      const s = verdicts[m];
      voteCounts[s] = (voteCounts[s] || []);
      voteCounts[s].push(m);
    });

    // Find majority
    let majorityStatus = null;
    let majorityModels = [];
    let minorityEntries = [];

    for (const [status, models] of Object.entries(voteCounts)) {
      if (models.length >= 2) {
        majorityStatus = status;
        majorityModels = models;
      } else {
        models.forEach(m => {
          minorityEntries.push({
            model: m,
            status,
            issues: details[m].issues,
            confidence: details[m].confidence
          });
        });
      }
    }

    if (majorityStatus) {
      // 2:1 majority
      comparison.majority.push({
        rowNum,
        majorityStatus,
        majorityModels,
        minority: minorityEntries,
        allVerdicts: verdicts
      });
      stats.majority++;
      stats.finalStatus[majorityStatus] = (stats.finalStatus[majorityStatus] || 0) + 1;
    } else {
      // All different (disputed)
      comparison.disputed.push({
        rowNum,
        verdicts,
        details: Object.fromEntries(
          availableModels.map(m => [m, {
            status: details[m].status,
            issues: details[m].issues,
            confidence: details[m].confidence
          }])
        )
      });
      stats.disputed++;
      // Disputed items will be resolved in Phase 4
    }
  }
}

// Save comparison
fs.writeFileSync(
  path.join(OUT_DIR, 'comparison.json'),
  JSON.stringify(comparison, null, 2),
  'utf-8'
);

// Print report
console.log('\n========================================');
console.log('  3자 교차검증 비교 결과');
console.log('========================================\n');
console.log(`전체 항목: ${stats.total}건`);
console.log(`만장일치: ${stats.unanimous}건 (${(stats.unanimous/stats.total*100).toFixed(1)}%)`);
console.log(`다수결(2:1): ${stats.majority}건 (${(stats.majority/stats.total*100).toFixed(1)}%)`);
console.log(`전원불일치: ${stats.disputed}건 (${(stats.disputed/stats.total*100).toFixed(1)}%)`);
if (stats.missing > 0) {
  console.log(`데이터 부족: ${stats.missing}건`);
}

console.log('\n--- 최종 판정 (확정 항목) ---');
console.log(`적정: ${stats.finalStatus['적정']}건`);
console.log(`확인: ${stats.finalStatus['확인']}건`);
console.log(`SKIP: ${stats.finalStatus['SKIP']}건`);
console.log(`미확정(전원불일치): ${stats.disputed}건`);

console.log('\n--- 모델별 성향 ---');
for (const model of MODELS) {
  const ms = modelStats[model];
  const total = ms['적정'] + ms['확인'] + ms['SKIP'];
  console.log(`${model}: 적정 ${ms['적정']}(${total ? (ms['적정']/total*100).toFixed(0) : 0}%) / 확인 ${ms['확인']}(${total ? (ms['확인']/total*100).toFixed(0) : 0}%) / SKIP ${ms['SKIP']} / 누락 ${ms.missing}`);
}

// Print majority details
if (comparison.majority.length > 0) {
  console.log('\n--- 다수결 불일치 상세 (상위 10건) ---');
  comparison.majority.slice(0, 10).forEach(m => {
    const min = m.minority[0];
    console.log(`R${m.rowNum}: ${m.majorityStatus}(${m.majorityModels.join(',')}) vs ${min.status}(${min.model}) - ${min.issues.join(', ') || 'no issues'}`);
  });
}

if (comparison.disputed.length > 0) {
  console.log('\n--- 전원불일치 항목 ---');
  comparison.disputed.forEach(d => {
    const parts = Object.entries(d.verdicts).map(([m, s]) => `${m}:${s}`);
    console.log(`R${d.rowNum}: ${parts.join(' / ')}`);
  });
}

console.log('\n비교 결과 저장: comparison.json');
