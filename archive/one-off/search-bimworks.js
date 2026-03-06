process.on('unhandledRejection', () => {});
const { sleep, connectBrowser, dismissModals, waitForGrid } = require('./lib/utils');

(async () => {
  const { context } = await connectBrowser();
  const page = context.pages().find(p => p.url().includes('gosims') && !p.url().includes('getDB003002SView'));
  if (!page) { console.log('페이지 없음'); return; }
  page.on('dialog', async d => { try { await d.accept(); } catch {} });

  // DD001005Q 검색 - 사업명으로 "빔웍스" 검색
  // 기관명 비우고, 사업명에 입력
  await page.fill('#DD001005Q_srcExcInsttNm', '');
  await page.fill('#DD001005Q_srcTaskNm', '빔웍스');
  await sleep(300);
  await page.click('#DD001005Q_btnRetrieveChckTrgetBsnsList');
  await sleep(3000);
  await dismissModals(page);
  await waitForGrid(page, 'DD001005QGridObj', 10000);

  const results = await page.evaluate(() => {
    const grid = window.DD001005QGridObj;
    if (!grid) return [];
    const rows = grid.getDataRows();
    return rows.map((row, i) => {
      const rv = grid.getRowValue(row);
      return {
        idx: i,
        taskNm: rv.taskNm || '',
        excInsttNm: rv.excInsttNm || '',
        status: rv.excutLmttResnNm || '',
      };
    });
  });

  console.log('=== "빔웍스" 사업명 검색결과 (' + results.length + '건) ===');
  for (const r of results) {
    console.log('  [' + r.idx + '] ' + r.excInsttNm + ' | ' + r.status + ' | ' + r.taskNm);
  }
})();
