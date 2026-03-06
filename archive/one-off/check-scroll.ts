import { chromium } from 'playwright';

async function checkScroll() {
  const browser = await chromium.connectOverCDP('http://localhost:9222');
  const contexts = browser.contexts();
  const pages = contexts[0].pages();
  
  for (const page of pages) {
    const url = page.url();
    if (url.includes('gosims') || url.includes('naradomum')) {
      
      // 스크롤 가능한 요소들 찾기
      const scrollableElements = await page.evaluate(() => {
        const results: any[] = [];
        const allElements = document.querySelectorAll('#DD001002QGridObj *');
        
        allElements.forEach((el, i) => {
          const style = getComputedStyle(el);
          if (style.overflow === 'scroll' || style.overflow === 'auto' ||
              style.overflowY === 'scroll' || style.overflowY === 'auto') {
            const htmlEl = el as HTMLElement;
            if (htmlEl.scrollHeight > htmlEl.clientHeight) {
              results.push({
                tagName: el.tagName,
                className: el.className,
                id: (el as HTMLElement).id,
                scrollHeight: htmlEl.scrollHeight,
                clientHeight: htmlEl.clientHeight,
                scrollTop: htmlEl.scrollTop
              });
            }
          }
        });
        
        return results;
      });
      
      console.log('스크롤 가능한 요소들:');
      scrollableElements.forEach((el, i) => {
        console.log(`[${i}] ${el.tagName} class="${el.className}" id="${el.id}"`);
        console.log(`    scrollHeight=${el.scrollHeight} clientHeight=${el.clientHeight}`);
      });
      
      break;
    }
  }
  
  await browser.close();
}

checkScroll().catch(console.error);
