/**
 * deep-analyze.js — 심층분석 엔진 (플러그인 아키텍처)
 *
 * 규칙은 rules/ 디렉토리에서 자동 로드.
 * 새 규칙 발견 시 파일 1개 추가하면 자동 적용 — 엔진 코드 수정 불필요.
 *
 * 사용법:
 *   const { analyze } = require('./deep-analyze');
 *   const enriched = analyze(data, config);
 *
 *   CLI:
 *   node lib/deep-analyze.js --data=xxx-data.json --config=디지털헬스케어
 *
 * 규칙 파일 구조:
 *   module.exports = {
 *     id: 'rule-id',
 *     name: '한글 설명',
 *     scope: 'common' | '보조금' | '혁신법',
 *     phase: 'cross-row' | 'per-row',
 *     analyze(rows, config) { return Map<rowNum, {flags, fields}> }
 *   };
 */
const fs = require('fs');
const path = require('path');

// ── 규칙 자동 로드 ──

function loadRulesRecursive(dir) {
  let rules = [];
  if (!fs.existsSync(dir)) return rules;
  
  const items = fs.readdirSync(dir, { withFileTypes: true });
  for (const item of items) {
    const fullPath = path.join(dir, item.name);
    if (item.isDirectory()) {
      rules = rules.concat(loadRulesRecursive(fullPath));
    } else if (item.isFile() && item.name.endsWith('.js')) {
      try {
        rules.push(require(fullPath));
      } catch (e) {
        console.error(`[deep-analyze] Failed to load rule: ${fullPath}`, e.message);
      }
    }
  }
  return rules;
}

function loadRules(legalBasis) {
  const rulesDir = path.join(__dirname, 'rules');
  let rules = [];

  // 1) common/ — 모든 정산 공통
  rules = rules.concat(loadRulesRecursive(path.join(rulesDir, 'common')));

  // 2) 법령별 (보조금/ 또는 혁신법/)
  if (legalBasis) {
    rules = rules.concat(loadRulesRecursive(path.join(rulesDir, legalBasis)));
  }

  return rules;
}

// ── 메인 분석 ──

function analyze(data, config = {}) {
  const { legalBasis = '보조금' } = config;
  const rules = loadRules(legalBasis);

  // 각 row에 analysis 필드 초기화
  const analysisMap = {};  // rowNum → { flags: [], fields: {} }
  for (const row of data) {
    analysisMap[row.rowNum] = { flags: [], fields: {} };
  }

  // Phase 1: cross-row 규칙 (행 간 교차분석 — 순서 중요하므로 순차 실행)
  for (const rule of rules.filter(r => r.phase === 'cross-row')) {
    try {
      const results = rule.analyze(data, config);
      if (results) {
        for (const [rowNum, result] of Object.entries(results)) {
          const rn = parseInt(rowNum);
          if (!analysisMap[rn]) continue;
          if (result.flags) analysisMap[rn].flags.push(...result.flags);
          if (result.fields) Object.assign(analysisMap[rn].fields, result.fields);
        }
      }
    } catch (e) {
      console.error(`[deep-analyze] Rule "${rule.id}" error:`, e.message);
    }
  }

  // Phase 2: per-row 규칙 (단건 분석 — 병렬 가능)
  for (const row of data) {
    for (const rule of rules.filter(r => r.phase === 'per-row')) {
      try {
        const result = rule.analyze(row, config);
        if (result) {
          if (result.flags) analysisMap[row.rowNum].flags.push(...result.flags);
          if (result.fields) Object.assign(analysisMap[row.rowNum].fields, result.fields);
        }
      } catch (e) {
        console.error(`[deep-analyze] Rule "${rule.id}" R${row.rowNum} error:`, e.message);
      }
    }
  }

  // enriched data 생성
  return data.map(row => ({
    ...row,
    analysis: analysisMap[row.rowNum],
  }));
}

// ── 요약 출력 ──

function printSummary(enrichedData) {
  const flagCounts = {};
  let flaggedRows = 0;

  for (const row of enrichedData) {
    const flags = row.analysis?.flags || [];
    if (flags.length > 0) flaggedRows++;
    for (const f of flags) {
      flagCounts[f] = (flagCounts[f] || 0) + 1;
    }
  }

  console.log('\n━━━━ 심층분석 결과 ━━━━');
  console.log(`총 ${enrichedData.length}건 중 ${flaggedRows}건 플래그\n`);

  for (const [flag, count] of Object.entries(flagCounts).sort((a, b) => b[1] - a[1])) {
    const rows = enrichedData
      .filter(r => (r.analysis?.flags || []).includes(flag))
      .map(r => 'R' + r.rowNum);
    console.log(`  [${count}건] ${flag}`);
    if (rows.length <= 10) console.log(`        → ${rows.join(', ')}`);
    else console.log(`        → ${rows.slice(0, 8).join(', ')} 외 ${rows.length - 8}건`);
  }
  console.log('');
}

module.exports = { analyze, loadRules, printSummary };

// ── CLI ──
if (require.main === module) {
  const args = Object.fromEntries(
    process.argv.slice(2).filter(a => a.startsWith('--')).map(a => {
      const [k, ...v] = a.slice(2).split('=');
      return [k, v.length ? v.join('=') : true];
    })
  );

  const dataFile = args.data;
  if (!dataFile) {
    console.log('사용법: node lib/deep-analyze.js --data=xxx-data.json [--basis=보조금] [--institution=기관명] [--limit=자문료한도]');
    process.exit(1);
  }

  const data = JSON.parse(fs.readFileSync(dataFile, 'utf-8'));
  const config = {
    legalBasis: args.basis || '보조금',
    institutionName: args.institution || '',
    consultFeeLimit: parseInt(args.limit) || 600000,
    withholdingRate: 0.088,
  };

  const enriched = analyze(data, config);
  printSummary(enriched);

  const outFile = dataFile.replace(/\.json$/, '-enriched.json');
  fs.writeFileSync(outFile, JSON.stringify(enriched, null, 2), 'utf-8');
  console.log(`저장: ${outFile}`);
}
