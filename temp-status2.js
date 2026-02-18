const { connectBrowser, findEnaraPage, sleep, dismissModals, waitForGrid } = require('./lib/utils');
(async () => {
  const { context } = await connectBrowser();
  const page = await findEnaraPage(context);
  if (!page) { console.log('페이지 없음'); process.exit(1); }

  // 최종정산 상태에서 검색
  console.log('=== 최종정산 검색 ===');
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

  const finalCount = await page.evaluate(() => DD001002QGridObj.getDataRows().length).catch(() => 0);
  console.log('최종정산 행 수:', finalCount);

  // 중간정산 상태에서 검색
  console.log('\n=== 중간정산 검색 ===');
  await page.evaluate(() => {
    const r = document.getElementById('DD001002Q_excclcSeCode_2');
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

  const interimCount = await page.evaluate(() => DD001002QGridObj.getDataRows().length).catch(() => 0);
  console.log('중간정산 행 수:', interimCount);

  if (interimCount > 0) {
    const rows = await page.evaluate(() => {
      const grid = DD001002QGridObj;
      return grid.getDataRows().slice(0, 5).map((r, i) => {
        const v = grid.getRowValue(r);
        return { idx: i, status: v.exmntPrgstNm || '미처리', amount: v.lastAmount };
      });
    });
    for (const r of rows) console.log(`  [${r.idx}] ${r.status} ${r.amount}원`);
  }

  process.exit(0);
})();
