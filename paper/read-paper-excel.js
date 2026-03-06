#!/usr/bin/env node
/**
 * read-paper-excel.js — 기관 제출 엑셀 리더 (컬럼 자동감지)
 *
 * 기관마다 엑셀 컬럼이 다르므로 헤더 자동감지 지원.
 *
 * 사용법:
 *   const { readPaperExcel } = require('./read-paper-excel');
 *   const { rows, detectedMap, headerRow } = await readPaperExcel('기관제출.xlsx');
 *
 *   CLI:
 *   node paper/read-paper-excel.js --excel=기관제출.xlsx [--header-row=N] [--data-start=N]
 */
const fs = require('fs');
const path = require('path');
const ExcelJS = require('exceljs');
const { parseNumber } = require('../lib/utils');

// ── 헤더 자동감지 사전 ──

const HEADER_PATTERNS = {
  rowNum:         ['순번', 'No', 'No.', '번호', 'NO', 'no'],
  date:           ['집행일자', '결제일자', '사용일자', '거래일자', '일자', '지출일자'],
  purpose:        ['사용용도', '내용', '적요', '거래내용', '사용내역', '집행내용', '용도', '사용목적'],
  budgetCategory: ['비목', '예산과목', '비목명', '예산비목'],
  subCategory:    ['세목', '세비목', '세목명', '통계목', '세부비목'],
  amount:         ['금액', '집행금액', '사용금액', '지출금액'],
  totalAmount:    ['합계금액', '총액', '합계'],
  supplyAmount:   ['공급가액', '공급가'],
  vat:            ['부가세', 'VAT', '부가가치세'],
  vendorName:     ['거래처', '상호', '거래처명', '업체명', '수취인'],
  memo:           ['비고', '메모', '참고사항'],
};

/**
 * 1~maxScanRow 행을 스캔하여 헤더 행과 컬럼 매핑을 감지
 */
function detectHeader(ws, maxScanRow = 5) {
  let bestRow = -1;
  let bestMap = {};
  let bestScore = 0;

  for (let r = 1; r <= Math.min(maxScanRow, ws.rowCount); r++) {
    const row = ws.getRow(r);
    const map = {};
    let score = 0;

    for (let c = 1; c <= row.cellCount; c++) {
      const cellVal = String(row.getCell(c).value || '').trim();
      if (!cellVal) continue;

      for (const [field, keywords] of Object.entries(HEADER_PATTERNS)) {
        if (map[field]) continue; // 이미 매핑됨
        for (const kw of keywords) {
          if (cellVal === kw || cellVal.includes(kw)) {
            map[field] = c;
            score++;
            break;
          }
        }
      }
    }

    if (score > bestScore) {
      bestScore = score;
      bestRow = r;
      bestMap = map;
    }
  }

  return { headerRow: bestRow, columnMap: bestMap, score: bestScore };
}

/**
 * 엑셀 읽기 메인 함수
 */
