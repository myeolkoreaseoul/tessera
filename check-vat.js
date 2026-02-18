const d = require('./neofons-data.json');
console.log('부가세 포함 집행 건 확인\n');
console.log('Row | 용도 | 공급가액 | 부가세 | 집행금액 | VAT포함여부');
console.log('-'.repeat(90));
let vatTotal = 0;
for (const r of d) {
  if (r.vat > 0) {
    const included = (r.totalAmount === r.supplyAmount + r.vat) ? 'VAT포함' :
                     (r.totalAmount === r.supplyAmount) ? 'VAT제외' : '확인필요';
    console.log(`R${r.rowNum} | ${r.purpose.substring(0,25).padEnd(25)} | ${r.supplyAmount.toLocaleString().padStart(12)} | ${r.vat.toLocaleString().padStart(10)} | ${r.totalAmount.toLocaleString().padStart(12)} | ${included}`);
    if (included === 'VAT포함') vatTotal += r.vat;
  }
}
console.log('\nVAT 포함 집행된 부가세 합계: ' + vatTotal.toLocaleString() + '원');
