const { sleep, connectBrowser, findEnaraPage, dismissModals, waitForGrid } = require('../lib/utils');

(async () => {
  const { context } = await connectBrowser();
  const page = await findEnaraPage(context);
  await dismissModals(page);

  // 정산구분 중간정산 설정 + 검색
  await page.evaluate(() => {
    const r = document.getElementById('DD001002Q_excclcSeCode_2');
    if (r) r.click();
  });
  await sleep(1000);
  await page.evaluate(() => {
    const btn = document.getElementById('DD001002Q_btnRetrieve');
    if (btn) btn.click();
  });
  await sleep(4000);
  await dismissModals(page);
  await waitForGrid(page, 'DD001002QGridObj', 15000);

  // Dump all pages
  for (let pg = 1; pg <= 10; pg++) {
    if (pg > 1) {
      await page.evaluate((pn) => { f_retrieveListBsnsExcutDetl(pn); }, pg);
      await sleep(3000);
      await dismissModals(page);
      const ok = await waitForGrid(page, 'DD001002QGridObj', 10000);
      if (!ok) { console.log(`Page ${pg}: LOAD FAILED`); break; }
    }

    const rows = await page.evaluate(() => {
      const grid = DD001002QGridObj;
      const dataRows = grid.getDataRows();
      return dataRows.map((row, i) => {
        const rv = grid.getRowValue(row);
        return {
          idx: i,
          amt: rv.lastAmount || rv.excutSumAmount || rv.excutAmount || '',
          vendor: rv.bcncCmpnyNm || '',
          purpose: rv.excutPrposCn || '',
          statusCd: rv.exmntPrgstCd || '',
          statusNm: rv.exmntPrgstCdNm || rv.exmntPrgstNm || '',
        };
      });
    });

    if (rows.length === 0) { console.log(`Page ${pg}: empty → done`); break; }

    console.log(`\n=== Page ${pg}: ${rows.length} rows ===`);
    rows.forEach(r => {
      const status = (r.statusCd + '/' + r.statusNm).padEnd(15);
      console.log(`  ${String(r.idx).padStart(2)} | ${status} | ${String(r.amt).padStart(12)} | ${r.vendor.substring(0,20).padEnd(20)} | ${r.purpose.substring(0,35)}`);
    });

    const unprocessed = rows.filter(r => r.statusCd !== '001' && r.statusCd !== '002' && !/검토완료|보완요청/.test(r.statusNm));
    console.log(`  → 미처리: ${unprocessed.length}건`);
  }

  process.exit(0);
})();
