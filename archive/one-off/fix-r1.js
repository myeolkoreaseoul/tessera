process.on('unhandledRejection', () => {});
const { chromium } = require('playwright');
const { sleep, dismissModals, waitForGrid } = require('./lib/utils');

(async () => {
  const browser = await chromium.connectOverCDP('http://localhost:9444');
  const ctx = browser.contexts()[0];
  const page = ctx.pages().find(p => p.url().includes('gosims') && p.url().indexOf('getDB003002SView') === -1);
  if (!page) { console.log('페이지 없음'); return; }
  page.on('dialog', async d => { try { await d.accept(); } catch {} });

  // 페이지 1로 이동
  await page.evaluate(() => { try { f_retrieveListBsnsExcutDetl(1); } catch {} });
  await sleep(3000);
  await dismissModals(page);

  // 인덱스 0 선택 (grid.focus)
  const rowInfo = await page.evaluate(() => {
    const grid = DD001002QGridObj;
    const rows = grid.getDataRows();
    const row = rows[0];
    const rv = grid.getRowValue(row);
    grid.focus(row);
    return { purpose: rv.excutPrposCn, vendor: rv.dpstrNm || rv.bcncCmpnyNm, amount: rv.lastAmount, status: rv.exmntPrgstNm };
  });
  console.log('선택:', JSON.stringify(rowInfo));
  await sleep(500);

  // focused row 확인
  const focused = await page.evaluate(() => {
    const grid = DD001002QGridObj;
    const fr = grid.getFocusedRow();
    if (!fr) return null;
    return grid.getRowValue(fr).excutPrposCn;
  });
  console.log('focused:', focused);

  if (!focused) {
    console.log('ERROR: focus 실패');
    return;
  }

  // 세부내역검토 클릭
  await page.click('#DD001002Q_detlListExmnt');
  await sleep(3000);
  await dismissModals(page);

  // 모달 체크
  const modalText = await page.evaluate(() => {
    const m = document.querySelector('.popupMask.on');
    if (!m) return null;
    return m.textContent.replace(/\s+/g, ' ').trim();
  });

  if (modalText && (modalText.includes('에러') || modalText.includes('선택해주세요'))) {
    console.log('모달 에러:', modalText);
    await page.evaluate(() => {
      const m = document.querySelector('.popupMask.on');
      if (m) { const b = m.querySelector('button'); if (b) b.click(); }
    });
    return;
  }

  // 상세 페이지 로드 대기
  for (let i = 0; i < 10; i++) {
    const hasDetail = await page.evaluate(() =>
      typeof DD001003SGridObj !== 'undefined' || document.getElementById('DD001003S_orgExclexCn') !== null
    ).catch(() => false);
    if (hasDetail) break;
    await sleep(1000);
  }
  await sleep(2000);
  await dismissModals(page);

  // 보완요청 설정
  const comment = '자문의견서 미첨부; 자문확인서 미첨부';
  await page.evaluate(({ cmt }) => {
    f_changeExmntPrgst('002');
    const grid = DD001003SGridObj;
    const rows = grid.getDataRows();
    if (rows.length > 0) {
      const row = rows[0];
      grid.setValue(row, 'nrcgnAmount', 0);
      const htmlComment = '<p>' + cmt.replace(/;/g, '<br>') + '</p>';
      grid.setValue(row, 'orgExclexCn', htmlComment);
    }
  }, { cmt: comment });
  console.log('보완요청 설정 완료');

  // 저장
  await page.evaluate(() => f_saveDD001003S());
  await sleep(3000);
  await dismissModals(page);

  const successModal = await page.evaluate(() => {
    const m = document.querySelector('.popupMask.on');
    if (m && m.textContent.includes('저장')) {
      const btn = m.querySelector('button');
      if (btn) btn.click();
      return true;
    }
    return false;
  });
  console.log('저장:', successModal ? '성공' : '모달 미출현');

  // 목록으로 복귀
  await sleep(1000);
  await page.evaluate(() => {
    const btn = document.getElementById('DD001003S_btnList');
    if (btn) btn.click();
  });
  await sleep(3000);
  await dismissModals(page);
  console.log('R1 처리 완료');
})();
