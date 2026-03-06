import ExcelJS from 'exceljs';

async function main() {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile('/mnt/c/Users/정동회계법인/Downloads/경기도의료원 안성병원/B0080313003078_사업집행내역_20260206160119.xlsx');
  const ws = wb.worksheets[0];
  
  console.log('Sheet name:', ws.name);
  console.log('Row count:', ws.rowCount);
  console.log('Column count:', ws.columnCount);
  
  // Print first 3 rows to see headers
  for (let r = 1; r <= Math.min(4, ws.rowCount); r++) {
    const row = ws.getRow(r);
    const vals: string[] = [];
    for (let c = 1; c <= ws.columnCount; c++) {
      vals.push(`${c}:${row.getCell(c).value || ''}`);
    }
    console.log(`Row ${r}:`, vals.join(' | '));
  }
  
  // Print last row to see data range
  const lastRow = ws.getRow(ws.rowCount);
  const lastVals: string[] = [];
  for (let c = 1; c <= Math.min(10, ws.columnCount); c++) {
    lastVals.push(`${c}:${lastRow.getCell(c).value || ''}`);
  }
  console.log(`Last row (${ws.rowCount}):`, lastVals.join(' | '));
  
  // Count data rows (skip header rows)
  let dataCount = 0;
  for (let r = 3; r <= ws.rowCount; r++) {
    const val = ws.getRow(r).getCell(1).value;
    if (val) dataCount++;
  }
  console.log('Data rows (from row 3):', dataCount);
}
main().catch(console.error);
