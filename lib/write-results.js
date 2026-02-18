/**
 * 공통 결과 엑셀 기록 모듈
 * - results.json + data.json → 소스 엑셀에 검토결과 기록
 * - col22(V) = 불인정금액, col23(W) = 검토진행상태, col24(X) = 검토의견
 *
 * 사용법:
 *   const writer = require('./lib/write-results');
 *   await writer.run({ sourceExcel, outputExcel, resultsJson, dataJson, overrides });
 *
 *   또는 CLI:
 *   node lib/write-results.js --source=소스.xlsx --output=결과.xlsx --results=xxx-results.json --data=xxx-data.json [--overrides=xxx-overrides.json]
 */
const fs = require('fs');
const ExcelJS = require('exceljs');

async function run({ sourceExcel, outputExcel, results, rawData, overrides = {} }) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(sourceExcel);
  const ws = wb.worksheets[0];

  // 헤더 확인
  const row2 = ws.getRow(2);
  console.log('Col22:', row2.getCell(22).value);
  console.log('Col23:', row2.getCell(23).value);

  // col24 헤더 추가
  const headerRow2 = ws.getRow(2);
  if (!headerRow2.getCell(24).value) {
    headerRow2.getCell(24).value = '검토의견';
  }

  // rawData 맵
  const dataMap = {};
  if (rawData) {
    for (const d of rawData) dataMap[d.rowNum] = d;
  }

  let written = 0;
  let vatDisTotal = 0;

  for (const r of results) {
    const excelRow = r.rowNum + 2;  // data starts at row 3 (rowNum 1 = excel row 3)
    const row = ws.getRow(excelRow);

    // 검토진행상태
    row.getCell(23).value = r.status;

    if (r.status === '확인') {
      if (overrides[r.rowNum]) {
        // 수동 오버라이드
        const ov = overrides[r.rowNum];
        row.getCell(22).value = ov.disallowed;
        row.getCell(24).value = ov.comment;
      } else {
        // VAT 불인정
        const d = dataMap[r.rowNum];
        if (d && d.vat > 0 && d.totalAmount === d.supplyAmount + d.vat) {
          row.getCell(22).value = d.vat;
          row.getCell(24).value = `부가세 ${d.vat.toLocaleString()}원 포함 집행 → 영리법인 매입세액공제 가능분 불인정`;
          vatDisTotal += d.vat;
        } else {
          row.getCell(22).value = 0;
          row.getCell(24).value = r.issues.join('; ');
        }
      }
    } else if (r.status === '적정') {
      row.getCell(22).value = 0;
      const summary = r.ok.filter(x => !x.includes('→')).slice(0, 3).join(', ');
      row.getCell(24).value = summary || '증빙 적정';
    }

    row.commit();
    written++;
  }

  await wb.xlsx.writeFile(outputExcel);
  console.log(`\n${written}건 기록 완료 → ${outputExcel}`);

  // 요약
  const okCnt = results.filter(r => r.status === '적정').length;
  const chkCnt = results.filter(r => r.status === '확인').length;
  const overrideTotal = Object.values(overrides).reduce((s, v) => s + (v.disallowed || 0), 0);
  const grandTotal = overrideTotal + vatDisTotal;
  console.log(`적정 ${okCnt}건 | 확인 ${chkCnt}건`);
  console.log(`불인정금액: 수동검토 ${overrideTotal.toLocaleString()}원 + 부가세 ${vatDisTotal.toLocaleString()}원 = 합계 ${grandTotal.toLocaleString()}원`);
}

module.exports = { run };

// ── CLI ──
if (require.main === module) {
  const args = process.argv.slice(2);
  const getArg = (prefix) => {
    const a = args.find(x => x.startsWith(prefix));
    return a ? a.substring(prefix.length) : null;
  };

  const sourceExcel = getArg('--source=');
  const outputExcel = getArg('--output=');
  const resultsFile = getArg('--results=');
  const dataFile = getArg('--data=');
  const overridesFile = getArg('--overrides=');

  if (!sourceExcel || !outputExcel || !resultsFile) {
    console.log('사용법: node lib/write-results.js --source=소스.xlsx --output=결과.xlsx --results=xxx-results.json [--data=xxx-data.json] [--overrides=xxx-overrides.json]');
    process.exit(1);
  }

  const results = JSON.parse(fs.readFileSync(resultsFile, 'utf-8'));
  const rawData = dataFile ? JSON.parse(fs.readFileSync(dataFile, 'utf-8')) : null;
  const overrides = overridesFile ? JSON.parse(fs.readFileSync(overridesFile, 'utf-8')) : {};

  run({ sourceExcel, outputExcel, results, rawData, overrides }).catch(console.error);
}
