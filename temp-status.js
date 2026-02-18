const { connectBrowser, findEnaraPage } = require('./lib/utils');
(async () => {
  const { context } = await connectBrowser();
  const page = await findEnaraPage(context);
  if (!page) { console.log('페이지 없음'); process.exit(1); }
  console.log('URL:', page.url());

  const state = await page.evaluate(() => {
    const onExec = typeof DD001002QGridObj !== 'undefined';
    const onDetail = typeof DD001003SGridObj !== 'undefined';
    const onInspection = document.getElementById('DD001005Q_selBsnsyear') !== null;
    return { onExec, onDetail, onInspection };
  }).catch(() => ({ error: true }));
  console.log('상태:', JSON.stringify(state));

  if (state.onExec) {
    const radio = await page.evaluate(() => {
      const r1 = document.getElementById('DD001002Q_excclcSeCode_1');
      const r2 = document.getElementById('DD001002Q_excclcSeCode_2');
      return { final: r1 ? r1.checked : null, interim: r2 ? r2.checked : null };
    });
    console.log('정산구분:', JSON.stringify(radio));

    const count = await page.evaluate(() => DD001002QGridObj.getDataRows().length).catch(() => 0);
    console.log('그리드 행 수:', count);

    const rows = await page.evaluate(() => {
      const grid = DD001002QGridObj;
      return grid.getDataRows().slice(0, 5).map((r, i) => {
        const v = grid.getRowValue(r);
        return { idx: i, status: v.exmntPrgstNm || '미처리', amount: v.lastAmount, purpose: (v.excutPrposCn || '').substring(0, 30) };
      });
    }).catch(() => []);
    for (const r of rows) console.log(`  [${r.idx}] ${r.status} ${r.amount}원 ${r.purpose}`);
  }

  process.exit(0);
})();
