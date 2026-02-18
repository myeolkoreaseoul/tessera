const { sleep, connectBrowser, findEnaraPage, dismissModals, waitForGrid } = require('../lib/utils');

(async () => {
  const { context } = await connectBrowser();
  const page = await findEnaraPage(context);
  console.log('URL:', page.url());

  // 페이지 리로드
  console.log('페이지 리로드...');
  await page.reload({ waitUntil: 'domcontentloaded', timeout: 30000 });
  await sleep(5000);
  await dismissModals(page);

  // 중간정산 라디오 설정
  console.log('중간정산 설정...');
  await page.evaluate(() => {
    const r2 = document.getElementById('DD001002Q_excclcSeCode_2');
    if (r2) { r2.checked = true; r2.click(); }
  });
  await sleep(1000);

  // 검색
  console.log('검색 클릭...');
  await page.evaluate(() => {
    const btn = document.getElementById('DD001002Q_btnRetrieve');
    if (btn) btn.click();
  });
  await sleep(5000);
  await dismissModals(page);

  const rows = await page.evaluate(() => {
    try { return DD001002QGridObj.getDataRows().length; } catch(e) { return -1; }
  });
  console.log('검색 결과 rows:', rows);

  if (rows > 0) {
    // 전체 페이지 미처리 스캔
    let allUnprocessed = 0;
    for (let pg = 1; pg <= 10; pg++) {
      if (pg > 1) {
        await page.evaluate((pn) => { f_retrieveListBsnsExcutDetl(pn); }, pg);
        await sleep(3000);
        await dismissModals(page);
      }

      const pageData = await page.evaluate(() => {
        const grid = DD001002QGridObj;
        const dataRows = grid.getDataRows();
        let unprocessed = 0;
        const items = dataRows.map((row, i) => {
          const rv = grid.getRowValue(row);
          const statusNm = rv.exmntPrgstCdNm || rv.exmntPrgstNm || '(none)';
          const isProcessed = /검토완료|보완요청|검토불필요/.test(statusNm);
          if (!isProcessed) unprocessed++;
          return `${String(i).padStart(2)} | ${statusNm.padEnd(10)} | ${(rv.lastAmount||rv.excutSumAmount||'').toString().padStart(12)} | ${(rv.bcncCmpnyNm||'').substring(0,20).padEnd(20)} | ${(rv.excutPrposCn||'').substring(0,35)}`;
        });
        return { items, unprocessed, total: dataRows.length };
      });

      if (pageData.total === 0) { console.log(`Page ${pg}: empty`); break; }
      console.log(`\n=== Page ${pg}: ${pageData.total}행, 미처리 ${pageData.unprocessed}건 ===`);
      pageData.items.forEach(line => console.log('  ' + line));
      allUnprocessed += pageData.unprocessed;
    }
    console.log(`\n총 미처리: ${allUnprocessed}건`);
  }

  process.exit(0);
})();
