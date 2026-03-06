const d = require('./knuh-data.json');
const meetings = d.filter(r => r.purpose.includes('회의비'));
for (const r of meetings) {
  const allText = r.files.map(f => f.text).join('\n');
  // 참여인력(N명), 내부인력(N명), 외부인력(N명) 패턴
  const m1 = allText.match(/참여인력\((\d+)명\)/);
  const m2 = allText.match(/내부인력?\((\d+)/);
  const m3 = allText.match(/외부인력\((\d+)명\)/);
  const part = m1 ? parseInt(m1[1]) : 0;
  const intern = m2 ? parseInt(m2[1]) : 0;
  const ext = m3 ? parseInt(m3[1]) : 0;
  const total = part + intern + ext;
  const perPerson = total > 0 ? Math.round(r.totalAmount / total) : '?';
  const over = total > 0 && r.totalAmount / total > 50000 ? '★초과' : '';

  console.log('R' + r.rowNum + ' | ' + r.totalAmount.toLocaleString().padStart(8) + '원 | ' +
    '참여' + part + '+내부' + intern + '+외부' + ext + '=' + total + '명 | ' +
    '1인' + (perPerson !== '?' ? perPerson.toLocaleString() : '?') + '원 ' + over + ' | files:' + r.files.length);
}
