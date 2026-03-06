const data = require('/mnt/c/projects/e-naradomum-rpa/가천대길병원-data.json');

// Items that need OCR review: 회의비, 전문가활용비, 여비, 인건비, high-value items
const keyRows = [1, 4, 5, 6, 7, 8, 9, 10, 16, 17, 18, 23, 24, 25, 26, 27, 31, 36, 40, 44, 45, 47, 48, 52, 53, 57, 58, 59, 60, 63, 64, 65, 66, 67, 68, 69];

for (const rn of keyRows) {
  const r = data.find(x => x.rowNum === rn);
  if (!r) continue;
  console.log(`\n=== R${r.rowNum} | ${r.purpose} | ${r.totalAmount}원 | ${r.vendorName} ===`);
  if (!r.files || r.files.length === 0) {
    console.log('  [파일 없음]');
    continue;
  }
  for (const f of r.files) {
    const text = (f.text || '').substring(0, 800);
    console.log(`  [${f.name}] ${text}`);
    console.log('  ---');
  }
}
