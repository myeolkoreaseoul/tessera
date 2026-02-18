const nav = require('./lib/navigate');
const { sleep, connectBrowser, findEnaraPage, dismissModals, waitForGrid } = require('./lib/utils');

(async () => {
  // 1. 네비게이션
  const { page } = await nav.goToInstitution({
    institutionName: '메디웨일',
    projectKeyword: '1차년도',
    year: 2025,
  });

  // 2. 최종정산 설정
  await page.evaluate(() => {
    const r = document.getElementById('DD001002Q_excclcSeCode_1');
    if (r && !r.checked) r.click();
  });
  await sleep(500);
  await page.evaluate(() => {
    const btns = [...document.querySelectorAll('button')];
    const s = btns.find(b => b.textContent.trim() === '검색' && b.getBoundingClientRect().width > 0);
    if (s) s.click();
  });
  await sleep(4000);
  await dismissModals(page);
  await waitForGrid(page, 'DD001002QGridObj', 15000);

  // 3. 첫 번째 행 focus
  const rowInfo = await page.evaluate(() => {
    const grid = DD001002QGridObj;
    const rows = grid.getDataRows();
    if (rows.length === 0) return null;
    grid.focus(rows[0]);
    const rv = grid.getRowValue(rows[0]);
    const focused = grid.getFocusedRow();
    return { rv, focused: focused !== null, rowCount: rows.length };
  });
  console.log('행 정보:', JSON.stringify(rowInfo, null, 2));

  // 4. 세부내역검토 클릭
  console.log('세부내역검토 클릭...');
  await page.click('#DD001002Q_detlListExmnt');
  await sleep(5000);

  // 5. 현재 상태 확인
  const afterState = await page.evaluate(() => {
    const hasDetail = typeof DD001003SGridObj !== 'undefined' && DD001003SGridObj.getDataRows().length > 0;
    const modal = document.querySelector('.popupMask.on');
    const modalText = modal ? modal.textContent.trim().substring(0, 100) : null;
    const url = location.href;
    return { hasDetail, modalText, url };
  }).catch(e => ({ error: e.message }));
  console.log('상세 페이지 상태:', JSON.stringify(afterState, null, 2));

  if (afterState.modalText) {
    console.log('모달 닫기...');
    await dismissModals(page);
    await sleep(1000);
  }

  // 6. 한번 더 대기
  if (!afterState.hasDetail) {
    console.log('상세 그리드 추가 대기...');
    const ok = await waitForGrid(page, 'DD001003SGridObj', 10000);
    console.log('추가 대기 결과:', ok);
  }

  nav.stopKeepAlive();
  process.exit(0);
})().catch(e => { console.error('Error:', e.message); process.exit(1); });
