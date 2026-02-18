/**
 * 경북대학교병원 정산검토 결과 → 소스 엑셀에 기록
 * col22(V) = 불인정금액, col23(W) = 검토진행상태, col24(X) = 검토의견
 */
const ExcelJS = require('exceljs');
const results = require('./knuh-results.json');

const SOURCE = '/mnt/c/Users/정동회계법인/Documents/2025 보조금 본정산/대구경북첨단의료산업진흥재단/디지털헬스케어 의료기기 실증지원 사업/경북대학교병원/B0071029000066_사업집행내역_20260210180224.xlsx';
const OUTPUT = '/mnt/c/Users/정동회계법인/Documents/2025 보조금 본정산/대구경북첨단의료산업진흥재단/디지털헬스케어 의료기기 실증지원 사업/경북대학교병원/경북대학교병원_정산검토결과.xlsx';

// 확인 건별 불인정금액 및 의견
const OVERRIDES = {
  20: { disallowed: 3685000, comment: '범용성 장비(노트북 LG그램) 임차 → 지침 별표2 "범용성 장비 구입 또는 대여" 전액 불인정' },
  // 첨부파일 없음 → 보완 요청
  1:  { disallowed: 0, comment: '증빙파일 미첨부 → 보완 요청 (회의록, 영수증)' },
  9:  { disallowed: 0, comment: '증빙파일 미첨부 → 보완 요청 (근로계약서, 급여명세서, 지급명세서)' },
  10: { disallowed: 0, comment: '증빙파일 미첨부 → 보완 요청 (회의록, 영수증)' },
  11: { disallowed: 0, comment: '증빙파일 미첨부 → 보완 요청 (회의록, 영수증)' },
  12: { disallowed: 0, comment: '증빙파일 미첨부 → 보완 요청 (회의록, 영수증)' },
  23: { disallowed: 0, comment: '증빙파일 미첨부 → 보완 요청 (회의록, 영수증)' },
  25: { disallowed: 0, comment: '외부참석자 확인 불가 → 회의록 참석자명단 보완 요청' },
  31: { disallowed: 0, comment: '참석인원 대비 1인당 5만원 한도 확인 필요 → 보완 요청' },
};

async function main() {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(SOURCE);
  const ws = wb.worksheets[0];

  // 헤더 확인
  const row2 = ws.getRow(2);
  console.log('Col22:', row2.getCell(22).value);
  console.log('Col23:', row2.getCell(23).value);

  // col24에 '검토의견' 헤더 추가
  if (!row2.getCell(24).value) {
    row2.getCell(24).value = '검토의견';
  }

  let written = 0;
  for (const r of results) {
    const excelRow = r.rowNum + 2;
    const row = ws.getRow(excelRow);

    row.getCell(23).value = r.status;

    if (r.status === '확인' && OVERRIDES[r.rowNum]) {
      const ov = OVERRIDES[r.rowNum];
      row.getCell(22).value = ov.disallowed;
      row.getCell(24).value = ov.comment;
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
  const disTotal = Object.values(OVERRIDES).reduce((s, v) => s + v.disallowed, 0);
  console.log(`적정 ${okCnt}건 | 확인 ${chkCnt}건 | 불인정금액 합계 ${disTotal.toLocaleString()}원`);
}

main().catch(console.error);
