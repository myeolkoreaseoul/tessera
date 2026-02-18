import { chromium } from 'playwright';

async function checkPagination() {
  const browser = await chromium.connectOverCDP('http://localhost:9222');
  const contexts = browser.contexts();
  const pages = contexts[0].pages();
  
  for (const page of pages) {
    const url = page.url();
    if (url.includes('gosims') || url.includes('naradomum')) {
      
      // Total 건수 확인
      const totalText = await page.evaluate(() => {
        const el = document.querySelector('[class*="total"], [id*="total"], span:has-text("Total")');
        // 모든 텍스트에서 "Total" 찾기
        const allText = document.body.innerText;
        const match = allText.match(/Total\s*[:\s@]*\s*(\d+)\s*건/);
        return match ? match[1] : 'not found';
      });
      console.log('Total 건수:', totalText);
      
      // 페이지당 건수 설정 확인
      const pageSize = await page.evaluate(() => {
        const select = document.querySelector('select[name*="page"], select[id*="page"]');
        if (select) return (select as HTMLSelectElement).value;
        // 텍스트에서 찾기
        const text = document.body.innerText;
        const match = text.match(/(\d+)개씩 보기/);
        return match ? match[1] : 'not found';
      });
      console.log('페이지당 건수:', pageSize);
      
      // 현재 페이지 확인
      const currentPage = await page.evaluate(() => {
        const pageLinks = document.querySelectorAll('.pagination a, [class*="page"] a, [class*="paging"] a');
        const activeLink = document.querySelector('.pagination .active, [class*="page"] .on, [class*="paging"] .on');
        return {
          pageLinks: pageLinks.length,
          activePage: activeLink?.textContent || 'not found'
        };
      });
      console.log('페이지 정보:', currentPage);
      
      // 스크롤 컨테이너 확인
      const scrollInfo = await page.evaluate(() => {
        const container = document.querySelector('#DD001002QGridObj .IBBodyMid');
        if (!container) return { error: 'container not found' };
        
        const scrollDiv = container.querySelector('[style*="overflow"]') || container;
        return {
          scrollHeight: (scrollDiv as HTMLElement).scrollHeight,
          clientHeight: (scrollDiv as HTMLElement).clientHeight,
          scrollTop: (scrollDiv as HTMLElement).scrollTop
        };
      });
      console.log('스크롤 정보:', scrollInfo);
      
      break;
    }
  }
  
  await browser.close();
}

checkPagination().catch(console.error);
