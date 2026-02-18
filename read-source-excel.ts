import ExcelJS from 'exceljs';

async function main() {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile('/mnt/c/Users/정동회계법인/Downloads/B0080124003815_사업집행내역_20260204151120.xlsx');

  const ws = wb.worksheets[0];
  console.log(`시트: ${ws.name}, 행: ${ws.rowCount}, 열: ${ws.columnCount}`);

  // 헤더 확인
  const headerRow = ws.getRow(1);
  const headers: string[] = [];
  for (let c = 1; c <= ws.columnCount; c++) {
    headers.push(String(headerRow.getCell(c).value ?? ''));
  }
  console.log('\n헤더:', headers.join(' | '));

  // 데이터 행 3~7 (날짜 포맷 확인)
  console.log('\n--- 데이터 샘플 (3~7행) ---');
  for (let r = 3; r <= Math.min(7, ws.rowCount); r++) {
    const row = ws.getRow(r);
    const d: Record<string, string> = {};
    for (let c = 1; c <= ws.columnCount; c++) {
      const cell = row.getCell(c);
      let val = '';
      if (cell.value instanceof Date) {
        val = cell.value.toISOString().substring(0, 10);
      } else {
        val = String(cell.value ?? '');
      }
      d[headers[c-1]] = val.substring(0, 40);
    }
    console.log(`\nRow ${r}:`);
    console.log(`  집행일: ${d['집행실행일자']} | 작성일: ${d['작성일자']}`);
    console.log(`  증빙: ${d['증빙구분']} / ${d['기타증빙종류']}`);
    console.log(`  용도: ${d['집행용도']}`);
    console.log(`  비목: ${d['비목명']} > ${d['세목명']} > ${d['품목명']}`);
    console.log(`  거래처: ${d['거래처명']} | 금액: ${d['집행금액(A+B)-C']}`);
    console.log(`  상태: ${d['검토진행상태']} | 검토일: ${d['검토일자']}`);
  }

  // 총 데이터 행수 (빈 행 제외)
  let dataCount = 0;
  for (let r = 3; r <= ws.rowCount; r++) {
    const cell = ws.getRow(r).getCell(1);
    if (cell.value) dataCount++;
  }
  console.log(`\n총 데이터 행: ${dataCount}건`);
}
main();
