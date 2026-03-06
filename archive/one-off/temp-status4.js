const { connectBrowser, findEnaraPage, sleep, dismissModals, waitForGrid } = require('./lib/utils');

(async () => {
  const { context } = await connectBrowser();
  const page = await findEnaraPage(context);
  if (!page) { console.log('페이지 없음'); process.exit(1); }

  // 최종정산 선택 후 검색
  await page.evaluate(() => {
    const r = document.getElementById('DD001002Q_excclcSeCode_1');
    if (r && !r.checked) r.click();
  });
  await sleep(500);
  await page.evaluate(() => {
    const b = document.getElementById('DD001002Q_btnRetrieve');
    if (b) b.click();
  });
  await sleep(4000);
  await dismissModals(page);
  await waitForGrid(page, 'DD001002QGridObj', 10000);

  let total = 0;
  let statusMap = {};
  let pageNum = 1;

  while (true) {
    const data = await page.evaluate(() => {
      const grid = DD001002QGridObj;
      return grid.getDataRows().map((r, i) => {
        const v = grid.getRowValue(r);
        return { status: v.exmntPrgstNm || '미처리' };
      });
    });

    for (const d of data) {
      statusMap[d.status] = (statusMap[d.status] || 0) + 1;
    }
    total += data.length;
    console.log(`페이지 ${pageNum}: ${data.length}건`);

    if (data.length < 20) break;
    pageNum++;
    await page.evaluate((pn) => f_retrieveListBsnsExcutDetl(pn), pageNum);
    await sleep(3000);
    await dismissModals(page);
    await waitForGrid(page, 'DD001002QGridObj');
  }

  console.log(`\n총 ${total}건 (최종정산)`);
  for (const [k, v] of Object.entries(statusMap)) {
    console.log(`  ${k}: ${v}건`);
  }

  process.exit(0);
})().catch(e => { console.error('Error:', e.message); process.exit(1); });
