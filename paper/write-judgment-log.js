#!/usr/bin/env node
/**
 * write-judgment-log.js — 판정로그 출력 (제2원칙 준수)
 *
 * results.json + data-enriched.json → 판정로그.xlsx + 판정로그.json
 *
 * 사용법:
 *   const { writeJudgmentLog } = require('./write-judgment-log');
 *   await writeJudgmentLog(enrichedData, results, { outDir, project, institution });
 */
const ExcelJS = require('exceljs');
const fs = require('fs');
const path = require('path');

// 셀 색상
const COLORS = {
  headerBg: 'FFD9E1F2',   // 연파랑
  okBg: 'FFE8F5E9',       // 연초록
  checkBg: 'FFFCE4EC',    // 연분홍
  skipBg: 'FFF5F5F5',     // 연회색
};

async function writeJudgmentLog(enrichedData, results, options = {}) {
  const { outDir = '.', project = '', institution = '' } = options;

  // results를 rowNum으로 인덱싱
  const resultMap = {};
  for (const r of results) {
    resultMap[r.rowNum] = r;
  }

  const wb = new ExcelJS.Workbook();

  // ═══════ Sheet 1: 판정결과 ═══════
  const ws = wb.addWorksheet('판정결과');

  ws.columns = [
    { header: '순번', key: 'idx', width: 6 },
    { header: 'RN', key: 'rowNum', width: 6 },
    { header: '비목', key: 'budgetCategory', width: 12 },
    { header: '세목', key: 'subCategory', width: 12 },
    { header: '사용용도', key: 'purpose', width: 35 },
    { header: '금액', key: 'amount', width: 14 },
    { header: '거래처', key: 'vendorName', width: 20 },
    { header: '증빙파일수', key: 'fileCount', width: 10 },
    { header: '판정', key: 'status', width: 8 },
    { header: '판정사유', key: 'reasoning', width: 50 },
    { header: '신뢰도', key: 'confidence', width: 8 },
    { header: '분석플래그', key: 'flags', width: 40 },
    { header: '판정일시', key: 'judgedAt', width: 18 },
  ];

  // 헤더 스타일
  const headerRow = ws.getRow(1);
  headerRow.font = { bold: true };
  headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.headerBg } };
  headerRow.alignment = { vertical: 'middle' };

  const now = new Date().toISOString().replace('T', ' ').substring(0, 19);

  for (let i = 0; i < enrichedData.length; i++) {
    const item = enrichedData[i];
    const result = resultMap[item.rowNum] || {};
    const flags = (item.analysis && item.analysis.flags) || [];
    const flagStr = flags.map(f => typeof f === 'string' ? f : (f.id || f.description || '')).join('; ');

    const issues = result.issues || [];
    const reasoning = result.reasoning || issues.join('; ') || (result.status === '적정' ? '적정' : '');

    const row = ws.addRow({
      idx: i + 1,
      rowNum: item.rowNum,
      budgetCategory: item.budgetCategory || '',
      subCategory: item.subCategory || '',
      purpose: item.purpose || '',
      amount: item.amount || item.totalAmount || 0,
      vendorName: item.vendorName || '',
      fileCount: (item.files || []).length,
      status: result.status || '',
      reasoning,
      confidence: result.confidence || '',
      flags: flagStr,
      judgedAt: now,
    });

    // 금액 포맷
    row.getCell('amount').numFmt = '#,##0';

    // 상태별 색상
    const status = result.status || '';
    let bgColor;
    if (status === '적정') bgColor = COLORS.okBg;
    else if (status === '확인') bgColor = COLORS.checkBg;
    else if (status === 'SKIP') bgColor = COLORS.skipBg;

    if (bgColor) {
      row.eachCell(cell => {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: bgColor } };
      });
    }
  }

  // 자동 필터
  ws.autoFilter = { from: 'A1', to: `M${enrichedData.length + 1}` };

  // ═══════ Sheet 2: 요약 ═══════
  const summary = wb.addWorksheet('요약');

  const total = results.length;
  const okCount = results.filter(r => r.status === '적정').length;
  const checkCount = results.filter(r => r.status === '확인').length;
  const skipCount = results.filter(r => r.status === 'SKIP').length;

  summary.addRow(['기관명', institution]);
  summary.addRow(['사업명', project]);
  summary.addRow(['총 건수', total]);
  summary.addRow(['적정', `${okCount}건 (${total ? ((okCount / total) * 100).toFixed(1) : 0}%)`]);
  summary.addRow(['확인', `${checkCount}건 (${total ? ((checkCount / total) * 100).toFixed(1) : 0}%)`]);
  summary.addRow(['SKIP', `${skipCount}건`]);
  summary.addRow(['판정일시', now]);
  summary.addRow([]);
  summary.addRow(['확인 사유별 집계']);

  summary.getRow(1).font = { bold: true };
  summary.getRow(9).font = { bold: true };

  // 사유별 집계
  const issueMap = {};
  for (const r of results) {
    if (r.status !== '확인') continue;
    const reasons = r.issues && r.issues.length > 0 ? r.issues : [r.reasoning || '사유 미기재'];
    for (const iss of reasons) {
      if (!iss) continue;
      if (!issueMap[iss]) issueMap[iss] = [];
      issueMap[iss].push(`R${r.rowNum}`);
    }
  }

  for (const [issue, rowNums] of Object.entries(issueMap).sort((a, b) => b[1].length - a[1].length)) {
    summary.addRow([issue, `${rowNums.length}건`, rowNums.join(', ')]);
  }

  summary.getColumn(1).width = 50;
  summary.getColumn(2).width = 12;
  summary.getColumn(3).width = 60;

  // ═══════ 저장 ═══════
  fs.mkdirSync(outDir, { recursive: true });

  const xlsxPath = path.join(outDir, '판정로그.xlsx');
  const jsonPath = path.join(outDir, '판정로그.json');

  await wb.xlsx.writeFile(xlsxPath);

  // JSON 백업 (제2원칙)
  const logData = enrichedData.map(item => {
    const result = resultMap[item.rowNum] || {};
    return {
      rowNum: item.rowNum,
      budgetCategory: item.budgetCategory || '',
      subCategory: item.subCategory || '',
      purpose: item.purpose || '',
      amount: item.amount || item.totalAmount || 0,
      vendorName: item.vendorName || '',
      fileCount: (item.files || []).length,
      status: result.status || '',
      issues: result.issues || [],
      reasoning: result.reasoning || '',
      confidence: result.confidence || '',
      flags: ((item.analysis && item.analysis.flags) || []).map(f => typeof f === 'string' ? f : (f.id || '')),
      judgedAt: now,
    };
  });
  fs.writeFileSync(jsonPath, JSON.stringify(logData, null, 2), 'utf-8');

  console.log(`  [판정로그] ${xlsxPath}`);
  console.log(`  [판정로그] ${jsonPath}`);
  console.log(`  적정: ${okCount} / 확인: ${checkCount} / SKIP: ${skipCount} / 총: ${total}`);

  return { xlsxPath, jsonPath };
}

module.exports = { writeJudgmentLog };

// ── CLI ──
if (require.main === module) {
  const args = Object.fromEntries(
    process.argv.slice(2).filter(a => a.startsWith('--')).map(a => {
      const [k, ...v] = a.slice(2).split('=');
      return [k, v.length ? v.join('=') : true];
    })
  );

  const dataFile = args.data;
  const resultsFile = args.results;
  const outDir = args.out || '.';

  if (!dataFile || !resultsFile) {
    console.log('사용법: node paper/write-judgment-log.js --data=data-enriched.json --results=results.json [--out=outdir]');
    process.exit(1);
  }

  const data = JSON.parse(fs.readFileSync(dataFile, 'utf-8'));
  const results = JSON.parse(fs.readFileSync(resultsFile, 'utf-8'));
  writeJudgmentLog(data, results, { outDir, project: args.project || '', institution: args.institution || '' })
    .catch(console.error);
}
