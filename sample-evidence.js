const d = require('./neofons-data.json');
// 유형별 샘플 - 회의비(R1), 자문료(R8), 사례금(R22), 여비(R3), 인건비(R19), 용역(R18), 임차(R7), 사무용품(R43), 정산수수료(R6)
const samples = [1, 8, 22, 3, 19, 18, 7, 43, 6];
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
    console.log('  ' + (f.text || '(텍스트 없음)').substring(0, 1200).replace(/\n/g, '\n  '));
  }
}
