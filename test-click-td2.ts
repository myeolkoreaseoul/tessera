import { chromium } from 'playwright';

async function testClickTd() {
  const browser = await chromium.connectOverCDP('http://localhost:9222');
  const contexts = browser.contexts();
  const pages = contexts[0].pages();
  
  for (const page of pages) {
    const url = page.url();
    if (url.includes('gosims') || url.includes('naradomum')) {
      console.log('e나라도움 페이지 발견\n');
      
      // 먼저 팝업 닫기
      console.log('팝업/알림 닫기 시도...');
      const alertOkBtn = await page.$('.popupMask button, .popupMask input[type="button"], button:has-text("확인")');
      if (alertOkBtn) {
        await alertOkBtn.click();
        console.log('알림 확인 클릭');
        await page.waitForTimeout(500);
      }
      
      // ESC 키도 시도
      await page.keyboard.press('Escape');
      await page.waitForTimeout(300);
      
      // popupMask 상태 확인
      const maskVisible = await page.$eval('.popupMask', el => 
        el.classList.contains('on') || getComputedStyle(el).display !== 'none'
      ).catch(() => false);
      console.log('팝업 마스크 활성:', maskVisible);
      
      if (!maskVisible) {
        // [보기] TD 셀 찾기
        const viewCells = await page.$$('td:has-text("[보기]")');
        console.log(`\n[보기] TD 셀 ${viewCells.length}개 발견`);
        
        if (viewCells.length > 0) {
          console.log('첫 번째 [보기] 셀 클릭...');
          
          const popupPromise = page.waitForEvent('popup', { timeout: 10000 }).catch(() => null);
          
          await viewCells[0].click();
          console.log('클릭 완료');
          
          const popup = await popupPromise;
          if (popup) {
            console.log('\n팝업 열림! URL:', popup.url());
            await popup.waitForLoadState('domcontentloaded');
            
            // 스크린샷
            await popup.screenshot({ path: 'C:/projects/e-naradomum-rpa/popup-screenshot.png' });
            console.log('팝업 스크린샷 저장: popup-screenshot.png');
            
            await popup.close();
          } else {
            console.log('팝업 안 열림');
          }
        }
      }
      
      break;
    }
  }
  
  await browser.close();
}

testClickTd().catch(console.error);
