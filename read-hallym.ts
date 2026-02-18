import ExcelJS from 'exceljs';

async function main() {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile('/mnt/c/Users/정동회계법인/Downloads/B0080306002618_사업집행내역_20260204162946.xlsx');

  const ws = wb.worksheets[0];
  console.log(`시트: ${ws.name}, 행: ${ws.rowCount}, 열: ${ws.columnCount}`);

  // 헤더 (1~2행)
  for (let r = 1; r <= 2; r++) {
    const row = ws.getRow(r);
    const vals: string[] = [];
    for (let c = 1; c <= ws.columnCount; c++) {
      vals.push(`[${c}/${String.fromCharCode(64+c)}]${String(row.getCell(c).value ?? '').substring(0, 20)}`);
    }
    console.log(`Row ${r}: ${vals.join(' | ')}`);
  }

  // W열(23), Y열(25) 확인
  console.log('\n--- W열(23), X열(24), Y열(25) 헤더 ---');
  for (let r = 1; r <= 2; r++) {
    const row = ws.getRow(r);
    console.log(`Row ${r}: W=${row.getCell(23).value} | X=${row.getCell(24).value} | Y=${row.getCell(25).value}`);
  }

  // 데이터 샘플 (3~5행)
  console.log('\n--- 데이터 샘플 ---');
  for (let r = 3; r <= Math.min(5, ws.rowCount); r++) {
    const row = ws.getRow(r);
    const d = (c: number) => {
      const val = row.getCell(c).value;
      if (val instanceof Date) return val.toISOString().substring(0, 10);
      return String(val ?? '').substring(0, 40);
    };
    console.log(`\nRow ${r}:`);
    console.log(`  집행일: ${d(1)} | 등록일: ${d(2)} | 작성일: ${d(3)}`);
    console.log(`  증빙: ${d(4)} / ${d(5)}`);
    console.log(`  용도: ${d(6)}`);
    console.log(`  비목: ${d(7)} > ${d(8)} > ${d(9)}`);
    console.log(`  거래처: ${d(10)} | 금액: ${d(20)}`);
    console.log(`  W: ${d(23)} | X: ${d(24)} | Y: ${d(25)}`);
  }

  // 총 데이터 행수
  let dataCount = 0;
  for (let r = 3; r <= ws.rowCount; r++) {
    if (ws.getRow(r).getCell(1).value) dataCount++;
  }
  console.log(`\n총 데이터: ${dataCount}건`);
}
main();
