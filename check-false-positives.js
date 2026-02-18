const d = require('./neofons-data.json');
// R13 주류 의심 확인
const r13 = d.find(x => x.rowNum === 13);
for (const f of r13.files) {
  const ALCOHOL = ['맥주','소주','와인','위스키','사케','주류','막걸리','하이볼',
    '칵테일','보드카','럼','데킬라','생맥주','병맥주','beer','wine','soju',
    '참이슬','처음처럼','진로','카스','하이트','클라우드','테라'];
  const lower = (f.text || '').toLowerCase();
  for (const kw of ALCOHOL) {
    if (lower.includes(kw)) {
      const idx = lower.indexOf(kw);
      console.log('R13 ' + f.name + ': "' + kw + '" at pos ' + idx);
      console.log('  context: ...' + (f.text || '').substring(Math.max(0,idx-30), idx+50) + '...');
    }
  }
}
// R49 주류 의심 확인
const r49 = d.find(x => x.rowNum === 49);
for (const f of r49.files) {
  const ALCOHOL = ['맥주','소주','와인','위스키','사케','주류','막걸리','하이볼',
    '칵테일','보드카','럼','데킬라','생맥주','병맥주','beer','wine','soju',
    '참이슬','처음처럼','진로','카스','하이트','클라우드','테라'];
  const lower = (f.text || '').toLowerCase();
  for (const kw of ALCOHOL) {
    if (lower.includes(kw)) {
      const idx = lower.indexOf(kw);
      console.log('R49 ' + f.name + ': "' + kw + '" at pos ' + idx);
      console.log('  context: ...' + (f.text || '').substring(Math.max(0,idx-30), idx+50) + '...');
    }
  }
}
// R18 파일명 확인
const r18 = d.find(x => x.rowNum === 18);
console.log('\nR18 files:');
for (const f of r18.files) console.log('  ' + f.name);
// R19 확인
const r19 = d.find(x => x.rowNum === 19);
console.log('\nR19 evidenceSub:', r19.evidenceSub);
console.log('R19 files:');
for (const f of r19.files) console.log('  ' + f.name);
// R11 외부참석자 확인
const r11 = d.find(x => x.rowNum === 11);
console.log('\nR11 texts:');
for (const f of r11.files) {
  if (f.text && f.text.length > 50) {
    console.log('  ' + f.name + ':');
    console.log('  ' + f.text.substring(0, 500).replace(/\n/g, '\n  '));
  }
}
