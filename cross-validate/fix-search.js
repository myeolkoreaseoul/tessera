const { sleep, connectBrowser, findEnaraPage, dismissModals, waitForGrid } = require('../lib/utils');

(async () => {
  const { context } = await connectBrowser();
  const page = await findEnaraPage(context);
  console.log('URL:', page.url());
  await dismissModals(page);

  // 올바른 검색 버튼으로 클릭
  console.log('검색 버튼 클릭 (DD001002Q_btnRetrieveList)...');
  await page.evaluate(() => {
    const btn = document.getElementById('DD001002Q_btnRetrieveList') ||
                document.getElementById('DD001002Q_btnRetrieve') ||
                [...document.querySelectorAll('button')].find(b => b.textContent.trim() === '검색' && b.offsetWidth > 0);
    if (btn) { console.log('Clicking:', btn.id); btn.click(); }
    else console.log('No search button found');
  });
  await sleep(5000);
  await dismissModals(page);

  const rows = await page.evaluate(() => {
    try { return DD001002QGridObj.getDataRows().length; } catch(e) { return -1; }
  });
  console.log('검색 결과:', rows, '행');

  if (rows > 0) {
    // Quick scan
    for (let pg = 1; pg <= 10; pg++) {
      if (pg > 1) {
        await page.evaluate((pn) => { f_retrieveListBsnsExcutDetl(pn); }, pg);
        await sleep(3000);
        await dismissModals(page);
        const ok = await waitForGrid(page, 'DD001002QGridObj', 10000);
        if (!ok) break;
      }

      const data = await page.evaluate(() => {
        const grid = DD001002QGridObj;
        const rows = grid.getDataRows();
        let unproc = 0;
        rows.forEach(row => {
          const rv = grid.getRowValue(row);
          const s = rv.exmntPrgstCdNm || rv.exmntPrgstNm || '';
          if (!/검토완료|보완요청|검토불필요/.test(s)) unproc++;
        });
        return { total: rows.length, unproc };
      });
      if (data.total === 0) break;
      console.log(`  P${pg}: ${data.total}행, 미처리 ${data.unproc}건`);
    }
  }

  process.exit(0);
})();
