#!/usr/bin/env node
/**
 * v4-parse-and-merge.js
 * v4 교차검증: gemini/codex raw 파싱 + 4모델 머지 + 비교 + finalize
 */

const fs = require('fs');
const path = require('path');

const DIR = __dirname;
const MODELS = ['sonnet', 'opus', 'gemini', 'codex'];
const BATCHES = 6;

// --- extractJSON from parse-results.js ---
function isResultArray(arr) {
  return arr.length > 0 && arr[0] && (arr[0].status || arr[0].judgment || arr[0].result);
}

function extractJSON(text) {
  try {
    const parsed = JSON.parse(text.trim());
    if (Array.isArray(parsed) && isResultArray(parsed)) return parsed;
  } catch (e) {}

  const candidates = [];
  const codeBlockPattern = /```(?:json)?\s*\n?([\s\S]*?)\n?```/g;
  let match;
  while ((match = codeBlockPattern.exec(text)) !== null) {
    try {
      const parsed = JSON.parse(match[1].trim());
      if (Array.isArray(parsed) && isResultArray(parsed)) candidates.push(parsed);
    } catch (e) {}
  }

  const lines = text.split('\n');
  let start = -1, depth = 0, jsonLines = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (start === -1 && line.trim().startsWith('[')) {
      start = i; depth = 0; jsonLines = [];
    }
    if (start !== -1) {
      jsonLines.push(line);
      for (const ch of line) {
        if (ch === '[') depth++;
        if (ch === ']') depth--;
      }
      if (depth === 0 && jsonLines.length > 0) {
        try {
          const parsed = JSON.parse(jsonLines.join('\n'));
          if (Array.isArray(parsed) && isResultArray(parsed)) candidates.push(parsed);
        } catch (e) {}
        start = -1; jsonLines = [];
      }
    }
  }
  return candidates.length > 0 ? candidates[candidates.length - 1] : null;
}

function normalizeResult(item) {
  return {
    rowNum: item.rowNum || item.row_num || item.row,
    status: item.status || item.judgment || item.result,
    issues: Array.isArray(item.issues) ? item.issues :
            Array.isArray(item.reasons) ? item.reasons :
            item.reason ? [item.reason] : [],
    confidence: item.confidence || 'medium'
  };
}

// --- Phase 1: Parse raw → JSON (gemini, codex only; sonnet/opus already have JSON) ---
console.log('=== Phase 1: Parse raw → JSON ===');
for (const model of ['gemini', 'codex']) {
  for (let b = 1; b <= BATCHES; b++) {
    const rawFile = path.join(DIR, `v4-${model}-batch-${b}-raw.txt`);
    const jsonFile = path.join(DIR, `v4-${model}-batch-${b}.json`);

    if (fs.existsSync(jsonFile)) {
      try {
        const data = JSON.parse(fs.readFileSync(jsonFile, 'utf-8'));
        if (Array.isArray(data) && data.length > 0) {
          console.log(`  ${model} batch ${b}: already parsed (${data.length} items)`);
          continue;
        }
      } catch (e) {}
    }

    if (!fs.existsSync(rawFile)) {
      console.error(`  ${model} batch ${b}: raw file missing!`);
      continue;
    }

    const raw = fs.readFileSync(rawFile, 'utf-8');
    if (raw.length === 0) {
      console.error(`  ${model} batch ${b}: raw file is EMPTY (0 bytes)!`);
      continue;
    }

    const parsed = extractJSON(raw);
    if (parsed && parsed.length > 0) {
      const normalized = parsed.map(normalizeResult);
      fs.writeFileSync(jsonFile, JSON.stringify(normalized, null, 2), 'utf-8');
      console.log(`  ${model} batch ${b}: parsed ${normalized.length} items`);
    } else {
      console.error(`  ${model} batch ${b}: FAILED to parse (${raw.length} bytes)`);
    }
  }
}

// --- Phase 2: Merge all batches per model → v4-{model}-all.json ---
console.log('\n=== Phase 2: Merge batches → all.json ===');
const allResults = {};

for (const model of MODELS) {
  allResults[model] = {};
  let total = 0;

  for (let b = 1; b <= BATCHES; b++) {
    const jsonFile = path.join(DIR, `v4-${model}-batch-${b}.json`);
    if (!fs.existsSync(jsonFile)) {
      console.error(`  ${model} batch ${b}: JSON missing!`);
      continue;
    }
    const data = JSON.parse(fs.readFileSync(jsonFile, 'utf-8'));
    data.forEach(r => {
      const norm = normalizeResult(r);
      allResults[model][norm.rowNum] = norm;
      total++;
    });
  }

  // Save merged
  const merged = Object.values(allResults[model]).sort((a, b) => a.rowNum - b.rowNum);
  fs.writeFileSync(path.join(DIR, `v4-${model}-all.json`), JSON.stringify(merged, null, 2), 'utf-8');
  console.log(`  ${model}: ${merged.length} items merged`);
}

