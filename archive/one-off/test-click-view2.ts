import { chromium } from 'playwright';

async function test() {
  const browser = await chromium.connectOverCDP('http://localhost:9444');
  const context = browser.contexts()[0];
  const ePage = context.pages().find(p => p.url().includes('gosims'));

  if (!ePage) { console.log('페이지 없음'); await browser.close(); return; }

  // popupMask 제거
  await ePage.evaluate(() => {
    document.querySelectorAll('.popupMask.on').forEach(el => {
      (el as HTMLElement).classList.remove('on');
      (el as HTMLElement).style.display = 'none';
    });
  });

  // 정확한 [보기] 셀 찾기 - IBTextUnderline 클래스 + atchmnflTmp 컬럼
  const viewCells = await ePage.$$('td.IBTextUnderline.HideCol0atchmnflTmp');
  console.log('[보기] 셀:', viewCells.length, '개');

  if (viewCells.length === 0) {
    // 폴백: IBTextUnderline 클래스의 TD 중 [보기] 텍스트 포함
    const fallback = await ePage.$$('td.IBTextUnderline');
    console.log('IBTextUnderline TD:', fallback.length, '개');
    for (const cell of fallback.slice(0, 3)) {
      const text = await cell.textContent();
      console.log(' 텍스트:', text?.trim());
    }
  }

  if (viewCells.length > 0) {
    const text = await viewCells[0].textContent();
    console.log('첫 번째 셀 텍스트:', text?.trim());

    console.log('\n클릭...');
    const popupPromise = context.waitForEvent('page', { timeout: 5000 }).catch(() => null);
    await viewCells[0].click({ force: true });

    const newPage = await popupPromise;
    if (newPage) {
      console.log('팝업 열림:', newPage.url());
      await newPage.waitForLoadState('domcontentloaded');

      const info = await newPage.evaluate(() => {
        const links = Array.from(document.querySelectorAll('a')).map(a => ({
          text: a.textContent?.trim(),
          href: a.href
        })).filter(l => l.text);
        const buttons = Array.from(document.querySelectorAll('button, input[type="button"]')).map(b =>
          (b as HTMLElement).textContent?.trim() || (b as HTMLInputElement).value
        );
        return { links: links.slice(0, 10), buttons, bodyPreview: document.body?.innerText?.substring(0, 300) };
      });
      console.log('\n팝업 내용:', JSON.stringify(info, null, 2));
      await newPage.screenshot({ path: 'C:/projects/e-naradomum-rpa/popup-screenshot.png' });
      console.log('스크린샷 저장됨');
      await newPage.close();
    } else {
      console.log('팝업 안 열림');

      // 알림 확인
      const mask = await ePage.$('.popupMask.on');
      if (mask) {
        const maskText = await mask.textContent();
        console.log('알림:', maskText?.trim().substring(0, 200));
      }

      // 모든 페이지 확인
      console.log('현재 페이지들:');
      for (const p of context.pages()) {
        console.log(' -', p.url().substring(0, 100));
      }
    }
  }

  await browser.close();
}

test().catch(console.error);