async function readPaperExcel(excelPath, options = {}) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(excelPath);
  const ws = wb.worksheets[0];

  // 헤더 감지 또는 수동 지정
  let headerRow = options.headerRow;
  let columnMap = options.columnMap;
  let detectedMap;

  if (!headerRow || !columnMap) {
    const detected = detectHeader(ws, options.maxScanRow || 5);
    headerRow = headerRow || detected.headerRow;
    columnMap = columnMap || detected.columnMap;
    detectedMap = detected.columnMap;

    // 매핑 결과 출력
    console.log(`  [헤더 감지] ${headerRow}행, ${detected.score}개 필드 매핑:`);
    for (const [field, col] of Object.entries(detected.columnMap)) {
      const cellVal = String(ws.getRow(headerRow).getCell(col).value || '');
      console.log(`    ${field} → 열${col} ("${cellVal}")`);
    }

    if (detected.score < 3) {
      console.warn('  [경고] 매핑된 필드가 3개 미만 — 엑셀 형식을 확인하세요');
    }
  }

  const dataStartRow = options.dataStartRow || headerRow + 1;
  const rows = [];

  for (let r = dataStartRow; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);

    // 빈 행 스킵 (용도나 금액이 없으면 스킵)
    const purposeCol = columnMap.purpose;
    const amountCol = columnMap.amount || columnMap.totalAmount;
    const purposeVal = purposeCol ? String(row.getCell(purposeCol).value || '').trim() : '';
    const amountVal = amountCol ? parseNumber(row.getCell(amountCol).value) : 0;

    if (!purposeVal && !amountVal) continue;

    const rec = {
      excelRowNum: r, // 엑셀 원본 행 번호 (결과 기입용)
      rowNum: columnMap.rowNum ? parseNumber(row.getCell(columnMap.rowNum).value) || (rows.length + 1) : (rows.length + 1),
      date: columnMap.date ? formatCellDate(row.getCell(columnMap.date).value) : '',
      purpose: purposeVal,
      budgetCategory: columnMap.budgetCategory ? String(row.getCell(columnMap.budgetCategory).value || '').trim() : '',
      subCategory: columnMap.subCategory ? String(row.getCell(columnMap.subCategory).value || '').trim() : '',
      amount: columnMap.amount ? parseNumber(row.getCell(columnMap.amount).value) : 0,
      totalAmount: columnMap.totalAmount ? parseNumber(row.getCell(columnMap.totalAmount).value) : 0,
      supplyAmount: columnMap.supplyAmount ? parseNumber(row.getCell(columnMap.supplyAmount).value) : 0,
      vat: columnMap.vat ? parseNumber(row.getCell(columnMap.vat).value) : 0,
      vendorName: columnMap.vendorName ? String(row.getCell(columnMap.vendorName).value || '').trim() : '',
      memo: columnMap.memo ? String(row.getCell(columnMap.memo).value || '').trim() : '',
      files: [],
    };

    // amount와 totalAmount 보정: 하나만 있으면 다른 것도 채움
    if (rec.amount && !rec.totalAmount) rec.totalAmount = rec.amount;
    if (rec.totalAmount && !rec.amount) rec.amount = rec.totalAmount;

    rows.push(rec);
  }

  console.log(`  [읽기 완료] ${rows.length}건`);
  return { rows, detectedMap: detectedMap || columnMap, headerRow };
}

/**
 * 셀 값을 날짜 문자열로 변환
 */
function formatCellDate(val) {
  if (!val) return '';
  if (val instanceof Date) return val.toISOString().substring(0, 10);
  const s = String(val).trim();
  // YYYYMMDD → YYYY-MM-DD
  if (/^\d{8}$/.test(s)) return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
  return s;
}

module.exports = { readPaperExcel, detectHeader, HEADER_PATTERNS };

// ── CLI ──
if (require.main === module) {
  const args = Object.fromEntries(
    process.argv.slice(2).filter(a => a.startsWith('--')).map(a => {
      const [k, ...v] = a.slice(2).split('=');
      return [k, v.length ? v.join('=') : true];
    })
  );

  const excelPath = args.excel;
  if (!excelPath) {
    console.log('사용법: node paper/read-paper-excel.js --excel=기관제출.xlsx [--header-row=N] [--data-start=N]');
    process.exit(1);
  }

  const options = {};
  if (args['header-row']) options.headerRow = parseInt(args['header-row']);
  if (args['data-start']) options.dataStartRow = parseInt(args['data-start']);

  readPaperExcel(excelPath, options).then(({ rows, detectedMap, headerRow }) => {
    console.log(`\n헤더행: ${headerRow}`);
    console.log(`데이터: ${rows.length}건`);
    if (rows.length > 0) {
      console.log('\n첫 3건 미리보기:');
      for (const r of rows.slice(0, 3)) {
        console.log(`  R${r.rowNum}: ${r.purpose || '-'} | ${r.vendorName || '-'} | ${r.amount.toLocaleString()}원`);
      }
    }
  }).catch(console.error);
}
