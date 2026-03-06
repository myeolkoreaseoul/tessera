const { sleep, connectBrowser, findEnaraPage, dismissModals, waitForGrid } = require('./lib/utils');
(async () => {
  try {
    const { context } = await connectBrowser();
    const page = await findEnaraPage(context);
    if (!page) { console.log('페이지 없음'); process.exit(1); }
    console.log('URL:', page.url());

    // 현재 그리드 상태 그대로 확인
    const ready = await waitForGrid(page, 'DD001002QGridObj', 5000);
    if (!ready) {
      console.log('그리드 없음, 검색 시도...');
      await page.evaluate(() => {
        const btn = document.getElementById('DD001002Q_btnRetrieve');
        if (btn) btn.click();
      });
      await sleep(4000);
      await dismissModals(page);
      await waitForGrid(page, 'DD001002QGridObj', 15000);
    }

    // 모든 페이지의 모든 행 상태 출력
    let pageNum = 1;
    while (true) {
      const data = await page.evaluate(() => {
        const grid = DD001002QGridObj;
        return grid.getDataRows().map((r, i) => {
          const v = grid.getRowValue(r);
          return {
            idx: i,
            status: v.exmntPrgstNm || '(없음)',
            amount: v.lastAmount,
            purpose: (v.excutPrposCn || '').substring(0, 30),
          };
        });
      });
      console.log(`\n=== 페이지 ${pageNum} (${data.length}건) ===`);
      for (const d of data) {
        console.log(`  [${d.idx}] ${d.status.padEnd(8)} ${String(d.amount).padStart(12)}원 ${d.purpose}`);
      }
      if (data.length < 20) break;
      pageNum++;
      await page.evaluate((pn) => f_retrieveListBsnsExcutDetl(pn), pageNum);
      await sleep(3000);
      await dismissModals(page);
      await waitForGrid(page, 'DD001002QGridObj');
    }

    // 정산구분 라디오 상태도 확인
    const radioState = await page.evaluate(() => {
      const r1 = document.getElementById('DD001002Q_excclcSeCode_1');
      const r2 = document.getElementById('DD001002Q_excclcSeCode_2');
      return {
        final: r1 ? r1.checked : null,
        interim: r2 ? r2.checked : null,
      };
    });
    console.log('\n정산구분:', radioState.interim ? '중간정산' : radioState.final ? '최종정산' : '알수없음');

  } catch(e) { console.error('Error:', e.message); }
  process.exit(0);
})();
