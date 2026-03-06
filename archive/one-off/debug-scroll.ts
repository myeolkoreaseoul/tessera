import { chromium } from 'playwright';

async function debugScroll() {
  const browser = await chromium.connectOverCDP('http://localhost:9222');
  const contexts = browser.contexts();
  const pages = contexts[0].pages();
  
  for (const page of pages) {
    const url = page.url();
    if (url.includes('gosims') || url.includes('naradomum')) {
      console.log('페이지 발견:', url);
      
      // 모든 IBSectionScroll 요소 정보
      const scrollInfo = await page.evaluate(() => {
        const containers = document.querySelectorAll('#DD001002QGridObj .IBSectionScroll');
        return Array.from(containers).map((el, i) => {
          const htmlEl = el as HTMLElement;
          const style = getComputedStyle(el);
          return {
            index: i,
            scrollHeight: htmlEl.scrollHeight,
            clientHeight: htmlEl.clientHeight,
            scrollTop: htmlEl.scrollTop,
            overflow: style.overflow,
            overflowY: style.overflowY,
            parentClass: htmlEl.parentElement?.className || '',
            hasVerticalScroll: htmlEl.scrollHeight > htmlEl.clientHeight
          };
        });
      });
      
      console.log('\n=== IBSectionScroll 요소들 ===');
      scrollInfo.forEach(info => {
        console.log(`[${info.index}] scrollHeight=${info.scrollHeight} clientHeight=${info.clientHeight} scrollTop=${info.scrollTop}`);
        console.log(`    overflow=${info.overflow} overflowY=${info.overflowY}`);
        console.log(`    hasVerticalScroll=${info.hasVerticalScroll} parent=${info.parentClass}`);
      });
      
      // IBBodyMid에서 현재 보이는 행들의 첫번째 셀 내용
      const visibleRows = await page.evaluate(() => {
        const body = document.querySelector('#DD001002QGridObj .IBBodyMid');
        if (!body) return [];
        const rows = body.querySelectorAll('tr');
        return Array.from(rows).slice(0, 15).map((row, i) => {
          const cells = row.querySelectorAll('td');
          const firstCell = cells[0]?.textContent?.trim() || '';
          const secondCell = cells[1]?.textContent?.trim() || '';
          return `[${i}] ${firstCell} | ${secondCell}`;
        });
      });
      
      console.log('\n=== 현재 보이는 행들 (처음 15개) ===');
      visibleRows.forEach(row => console.log(row));
      
      // 스크롤 테스트: 가장 큰 IBSectionScroll을 500px 스크롤
      const scrollContainers = await page.$$('#DD001002QGridObj .IBSectionScroll');
      let maxContainer = null;
      let maxHeight = 0;
      
      for (const container of scrollContainers) {
        const h = await container.evaluate((el: HTMLElement) => el.scrollHeight);
        if (h > maxHeight) {
          maxHeight = h;
          maxContainer = container;
        }
      }
      
      if (maxContainer) {
        console.log('\n=== 스크롤 테스트 ===');
        const before = await maxContainer.evaluate((el: HTMLElement) => el.scrollTop);
        console.log(`스크롤 전 scrollTop: ${before}`);
        
        await maxContainer.evaluate((el: HTMLElement) => {
          el.scrollTop = 500;
        });
        await page.waitForTimeout(1000);
        
        const after = await maxContainer.evaluate((el: HTMLElement) => el.scrollTop);
        console.log(`스크롤 후 scrollTop: ${after}`);
        
        // 스크롤 후 보이는 행들
        const afterRows = await page.evaluate(() => {
          const body = document.querySelector('#DD001002QGridObj .IBBodyMid');
          if (!body) return [];
          const rows = body.querySelectorAll('tr');
          return Array.from(rows).slice(0, 15).map((row, i) => {
            const cells = row.querySelectorAll('td');
            const firstCell = cells[0]?.textContent?.trim() || '';
            const secondCell = cells[1]?.textContent?.trim() || '';
            return `[${i}] ${firstCell} | ${secondCell}`;
          });
        });
        
        console.log('\n=== 스크롤 후 보이는 행들 ===');
        afterRows.forEach(row => console.log(row));
      }
      
      break;
    }
  }
  
  await browser.close();
}

debugScroll().catch(console.error);
