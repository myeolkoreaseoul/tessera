const nav = require('./lib/navigate');
const { sleep, dismissModals, waitForGrid } = require('./lib/utils');

(async () => {
  const { page } = await nav.goToInstitution({
    institutionName: '신라시스템',
    projectKeyword: '2차년도',
    year: 2025,
  });

  // 최종정산 검색
  console.log('\n=== 최종정산 전체 상태 ===');
  await page.evaluate(() => {
    const r = document.getElementById('DD001002Q_excclcSeCode_1');
    if (r && !r.checked) r.click();
  });
  await sleep(500);
  await page.evaluate(() => {
    const btn = document.getElementById('DD001002Q_btnRetrieve');
    if (btn) btn.click();
    else {
      const btns = [...document.querySelectorAll('button')];
      const s = btns.find(b => b.textContent.trim() === '검색' && b.getBoundingClientRect().width > 0);
      if (s) s.click();
    }
  });
  await sleep(4000);
  await dismissModals(page);
  await waitForGrid(page, 'DD001002QGridObj', 15000);

  let total = 0;
  let statusMap = {};
  let pageNum = 1;
  while (true) {
    const data = await page.evaluate(() => {
      const grid = DD001002QGridObj;
      return grid.getDataRows().map(r => {
        const v = grid.getRowValue(r);
        return { status: v.exmntPrgstNm || '미처리' };
      });
    });
    for (const d of data) statusMap[d.status] = (statusMap[d.status] || 0) + 1;
    total += data.length;
    if (data.length < 20) break;
    pageNum++;
    await page.evaluate((pn) => f_retrieveListBsnsExcutDetl(pn), pageNum);
    await sleep(3000);
    await dismissModals(page);
    await waitForGrid(page, 'DD001002QGridObj');
  }

  console.log(`총 ${total}건`);
  for (const [k, v] of Object.entries(statusMap)) console.log(`  ${k}: ${v}건`);

  nav.stopKeepAlive();
  process.exit(0);
})().catch(e => { console.error('Error:', e.message); process.exit(1); });
