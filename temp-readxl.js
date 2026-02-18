const ExcelJS = require('exceljs');
(async () => {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile('/mnt/c/Users/정동회계법인/Documents/2025 보조금 본정산/2025년2월_이나라도움_본정산리스트.xlsx');
  for (const ws of wb.worksheets) {
    console.log(`\n=== 시트: ${ws.name} ===`);
    ws.eachRow((row, rowNum) => {
      if (rowNum > 50) return; // 최대 50행
      const vals = [];
      row.eachCell({ includeEmpty: true }, (cell, col) => {
        vals.push(String(cell.value || '').substring(0, 40));
      });
      console.log(`${rowNum}: ${vals.join(' | ')}`);
    });
  }
})();
