const ExcelJS = require('exceljs');
(async () => {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile('/mnt/c/Users/정동회계법인/Documents/2025 보조금 본정산/2025년2월_이나라도움_본정산리스트.xlsx');
  const ws = wb.worksheets[0];

  // 헤더
  const hdr = [];
  ws.getRow(1).eachCell((c, col) => { hdr[col] = String(c.value || ''); });

  // 디지털헬스케어 행만 (순번 174~202)
  console.log('순번 | 기관명 | 정산상태(Q) | 기타특이사항(Y)');
  console.log('------|--------|------------|----------------');
  ws.eachRow((row, rowNum) => {
    if (rowNum === 1) return;
    const seq = row.getCell(2).value;
    const seqN = typeof seq === 'number' ? seq : parseInt(String(seq));
    if (seqN >= 174 && seqN <= 202) {
      const inst = String(row.getCell(7).value || '').substring(0, 20);
      const status = String(row.getCell(17).value || '');
      const note = String(row.getCell(25).value || '').substring(0, 50);
      console.log(`${seqN} | ${inst} | ${status} | ${note}`);
    }
  });
})();
