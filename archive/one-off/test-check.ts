import { chromium } from 'playwright';

async function check() {
  const browser = await chromium.connectOverCDP('http://localhost:9444');
  const pages = browser.contexts()[0].pages();
  console.log('페이지 수:', pages.length);
  for (const p of pages) console.log(' -', p.url().substring(0, 100));

  const ePage = pages.find(p => p.url().includes('gosims'));
  if (ePage) {
    console.log('\ne나라도움 페이지 발견!');

    // popupMask 확인 및 닫기
    const hasMask = await ePage.evaluate(() => {
      const mask = document.querySelector('.popupMask.on') as HTMLElement;
      if (mask) {
        mask.classList.remove('on');
        mask.style.display = 'none';
        return true;
      }
      return false;
    });
    if (hasMask) console.log('popupMask 제거됨');

    const viewCells = await ePage.$$('td:has-text("[보기]")');
    console.log('[보기] 셀:', viewCells.length, '개');

    if (viewCells.length > 0) {
      console.log('\n첫 번째 [보기] 클릭 시도...');
      const context = browser.contexts()[0];
      const pagesBefore = context.pages().length;

      await viewCells[0].click({ force: true, timeout: 5000 });
      await ePage.waitForTimeout(3000);

      const pagesAfter = context.pages();
      console.log('페이지 수 변화:', pagesBefore, '->', pagesAfter.length);

      const popup = pagesAfter.find(p => p.url().includes('getDB003002SView'));
      if (popup) {
        console.log('팝업 열림! URL:', popup.url());
        await popup.waitForLoadState('domcontentloaded');

        // 팝업 내용 확인
        const info = await popup.evaluate(() => {
          const links = document.querySelectorAll('a');
          const buttons = document.querySelectorAll('button, input[type="button"]');
          const tables = document.querySelectorAll('table');
          return {
            links: Array.from(links).map(a => ({ text: a.textContent?.trim(), href: a.href })).slice(0, 10),
            buttons: Array.from(buttons).map(b => (b as HTMLElement).textContent?.trim() || (b as HTMLInputElement).value).slice(0, 10),
            tables: tables.length,
            bodyText: document.body?.innerText?.substring(0, 500)
          };
        });
        console.log('\n팝업 내용:');
        console.log(JSON.stringify(info, null, 2));

        await popup.screenshot({ path: 'C:/projects/e-naradomum-rpa/popup-screenshot.png' });
        console.log('스크린샷 저장: popup-screenshot.png');

        await popup.close();
      } else {
        console.log('팝업 안 열림');
        // 알림 확인
        const alert = await ePage.$('.popupMask.on');
        if (alert) {
          console.log('알림 팝업이 떴을 수 있음');
          const alertText = await alert.textContent();
          console.log('알림 내용:', alertText?.substring(0, 200));
        }
      }
    }
  } else {
    console.log('e나라도움 페이지를 찾을 수 없습니다.');
    console.log('집행내역 화면까지 이동해주세요.');
  }

  await browser.close();
}

check().catch(console.error);
