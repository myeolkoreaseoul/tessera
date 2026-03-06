const d = require('./neofons-data.json');
const samples = [43, 6, 46, 42, 5];
for (const n of samples) {
  const r = d.find(x => x.rowNum === n);
  if (!r) continue;
  console.log('\n' + '='.repeat(80));
  console.log('R' + r.rowNum + ' | ' + r.purpose + ' | ' + r.totalAmount.toLocaleString() + '원');
  console.log('비목: ' + r.budgetCategory + '/' + r.subCategory + ' | 증빙: ' + r.evidenceType + '/' + r.evidenceSub);
  console.log('거래처: ' + r.vendorName + ' | 업종: ' + r.bizType);
  console.log('파일 ' + r.files.length + '개:');
  for (const f of r.files) {
    console.log('\n  --- ' + f.name + ' ---');
    console.log('  ' + (f.text || '(텍스트 없음)').substring(0, 600).replace(/\n/g, '\n  '));
  }
}
