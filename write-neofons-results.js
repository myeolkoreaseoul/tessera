/**
 * 네오폰스 정산검토 결과 → 소스 엑셀에 기록
 * col22(V) = 불인정금액, col23(W) = 검토진행상태, col24(X) = 검토의견
 */
const ExcelJS = require('exceljs');
const results = require('./neofons-results.json');
const rawData = require('./neofons-data.json');

const SOURCE = '/mnt/c/Users/정동회계법인/Documents/2025 보조금 본정산/대구경북첨단의료산업진흥재단/디지털헬스케어 의료기기 실증지원 사업/네오폰스/B0081024001128_사업집행내역_20260210141847.xlsx';
const OUTPUT = '/mnt/c/Users/정동회계법인/Documents/2025 보조금 본정산/대구경북첨단의료산업진흥재단/디지털헬스케어 의료기기 실증지원 사업/네오폰스/네오폰스_정산검토결과.xlsx';

// 수동 오버라이드 (비 VAT 이슈)
const OVERRIDES = {
  7:  { disallowed: 2178000, comment: '범용성 장비(노트북 LG그램) 대여 → 지침 별표2 "범용성 장비 구입 또는 대여" 전액 불인정' },
  8:  { disallowed: 193400,  comment: '자문수당 2시간 한도 20만원, 세전 40만원 지급 → 20만원(세후 193,400원) 초과' },
  36: { disallowed: 0,       comment: '수납영수증(진료비) 미첨부 → 보완 요청' },
  39: { disallowed: 0,       comment: '수납영수증(진료비) 미첨부 → 보완 요청' },
};

// rawData에서 VAT 금액 조회용 맵
const dataMap = {};
for (const d of rawData) dataMap[d.rowNum] = d;

async function main() {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(SOURCE);
  const ws = wb.worksheets[0];

  // 헤더 확인 (row 2에 컬럼명)
  const row2 = ws.getRow(2);
  console.log('Col22:', row2.getCell(22).value);
  console.log('Col23:', row2.getCell(23).value);

  // col24에 '검토의견' 헤더 추가
  const headerRow = ws.getRow(1);
  const headerRow2 = ws.getRow(2);
  if (!headerRow2.getCell(24).value) {
    headerRow2.getCell(24).value = '검토의견';
  }

  let written = 0;
  let vatDisTotal = 0;
  for (const r of results) {
    const excelRow = r.rowNum + 2; // data starts at row 3 (rowNum 1 = excel row 3)
    const row = ws.getRow(excelRow);

    // 검토진행상태
    row.getCell(23).value = r.status;

    // 불인정금액 & 검토의견
    if (r.status === '확인') {
      if (OVERRIDES[r.rowNum]) {
        // 수동 오버라이드 항목 (범용성 장비, 자문수당 초과, 보완요청 등)
        const ov = OVERRIDES[r.rowNum];
        row.getCell(22).value = ov.disallowed;
        row.getCell(24).value = ov.comment;
      } else {
        // VAT 불인정 항목 (영리법인 매입세액공제 가능분)
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

  await wb.xlsx.writeFile(OUTPUT);
  console.log(`\n${written}건 기록 완료 → ${OUTPUT}`);

  // 요약
  const okCnt = results.filter(r => r.status === '적정').length;
  const chkCnt = results.filter(r => r.status === '확인').length;
  const overrideTotal = Object.values(OVERRIDES).reduce((s, v) => s + v.disallowed, 0);
  const grandTotal = overrideTotal + vatDisTotal;
  console.log(`적정 ${okCnt}건 | 확인 ${chkCnt}건`);
  console.log(`불인정금액: 수동검토 ${overrideTotal.toLocaleString()}원 + 부가세 ${vatDisTotal.toLocaleString()}원 = 합계 ${grandTotal.toLocaleString()}원`);
}

main().catch(console.error);
