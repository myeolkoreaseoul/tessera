import { chromium } from 'playwright';

async function takeScreenshot() {
  const browser = await chromium.connectOverCDP('http://localhost:9222');
  const contexts = browser.contexts();
  const pages = contexts[0].pages();
  
  // e나라도움 페이지 찾기
  for (const page of pages) {
    const url = page.url();
    if (url.includes('gosims') || url.includes('naradomum')) {
      await page.screenshot({ path: 'C:/projects/e-naradomum-rpa/page.png', fullPage: false });
      console.log('스크린샷 저장: C:/projects/e-naradomum-rpa/page.png');
      
      // 테이블 행 개수 확인
      const rows = await page.$$('table tbody tr');
      console.log(`테이블 행 개수: ${rows.length}`);
      
      // 첫 번째 행의 셀 개수 확인
      if (rows.length > 0) {
        const cells = await rows[0].$$('td');
        console.log(`첫 번째 행 셀 개수: ${cells.length}`);
      }
      
      // 모든 테이블 개수
      const tables = await page.$$('table');
      console.log(`페이지 내 테이블 개수: ${tables.length}`);
      
      break;
    }
  }
  
  await browser.close();
}

takeScreenshot().catch(console.error);
