#!/usr/bin/env node
/**
 * parse-results.js
 * 각 모델의 원시 출력에서 JSON 배열을 추출하여 정규화된 파일로 저장
 */

const fs = require('fs');
const path = require('path');

const OUT_DIR = __dirname;
const MODELS = ['claude', 'gemini', 'codex'];
const BATCHES = 6;

function isResultArray(arr) {
  // Check if array contains result items (with "status" field)
  return arr.length > 0 && arr[0] && (arr[0].status || arr[0].judgment || arr[0].result);
}

function extractJSON(text) {
  // Try direct parse first
  try {
    const parsed = JSON.parse(text.trim());
    if (Array.isArray(parsed) && isResultArray(parsed)) return parsed;
  } catch (e) {}

  // Collect all valid result arrays found
  const candidates = [];

  // Try to find JSON array in code blocks
  const codeBlockPattern = /```(?:json)?\s*\n?([\s\S]*?)\n?```/g;
  let match;
  while ((match = codeBlockPattern.exec(text)) !== null) {
    try {
      const parsed = JSON.parse(match[1].trim());
      if (Array.isArray(parsed) && isResultArray(parsed)) candidates.push(parsed);
    } catch (e) {}
  }

  // Try line-by-line to find JSON arrays with "status" field
  const lines = text.split('\n');
  let start = -1, depth = 0, jsonLines = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (start === -1 && line.trim().startsWith('[')) {
      start = i;
      depth = 0;
      jsonLines = [];
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
          if (Array.isArray(parsed) && isResultArray(parsed)) {
            candidates.push(parsed);
          }
        } catch (e) {}
        start = -1;
        jsonLines = [];
      }
    }
  }

  // Return the last valid result array (most likely the final response)
  if (candidates.length > 0) {
    return candidates[candidates.length - 1];
  }

  return null;
}

function normalizeResult(item) {
  return {
    rowNum: item.rowNum || item.row_num || item.row,
    status: item.status || item.judgment || item.result,
    issues: item.issues || item.reasons || item.reason ?
      (Array.isArray(item.issues) ? item.issues :
       Array.isArray(item.reasons) ? item.reasons :
       item.reason ? [item.reason] : []) : [],
    confidence: item.confidence || 'medium'
  };
}

const results = {};
let totalParsed = 0;
let totalFailed = 0;

for (const model of MODELS) {
  results[model] = [];

  for (let b = 1; b <= BATCHES; b++) {
    const rawFile = path.join(OUT_DIR, `${model}-batch-${b}-raw.txt`);
    const jsonFile = path.join(OUT_DIR, `${model}-batch-${b}.json`);

    // Check if already parsed JSON exists
    if (fs.existsSync(jsonFile)) {
      try {
        const data = JSON.parse(fs.readFileSync(jsonFile, 'utf-8'));
        if (Array.isArray(data) && data.length > 0) {
          results[model].push(...data.map(normalizeResult));
          console.log(`${model} batch ${b}: loaded ${data.length} items from JSON`);
          totalParsed += data.length;
          continue;
        }
      } catch (e) {}
    }

    // Parse raw output
    if (fs.existsSync(rawFile)) {
      const raw = fs.readFileSync(rawFile, 'utf-8');
      const parsed = extractJSON(raw);

      if (parsed && parsed.length > 0) {
        const normalized = parsed.map(normalizeResult);
        results[model].push(...normalized);

        // Save parsed result
        fs.writeFileSync(jsonFile, JSON.stringify(normalized, null, 2), 'utf-8');
        console.log(`${model} batch ${b}: parsed ${normalized.length} items from raw`);
        totalParsed += normalized.length;
      } else {
        console.error(`${model} batch ${b}: FAILED to parse (raw file ${raw.length} bytes)`);
        totalFailed++;
      }
    } else {
      console.error(`${model} batch ${b}: no file found`);
      totalFailed++;
    }
  }

  console.log(`${model} total: ${results[model].length} items\n`);
}

// Save combined results per model
for (const model of MODELS) {
  fs.writeFileSync(
    path.join(OUT_DIR, `${model}-all.json`),
    JSON.stringify(results[model], null, 2),
    'utf-8'
  );
}

console.log(`\n=== Summary ===`);
console.log(`Total parsed: ${totalParsed}`);
console.log(`Total failed: ${totalFailed}`);

for (const model of MODELS) {
  const stats = { 적정: 0, 확인: 0, SKIP: 0 };
  results[model].forEach(r => {
    stats[r.status] = (stats[r.status] || 0) + 1;
  });
  console.log(`${model}: ${results[model].length} items - 적정:${stats['적정']} 확인:${stats['확인']} SKIP:${stats['SKIP']}`);
}
