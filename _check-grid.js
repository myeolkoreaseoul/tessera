const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.connectOverCDP('http://localhost:9444');
  const ctx = browser.contexts()[0];
  const page = ctx.pages().find(p => p.url().includes('DD001002Q'));
  if (!page) { console.log('페이지 없음'); return; }

  const rows = await page.evaluate(() => {
    const grid = DD001002QGridObj;
    const dataRows = grid.getDataRows();
    return dataRows.map((row, i) => {
      const v = grid.getRowValue(row);
      return {
        idx: i+1,
        date: v.excutExecutDe || '',
        evidenceType: v.prufSeNm || '',
        evidenceSub: v.etcPruf || '',
        purpose: v.excutPrposCn || '',
        budgetCat: v.asstnExpitmNm || '',
        budgetSub: v.asstnTaxitmNm || '',
        vendor: (v.bcncCmpnyNm || '').trim(),
        amount: v.lastAmount || v.excutSplpc || 0,
        vat: v.excutVat || 0,
        fileCount: v.atchmnflCnt || 0,
        status: v.exmntPrgstNm || '',
      };
    });
  });

  console.log('그리드 총:', rows.length, '건\n');
  rows.forEach(r => {
    console.log(`R${r.idx} | ${r.date} | ${r.evidenceType} ${r.evidenceSub} | ${(r.purpose||'').substring(0,45)} | ${r.amount}원 | ${r.vendor} | ${r.budgetCat}/${r.budgetSub} | 파일${r.fileCount} | ${r.status}`);
  });
})().catch(e => console.error(e.message));
