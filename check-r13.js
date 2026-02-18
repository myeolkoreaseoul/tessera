const d = require('./neofons-data.json');
const r = d.find(x => x.rowNum === 13);
for (const f of r.files) {
  console.log('\n=== ' + f.name + ' ===');
  console.log(f.text || '(텍스트 없음)');
}
