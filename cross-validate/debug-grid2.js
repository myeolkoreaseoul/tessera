const { sleep, connectBrowser, findEnaraPage, dismissModals, waitForGrid } = require('../lib/utils');

(async () => {
  const { context } = await connectBrowser();
  const page = await findEnaraPage(context);
  console.log('URL:', page.url());
  await dismissModals(page);

  // Check current page state
  const state = await page.evaluate(() => {
    const r1 = document.getElementById('DD001002Q_excclcSeCode_1');
    const r2 = document.getElementById('DD001002Q_excclcSeCode_2');
    const grid = typeof DD001002QGridObj !== 'undefined' ? DD001002QGridObj : null;
    return {
      r1checked: r1 ? r1.checked : null,
      r2checked: r2 ? r2.checked : null,
      r1exists: !!r1,
      r2exists: !!r2,
      gridExists: !!grid,
      gridRows: grid ? grid.getDataRows().length : 0,
    };
  }).catch(e => ({ error: e.message }));
  console.log('State:', JSON.stringify(state, null, 2));

  // If grid has no data, click 중간정산 radio and search
  if (state.gridRows === 0) {
    console.log('\n그리드 비어있음 → 중간정산 + 검색');

    // Click 중간정산 radio
    await page.evaluate(() => {
      const r2 = document.getElementById('DD001002Q_excclcSeCode_2');
      if (r2) { r2.checked = true; r2.click(); r2.dispatchEvent(new Event('change')); }
    });
    await sleep(1000);

    // Click search
    await page.evaluate(() => {
      const btn = document.getElementById('DD001002Q_btnRetrieve');
      if (btn) btn.click();
    });
    await sleep(5000);
    await dismissModals(page);

    const rows = await page.evaluate(() => {
      try { return DD001002QGridObj.getDataRows().length; } catch(e) { return -1; }
    });
    console.log('검색 후 rows:', rows);
  }

  // If still empty, try clicking the search button more aggressively
  const rows2 = await page.evaluate(() => {
    try { return DD001002QGridObj.getDataRows().length; } catch(e) { return -1; }
  });

  if (rows2 <= 0) {
    console.log('\n여전히 비어있음 → 검색 버튼 재클릭');
    await page.evaluate(() => {
      const btns = [...document.querySelectorAll('button')];
      const btn = btns.find(b => b.textContent.trim() === '검색' && b.offsetWidth > 0);
      if (btn) { console.log('Found search btn'); btn.click(); }
    });
    await sleep(5000);
    await dismissModals(page);

    const rows3 = await page.evaluate(() => {
      try { return DD001002QGridObj.getDataRows().length; } catch(e) { return -1; }
    });
    console.log('최종 rows:', rows3);
  }

  // Dump what we have
  const finalRows = await page.evaluate(() => {
    try {
      const grid = DD001002QGridObj;
      const dataRows = grid.getDataRows();
      return dataRows.slice(0, 5).map((row, i) => {
        const rv = grid.getRowValue(row);
        return {
          idx: i,
          amt: rv.lastAmount || rv.excutSumAmount || '',
          vendor: rv.bcncCmpnyNm || '',
          purpose: rv.excutPrposCn || '',
          statusNm: rv.exmntPrgstCdNm || '',
        };
      });
    } catch(e) { return []; }
  });
  console.log('\nSample rows:', JSON.stringify(finalRows, null, 2));

  process.exit(0);
})();
