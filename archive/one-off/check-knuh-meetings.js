const d = require('./knuh-data.json');
const meetings = d.filter(r => r.purpose.includes('회의비'));
for (const r of meetings) {
  const allText = r.files.map(f => f.text).join('\n');
  // 회의비(식비)(N) 패턴
  const match1 = allText.match(/회의비\(식비\)\((\d+)\)/);
  const match2 = allText.match(/회의비\(합계\)\([^)]*(\d+)\)/);
  const match3 = allText.match(/참석[^0-9]*(\d+)/);
  const personCount = match1 ? match1[1] : (match3 ? match3[1] : '?');
  const perPerson = personCount !== '?' ? Math.round(r.totalAmount / parseInt(personCount)) : '?';

  // 외부참석자 키워드
  const extPatterns = ['외부', '경북권역', '재활병원', '첨복재단', '첨단의료', '대구의료원'];
  const hasExt = extPatterns.some(p => allText.includes(p));

  console.log('R' + r.rowNum + ' | ' + r.totalAmount.toLocaleString().padStart(8) + '원 | ' +
    personCount + '명 | 1인' + (perPerson !== '?' ? perPerson.toLocaleString() : '?') + '원 | ext:' + hasExt + ' | files:' + r.files.length);
}
