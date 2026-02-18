process.on('unhandledRejection', () => {});
const { chromium } = require('playwright');
const { sleep, dismissModals, waitModal } = require('./lib/utils');

(async () => {
  const browser = await chromium.connectOverCDP('http://localhost:9444');
  const ctx = browser.contexts()[0];
  const page = ctx.pages()[0];
  if (!page) { console.log('페이지 없음'); return; }
  page.on('dialog', async d => { try { await d.accept(); } catch {} });

  // 현재 상세 페이지인지 확인
  const isDetail = await page.evaluate(() =>
    typeof DD001003SGridObj !== 'undefined'
  ).catch(() => false);
  console.log('상세 페이지:', isDetail);

  if (!isDetail) {
    console.log('상세 페이지가 아닙니다. 종료.');
    return;
  }

  // 현재 보완요청 설정 상태 확인
  const state = await page.evaluate(() => {
    const grid = DD001003SGridObj;
    const rows = grid.getDataRows();
    if (rows.length === 0) return null;
    const rv = grid.getRowValue(rows[0]);
    return {
      status: rv.exmntPrgstCode || rv.exmntPrgst,
      comment: rv.orgExclexCn,
      amount: rv.nrcgnAmount
    };
  });
  console.log('현재 상태:', JSON.stringify(state));

  // 저장 버튼 클릭
  console.log('저장 시도...');
  await page.click('#DD001003S_btnSave');
  await sleep(500);

  // 확인 모달 대기
  const confirmOk = await waitModal(page, 5000);
  console.log('확인 모달:', confirmOk ? '처리됨' : '미출현');

  if (!confirmOk) {
    // 에러 모달 체크
    await dismissModals(page);
    await sleep(1000);
    // 다시 시도
    await page.click('#DD001003S_btnSave');
    await sleep(500);
    const retry = await waitModal(page, 5000);
    console.log('재시도:', retry ? '처리됨' : '실패');
  }

  // AJAX 완료 대기 + 성공 모달
  await sleep(2000);
  const success = await waitModal(page, 10000);
  console.log('성공 모달:', success ? '처리됨' : '미출현');

  await sleep(1000);
  await dismissModals(page);

  // 목록으로 복귀
  await page.evaluate(() => {
    const btn = document.getElementById('DD001003S_btnList');
    if (btn) btn.click();
  });
  await sleep(3000);
  await dismissModals(page);

  console.log('R1 저장 및 복귀 완료');
})();
