const results = require('./projects/캠퍼스타운-고려대/results.json');
const byKey = {};
results.forEach(r => {
  const key = (r.purpose || '') + '|' + (r.amount || '');
  if (!byKey[key]) byKey[key] = [];
  byKey[key].push({ rn: r.rowNum, status: r.status });
});
const dups = Object.entries(byKey).filter(([k,v]) => v.length > 1);
console.log('purpose+amount 중복:', dups.length);
let diffCount = 0;
dups.forEach(([k,v]) => {
  const statuses = v.map(x => x.status);
  const allSame = statuses.every(s => s === statuses[0]);
  if (!allSame) {
    diffCount++;
    console.log('DIFF', k.substring(0,60), JSON.stringify(v));
  }
});
console.log('status 다른 중복:', diffCount);
