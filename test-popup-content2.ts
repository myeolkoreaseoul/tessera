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

  const viewCells = await ePage.$$('td.IBTextUnderline.HideCol0atchmnflTmp');
  console.log('[보기] 셀:', viewCells.length, '개');

  if (viewCells.length > 0) {
    const popupPromise = context.waitForEvent('page', { timeout: 10000 });
    await viewCells[0].click({ timeout: 5000 });

    const popup = await popupPromise;
    console.log('팝업 감지됨, URL 변경 대기...');

    // about:blank에서 실제 URL로 네비게이션 대기
    await popup.waitForURL(/gosims|getDB003/, { timeout: 15000 }).catch(() => {});
    console.log('팝업 URL:', popup.url());

    await popup.waitForLoadState('domcontentloaded', { timeout: 15000 });
    await popup.waitForTimeout(1000);

    const info = await popup.evaluate(() => {
      const links = Array.from(document.querySelectorAll('a')).map(a => ({
        text: a.textContent?.trim(),
        href: a.href,
        onclick: a.getAttribute('onclick')
      })).filter(l => l.text);

      const buttons = Array.from(document.querySelectorAll('button, input[type="button"]')).map(b => ({
        text: (b as HTMLElement).textContent?.trim() || (b as HTMLInputElement).value,
        onclick: b.getAttribute('onclick')
      }));

      return {
        title: document.title,
        links: links.slice(0, 15),
        buttons,
        bodyPreview: document.body?.innerText?.substring(0, 800)
      };
    });

    console.log('\n=== 팝업 내용 ===');
    console.log('제목:', info.title);
    console.log('\n링크:', JSON.stringify(info.links, null, 2));
    console.log('\n버튼:', JSON.stringify(info.buttons, null, 2));
    console.log('\n본문:');
    console.log(info.bodyPreview);

    await popup.screenshot({ path: 'C:/projects/e-naradomum-rpa/popup-screenshot.png' });
    console.log('\n스크린샷 저장됨');

    await popup.close();
  }

  await browser.close();
}

test().catch(console.error);