// --- Phase 3: Cross-validate comparison ---
console.log('\n=== Phase 3: 4모델 교차검증 비교 ===');

const allRows = new Set();
for (const model of MODELS) {
  Object.keys(allResults[model]).forEach(r => allRows.add(parseInt(r)));
}
const sortedRows = [...allRows].sort((a, b) => a - b);

const comparison = { unanimous: [], majority: [], disputed: [], missing: [] };
const stats = {
  total: sortedRows.length, unanimous: 0, majority: 0, disputed: 0, missing: 0,
  finalStatus: { '적정': 0, '확인': 0, 'SKIP': 0 }
};

const modelStats = {};
MODELS.forEach(m => { modelStats[m] = { '적정': 0, '확인': 0, 'SKIP': 0, missing: 0 }; });

for (const rowNum of sortedRows) {
  const verdicts = {};
  const details = {};
  const missingModels = [];

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
    comparison.missing.push({ rowNum, missingModels, available: verdicts });
    stats.missing++;
    continue;
  }

  const statusValues = availableModels.map(m => verdicts[m]);
  const uniqueStatuses = [...new Set(statusValues)];

  if (uniqueStatuses.length === 1) {
    comparison.unanimous.push({
      rowNum, status: uniqueStatuses[0],
      models: availableModels,
      confidence: availableModels.map(m => details[m].confidence)
    });
    stats.unanimous++;
    stats.finalStatus[uniqueStatuses[0]] = (stats.finalStatus[uniqueStatuses[0]] || 0) + 1;
  } else {
    // Count votes
    const voteCounts = {};
    availableModels.forEach(m => {
      const s = verdicts[m];
      voteCounts[s] = voteCounts[s] || [];
      voteCounts[s].push(m);
    });

    // Find majority (3+ or 2+ with 4 models)
    let majorityStatus = null, majorityModels = [], minorityEntries = [];
    for (const [status, models] of Object.entries(voteCounts)) {
      if (models.length >= 3 || (models.length >= 2 && availableModels.length <= 3)) {
        majorityStatus = status;
        majorityModels = models;
      }
    }

    if (!majorityStatus) {
      // For 4 models, 2:2 split or 2:1:1 — find the 2-vote status
      for (const [status, models] of Object.entries(voteCounts)) {
        if (models.length >= 2) {
          majorityStatus = status;
          majorityModels = models;
          break;
        }
      }
    }

    if (majorityStatus) {
      for (const [status, models] of Object.entries(voteCounts)) {
        if (status !== majorityStatus) {
          models.forEach(m => {
            minorityEntries.push({
              model: m, status,
              issues: details[m].issues,
              confidence: details[m].confidence
            });
          });
        }
      }
      comparison.majority.push({
        rowNum, majorityStatus, majorityModels, minority: minorityEntries,
        allVerdicts: verdicts
      });
      stats.majority++;
      stats.finalStatus[majorityStatus] = (stats.finalStatus[majorityStatus] || 0) + 1;
    } else {
      comparison.disputed.push({
        rowNum, verdicts,
        details: Object.fromEntries(availableModels.map(m => [m, {
          status: details[m].status, issues: details[m].issues, confidence: details[m].confidence
        }]))
      });
      stats.disputed++;
    }
  }
}

fs.writeFileSync(path.join(DIR, 'v4-comparison.json'), JSON.stringify(comparison, null, 2), 'utf-8');

// --- Phase 4: Finalize → results JSON ---
console.log('\n=== Phase 4: Finalize ===');

const metaFile = path.join(DIR, 'metadata.json');
const metaMap = {};
if (fs.existsSync(metaFile)) {
  JSON.parse(fs.readFileSync(metaFile, 'utf-8')).forEach(m => { metaMap[m.rowNum] = m; });
}

const finalResults = [];

comparison.unanimous.forEach(item => {
  const meta = metaMap[item.rowNum] || {};
  finalResults.push({
    rowNum: item.rowNum, type: meta.budgetCategory || '', amount: meta.totalAmount || 0,
    vendor: meta.vendorName || '', status: item.status, issues: [],
    source: 'unanimous', models: item.models.join(',')
  });
});

comparison.majority.forEach(item => {
  const meta = metaMap[item.rowNum] || {};
  // Collect issues from majority models that say 확인
  let issues = [];
  if (item.majorityStatus === '확인') {
    const confirmModels = item.majorityModels;
    for (const m of confirmModels) {
      const d = allResults[m][item.rowNum];
      if (d && d.issues && d.issues.length > 0) { issues = d.issues; break; }
    }
    if (issues.length === 0) {
      for (const min of item.minority) {
        if (min.issues && min.issues.length > 0) { issues = min.issues; break; }
      }
    }
    if (issues.length === 0) issues = ['다수결 확인'];
  }
  finalResults.push({
    rowNum: item.rowNum, type: meta.budgetCategory || '', amount: meta.totalAmount || 0,
    vendor: meta.vendorName || '', status: item.majorityStatus, issues,
    source: 'majority', models: item.majorityModels.join(',')
  });
});

