const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.connectOverCDP('http://localhost:9444');
  const page = browser.contexts()[0].pages().find(p => p.url().includes('gosims'));
  if (!page) { console.log('NO PAGE'); return; }

  const data = await page.evaluate(() => {
    const grid = window.DD001002QGridObj;
    if (!grid) return null;
    const rows = grid.getDataRows();
    return rows.map((row, i) => {
      const v = grid.getRowValue(row);
      return {
        idx: i + 1,
        atchmnflId: v.atchmnflId || '',
        purpose: (v.excutPurps || '').substring(0, 50),
        amount: v.excutSumAmount || v.lastAmount || '',
        vendor: (v.tradeCorpNm || '').substring(0, 25),
        bimok: v.budgetNm || '',
        semok: v.budgetDtlNm || '',
        evType: v.evdncSeNm || '',
      };
    });
  });

  if (!data) { console.log('NO GRID'); return; }
  console.log('Total: ' + data.length);
  const withFile = data.filter(d => d.atchmnflId).length;
  const noFile = data.filter(d => !d.atchmnflId).length;
  console.log('With atchmnflId: ' + withFile + ', Without: ' + noFile);
  console.log('---');
  for (const d of data) {
    console.log('R' + d.idx + ' | ' + (d.atchmnflId ? d.atchmnflId.substring(0, 15) : '(없음)') + ' | ' + d.amount + ' | ' + d.vendor + ' | ' + d.purpose);
  }
})().catch(e => console.error(e.message));
