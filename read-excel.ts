import ExcelJS from 'exceljs';

async function main() {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile('/mnt/c/projects/e-naradomum-rpa/results/pipeline_test_20260204_1506.xlsx');
  const ws = wb.getWorksheet('점검결과');
  if (!ws) { console.log('시트 없음'); return; }
  ws.eachRow((row, rowNum) => {
    const vals: string[] = [];
    row.eachCell({ includeEmpty: true }, (cell) => {
      vals.push(String(cell.value ?? ''));
    });
    console.log(`Row ${rowNum}: ${vals.join(' | ')}`);
  });
}
main();
