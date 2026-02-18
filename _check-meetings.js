const data = require('/mnt/c/projects/e-naradomum-rpa/가천대길병원-data.json');

// Find all 회의비 items
const meetings = data.filter(r => r.purpose.includes('회의비'));
console.log(`총 회의비 건수: ${meetings.length}건\n`);

for (const r of meetings) {
  const fileTexts = (r.files || []).map(f => f.text || '').join(' ');
  const has회의록 = /회의록|회의결과|회의\s*록|결과\s*보고/i.test(fileTexts);
  const has내부결재 = /결재|품의|내부결재|지출.*결의/i.test(fileTexts);
  const has방명록 = /방명록|서명|참석자.*서명|출석/i.test(fileTexts);
  const has외부참석 = /외부|타기관|외래|주관기관|참여기관|SYM|에스와이엠|빔웍스/i.test(fileTexts);
  
  // Extract participant count if possible
  const personMatch = fileTexts.match(/(\d+)\s*명|(\d+)\s*인/);
  const personCount = personMatch ? (personMatch[1] || personMatch[2]) : '?';
  const perPerson = personCount !== '?' ? Math.round(r.totalAmount / parseInt(personCount)) : '?';
  
  console.log(`R${r.rowNum} | ${r.purpose} | ${r.totalAmount}원 | ${r.vendorName}`);
  console.log(`  회의록:${has회의록?'✓':'✗'} 내부결재:${has내부결재?'✓':'✗'} 방명록:${has방명록?'✓':'✗'} 외부참석:${has외부참석?'✓':'✗'} 인원:${personCount}명 1인당:${perPerson}원`);
  
  // Show file names
  const fnames = (r.files || []).map(f => f.name).join(', ');
  console.log(`  파일: ${fnames}`);
  console.log('');
}
