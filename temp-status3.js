const nav = require('./lib/navigate');
const { sleep, dismissModals, waitForGrid } = require('./lib/utils');

(async () => {
  // 네비게이션으로 신라시스템 2차년도 진입
  const { page } = await nav.goToInstitution({
    institutionName: '신라시스템',
    projectKeyword: '2차년도',
    year: 2025,
  });

  // 최종정산 검색
  console.log('\n=== 최종정산 검색 ===');
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
  if (finalCount > 0) {
    const rows = await page.evaluate(() => {
      const grid = DD001002QGridObj;
      return grid.getDataRows().slice(0, 3).map((r, i) => {
        const v = grid.getRowValue(r);
        return { idx: i, status: v.exmntPrgstNm || '미처리', amount: v.lastAmount };
      });
    });
    for (const r of rows) console.log(`  [${r.idx}] ${r.status} ${r.amount}원`);
  }

  // 중간정산 검색
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
      return grid.getDataRows().slice(0, 3).map((r, i) => {
        const v = grid.getRowValue(r);
        return { idx: i, status: v.exmntPrgstNm || '미처리', amount: v.lastAmount };
      });
    });
    for (const r of rows) console.log(`  [${r.idx}] ${r.status} ${r.amount}원`);
  }

  console.log('\n결론: 최종정산=' + finalCount + '건, 중간정산=' + interimCount + '건');
  process.exit(0);
})().catch(e => { console.error('Error:', e.message); process.exit(1); });
