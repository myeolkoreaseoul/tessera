const ExcelJS = require('exceljs');
const xlsPath = '/mnt/c/Users/정동회계법인/Documents/2025 보조금 본정산/2025년2월_이나라도움_본정산리스트.xlsx';

const updates = [
  { seq: 201, status: 'RPA 검토완료', note: '스키아 31건, 적정6/확인25, 중간정산, 1오류' },
];

(async () => {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(xlsPath);
  const ws = wb.worksheets[0];

  ws.eachRow((row, rowNum) => {
    if (rowNum === 1) return;
    const seqVal = row.getCell(2).value;
    const seq = typeof seqVal === 'number' ? seqVal : parseInt(String(seqVal));
    const match = updates.find(u => u.seq === seq);
    if (match) {
      row.getCell(17).value = match.status;
      const existing = String(row.getCell(25).value || '');
      row.getCell(25).value = existing ? `${existing} | ${match.note}` : match.note;
      console.log(`  [${seq}] ${match.status} | ${match.note}`);
    }
  });

  await wb.xlsx.writeFile(xlsPath);
  console.log('업데이트 완료');
})().catch(e => { console.error('Error:', e.message); process.exit(1); });
