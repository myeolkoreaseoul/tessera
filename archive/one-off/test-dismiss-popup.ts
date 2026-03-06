import { chromium } from 'playwright';

async function testDismissPopup() {
  const browser = await chromium.connectOverCDP('http://localhost:9222');
  const contexts = browser.contexts();
  const pages = contexts[0].pages();

  for (const page of pages) {
    const url = page.url();
    if (url.includes('gosims') || url.includes('naradomum')) {
      console.log('e나라도움 페이지 발견\n');

      // popupMask 상태 확인
      const maskInfo = await page.evaluate(() => {
        const mask = document.querySelector('.popupMask');
        if (!mask) return { exists: false };

        const hasOnClass = mask.classList.contains('on');
        const display = getComputedStyle(mask).display;
        const html = mask.innerHTML.substring(0, 500);

        // 내부 버튼들 찾기
        const buttons = mask.querySelectorAll('button, input[type="button"]');
        const btnTexts = Array.from(buttons).map(b =>
          (b as HTMLElement).textContent || (b as HTMLInputElement).value
        );

        return { exists: true, hasOnClass, display, html, btnTexts };
      });

      console.log('팝업 마스크 정보:', JSON.stringify(maskInfo, null, 2));

      if (maskInfo.exists && maskInfo.hasOnClass) {
        console.log('\n알림 팝업 닫기 시도...');

        // 방법 1: 버튼 직접 클릭 (force 옵션 사용)
        const btn = await page.$('.popupMask.on button, .popupMask.on input[type="button"]');
        if (btn) {
          console.log('버튼 발견, force 클릭 시도...');
          await btn.click({ force: true });
          await page.waitForTimeout(500);
        }

        // 확인 후 상태
        const afterState = await page.evaluate(() => {
          const mask = document.querySelector('.popupMask');
          return mask ? mask.classList.contains('on') : false;
        });
        console.log('닫기 후 on 클래스:', afterState);

        if (afterState) {
          // 방법 2: JavaScript로 직접 닫기
          console.log('JavaScript로 직접 닫기 시도...');
          await page.evaluate(() => {
            const mask = document.querySelector('.popupMask');
            if (mask) {
              mask.classList.remove('on');
              (mask as HTMLElement).style.display = 'none';
            }
          });

          const finalState = await page.evaluate(() => {
            const mask = document.querySelector('.popupMask');
            return mask ? mask.classList.contains('on') : false;
          });
          console.log('JS 닫기 후 on 클래스:', finalState);
        }
      }

      // [보기] 셀 클릭 테스트
      console.log('\n[보기] 셀 클릭 테스트...');
      const viewCells = await page.$$('td:has-text("[보기]")');
      console.log(`[보기] 셀 ${viewCells.length}개 발견`);

      if (viewCells.length > 0) {
        try {
          // 클릭 전 페이지 수
          const pagesBefore = contexts[0].pages().length;

          await viewCells[0].click({ timeout: 5000 });
          console.log('클릭 성공!');

          await page.waitForTimeout(2000);

          // 새 페이지 확인
          const pagesAfter = contexts[0].pages();
          console.log(`페이지 수: ${pagesBefore} -> ${pagesAfter.length}`);

          for (const p of pagesAfter) {
            const pUrl = p.url();
            if (pUrl.includes('getDB003002SView')) {
              console.log('\n첨부파일 팝업 열림!');
              console.log('URL:', pUrl);

              // 팝업 내용 확인
              await p.waitForLoadState('domcontentloaded');
              const popupInfo = await p.evaluate(() => {
                const tables = document.querySelectorAll('table');
                const links = document.querySelectorAll('a');
                const buttons = document.querySelectorAll('button, input[type="button"]');

                return {
                  tableCount: tables.length,
                  linkCount: links.length,
                  linkTexts: Array.from(links).slice(0, 5).map(a => a.textContent?.trim()),
                  buttonTexts: Array.from(buttons).map(b =>
                    (b as HTMLElement).textContent || (b as HTMLInputElement).value
                  )
                };
              });
              console.log('팝업 내용:', JSON.stringify(popupInfo, null, 2));

              // 스크린샷
              await p.screenshot({ path: 'C:/projects/e-naradomum-rpa/popup-content.png' });
              console.log('스크린샷 저장: popup-content.png');

              await p.close();
            }
          }
        } catch (e: any) {
          console.log('클릭 실패:', e.message);
        }
      }

      break;
    }
  }

  await browser.close();
}

testDismissPopup().catch(console.error);
