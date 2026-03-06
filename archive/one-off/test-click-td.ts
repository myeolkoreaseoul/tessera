import { chromium } from 'playwright';

async function testClickTd() {
  const browser = await chromium.connectOverCDP('http://localhost:9222');
  const contexts = browser.contexts();
  const pages = contexts[0].pages();
  
  for (const page of pages) {
    const url = page.url();
    if (url.includes('gosims') || url.includes('naradomum')) {
      console.log('e나라도움 페이지 발견\n');
      
      // [보기] TD 셀 찾기
      const viewCells = await page.$$('td:has-text("[보기]")');
      console.log(`[보기] TD 셀 ${viewCells.length}개 발견`);
      
      if (viewCells.length > 0) {
        console.log('첫 번째 [보기] 셀 클릭...');
        
        // 팝업 대기
        const popupPromise = page.waitForEvent('popup', { timeout: 10000 }).catch(() => null);
        
        // TD 클릭
        await viewCells[0].click();
        console.log('클릭 완료');
        
        const popup = await popupPromise;
        if (popup) {
          console.log('\n팝업 열림!');
          console.log('URL:', popup.url());
          
          await popup.waitForLoadState('domcontentloaded');
          await popup.waitForTimeout(1000);
          
          // 파일 목록 확인
          const files = await popup.$$eval('table tr', rows => 
            rows.map(r => r.textContent?.trim().substring(0, 80) || '').filter(t => t.length > 10)
          );
          console.log('\n파일 목록:');
          files.slice(0, 5).forEach(f => console.log('  ' + f));
          
          // 다운로드 버튼 찾기
          const downloadBtn = await popup.$('button:has-text("다운로드"), input[value*="다운로드"]');
          if (downloadBtn) {
            console.log('\n[다운로드] 버튼 발견!');
          }
          
          // 닫기
          const closeBtn = await popup.$('button:has-text("닫기"), input[value="닫기"]');
          if (closeBtn) {
            await closeBtn.click();
            console.log('팝업 닫음');
          } else {
            await popup.close();
          }
        } else {
          console.log('팝업 안 열림');
        }
      }
      
      break;
    }
  }
  
  await browser.close();
}

testClickTd().catch(console.error);
