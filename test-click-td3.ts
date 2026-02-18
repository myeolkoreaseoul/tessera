import { chromium } from 'playwright';

async function testClickTd() {
  const browser = await chromium.connectOverCDP('http://localhost:9222');
  const contexts = browser.contexts();
  const pages = contexts[0].pages();
  
  for (const page of pages) {
    const url = page.url();
    if (url.includes('gosims') || url.includes('naradomum')) {
      console.log('e나라도움 페이지 발견\n');
      
      // 팝업 닫기
      const alertBtn = await page.$('.popupMask.on button, .popupMask.on input[type="button"]');
      if (alertBtn) {
        await alertBtn.click();
        await page.waitForTimeout(500);
        console.log('알림 닫음');
      }
      
      // 새 창/팝업을 포함한 모든 페이지 이벤트 감지
      page.on('popup', p => console.log('popup 이벤트:', p.url()));
      
      // [보기] TD 셀 클릭
      const viewCells = await page.$$('td:has-text("[보기]")');
      console.log(`[보기] TD 셀 ${viewCells.length}개 발견`);
      
      if (viewCells.length > 1) {
        // 두 번째 셀 클릭 (첫 번째가 헤더일 수 있음)
        console.log('두 번째 [보기] 셀 클릭...');
        await viewCells[1].click();
        
        // 잠시 대기
        await page.waitForTimeout(2000);
        
        // 열린 페이지 확인
        const allPages = contexts[0].pages();
        console.log(`\n현재 열린 페이지 수: ${allPages.length}`);
        for (const p of allPages) {
          console.log('  -', p.url().substring(0, 80));
        }
        
        // 새 창이 열렸는지 확인
        if (allPages.length > 1) {
          const newPage = allPages[allPages.length - 1];
          if (newPage.url().includes('getDB003002SView')) {
            console.log('\n첨부파일 팝업 발견!');
            await newPage.screenshot({ path: 'C:/projects/e-naradomum-rpa/attachment-popup.png' });
            console.log('스크린샷 저장됨');
          }
        }
      }
      
      break;
    }
  }
  
  await browser.close();
}

testClickTd().catch(console.error);
