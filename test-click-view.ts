import { chromium } from 'playwright';

async function test() {
  const browser = await chromium.connectOverCDP('http://localhost:9444');
  const context = browser.contexts()[0];
  const pages = context.pages();
  const ePage = pages.find(p => p.url().includes('gosims'));

  if (!ePage) {
    console.log('e나라도움 페이지 없음');
    await browser.close();
    return;
  }

  console.log('e나라도움 발견:', ePage.url().substring(0, 80));

  // popupMask 제거
  await ePage.evaluate(() => {
    document.querySelectorAll('.popupMask.on').forEach(el => {
      (el as HTMLElement).classList.remove('on');
      (el as HTMLElement).style.display = 'none';
    });
  });

  // 팝업 이벤트 리스너 등록
  context.on('page', (newPage) => {
    console.log('새 페이지 이벤트:', newPage.url());
  });

  // window.open 감시
  await ePage.evaluate(() => {
    const origOpen = window.open;
    (window as any).__popupUrls = [];
    window.open = function(...args) {
      console.log('window.open 호출:', args[0]);
      (window as any).__popupUrls.push(args[0]);
      return origOpen.apply(this, args);
    };
  });

  const viewCells = await ePage.$$('td:has-text("[보기]")');
  console.log('[보기] 셀:', viewCells.length, '개');

  if (viewCells.length > 0) {
    // 셀의 HTML 확인
    const cellInfo = await viewCells[0].evaluate(el => ({
      html: el.outerHTML,
      onclick: el.getAttribute('onclick'),
      classes: el.className
    }));
    console.log('\n첫 번째 셀 정보:', JSON.stringify(cellInfo, null, 2));

    // 클릭
    console.log('\n클릭 시도...');

    // popup 이벤트 대기 (타임아웃 짧게)
    const popupPromise = ePage.waitForEvent('popup', { timeout: 5000 }).catch(() => null);

    await viewCells[0].click({ force: true });
    await ePage.waitForTimeout(3000);

    const popup = await popupPromise;
    if (popup) {
      console.log('popup 이벤트로 팝업 감지:', popup.url());
    }

    // 모든 페이지 다시 확인
    const allPages = context.pages();
    console.log('\n현재 모든 페이지:');
    for (const p of allPages) {
      console.log(' -', p.url().substring(0, 100));
    }

    // window.open 호출 확인
    const popupUrls = await ePage.evaluate(() => (window as any).__popupUrls);
    console.log('\nwindow.open 호출 URL:', popupUrls);

    // 알림 팝업 확인
    const maskCheck = await ePage.evaluate(() => {
      const mask = document.querySelector('.popupMask.on');
      if (mask) return mask.innerHTML.substring(0, 300);
      return null;
    });
    if (maskCheck) {
      console.log('\n알림 팝업 발견:', maskCheck);
    }
  }

  await browser.close();
}

test().catch(console.error);