comparison.disputed.forEach(item => {
  const meta = metaMap[item.rowNum] || {};
  finalResults.push({
    rowNum: item.rowNum, type: meta.budgetCategory || '', amount: meta.totalAmount || 0,
    vendor: meta.vendorName || '', status: '확인', issues: ['전원불일치-보수적판정'],
    source: 'dispute-unresolved'
  });
});

if (comparison.missing) {
  comparison.missing.forEach(item => {
    const meta = metaMap[item.rowNum] || {};
    const status = Object.values(item.available)[0] || '확인';
    finalResults.push({
      rowNum: item.rowNum, type: meta.budgetCategory || '', amount: meta.totalAmount || 0,
      vendor: meta.vendorName || '', status, issues: ['일부모델누락'], source: 'partial'
    });
  });
}

// Fill gaps (1~180)
const resultRows = new Set(finalResults.map(r => r.rowNum));
for (let i = 1; i <= 180; i++) {
  if (!resultRows.has(i)) {
    const meta = metaMap[i] || {};
    console.warn(`  Missing R${i} - adding as 확인`);
    finalResults.push({
      rowNum: i, type: meta.budgetCategory || '', amount: meta.totalAmount || 0,
      vendor: meta.vendorName || '', status: '확인', issues: ['교차검증 데이터 없음'], source: 'missing'
    });
  }
}

finalResults.sort((a, b) => a.rowNum - b.rowNum);

// Save
const BASE_DIR = path.resolve(DIR, '..');
const outputFile = path.join(BASE_DIR, '대구경북재단-results-v4.json');
const reviewResults = finalResults.map(r => ({
  rowNum: r.rowNum, type: r.type, amount: r.amount, vendor: r.vendor,
  status: r.status, issues: r.issues
}));
fs.writeFileSync(outputFile, JSON.stringify(reviewResults, null, 2), 'utf-8');
fs.writeFileSync(path.join(DIR, 'v4-final-detailed.json'), JSON.stringify(finalResults, null, 2), 'utf-8');

// --- Print Report ---
const finalStats = { '적정': 0, '확인': 0, 'SKIP': 0 };
reviewResults.forEach(r => { finalStats[r.status] = (finalStats[r.status] || 0) + 1; });

const sourceStats = {};
finalResults.forEach(r => { sourceStats[r.source] = (sourceStats[r.source] || 0) + 1; });

console.log('\n========================================');
console.log('  v4 4모델 교차검증 결과');
console.log('========================================\n');
console.log(`전체 행 수: ${sortedRows.length}건`);
console.log(`만장일치: ${stats.unanimous}건 (${(stats.unanimous / stats.total * 100).toFixed(1)}%)`);
console.log(`다수결: ${stats.majority}건 (${(stats.majority / stats.total * 100).toFixed(1)}%)`);
console.log(`전원불일치: ${stats.disputed}건 (${(stats.disputed / stats.total * 100).toFixed(1)}%)`);
if (stats.missing > 0) console.log(`데이터부족: ${stats.missing}건`);

console.log('\n--- 최종 판정 ---');
console.log(`적정: ${finalStats['적정']}건`);
console.log(`확인: ${finalStats['확인']}건`);
console.log(`SKIP: ${finalStats['SKIP']}건`);

console.log('\n--- 판정 근거 ---');
Object.entries(sourceStats).forEach(([s, c]) => console.log(`  ${s}: ${c}건`));

console.log('\n--- 모델별 성향 ---');
for (const model of MODELS) {
  const ms = modelStats[model];
  const total = ms['적정'] + ms['확인'] + ms['SKIP'];
  console.log(`  ${model}: 적정 ${ms['적정']}(${total ? (ms['적정'] / total * 100).toFixed(0) : 0}%) / 확인 ${ms['확인']}(${total ? (ms['확인'] / total * 100).toFixed(0) : 0}%) / SKIP ${ms['SKIP']} / 누락 ${ms.missing}`);
}

if (comparison.disputed.length > 0) {
  console.log('\n--- 전원불일치 항목 ---');
  comparison.disputed.forEach(d => {
    const parts = Object.entries(d.verdicts).map(([m, s]) => `${m}:${s}`);
    console.log(`  R${d.rowNum}: ${parts.join(' / ')}`);
  });
}

console.log(`\n결과 저장: ${outputFile}`);
console.log(`상세 저장: cross-validate/v4-final-detailed.json`);
