const d = require('./neofons-data.json');
const cats = {};
for (const r of d) {
  const k = r.subCategory || '(없음)';
  if (!cats[k]) cats[k] = [];
  cats[k].push({ n: r.rowNum, p: r.purpose.substring(0,40), amt: r.totalAmount, ev: r.evidenceType, files: r.files.length, vendor: r.vendorName, evSub: r.evidenceSub });
}
for (const [k, items] of Object.entries(cats)) {
  console.log('\n=== ' + k + ' (' + items.length + '건) ===');
  for (const i of items) {
    console.log('  R' + i.n + ' | ' + i.amt.toLocaleString() + '원 | ' + i.ev + '/' + i.evSub + ' | ' + i.vendor + ' | ' + i.files + '파일 | ' + i.p);
  }
}
