import { chromium } from 'playwright';

async function findButtons() {
  const browser = await chromium.connectOverCDP('http://localhost:9222');
  const contexts = browser.contexts();
  const pages = contexts[0].pages();
  
  for (const page of pages) {
    const url = page.url();
    if (url.includes('gosims') || url.includes('naradomum')) {
      console.log('=== 테이블 내 요소 탐색 ===\n');
      
      // IBGrid 테이블 내 모든 클릭 가능한 요소 찾기
      const clickables = await page.evaluate(() => {
        const grid = document.querySelector('#DD001002QGridObj');
        if (!grid) return ['그리드 없음'];
        
        const results: string[] = [];
        
        // 모든 a 태그
        const links = grid.querySelectorAll('a');
        links.forEach((a, i) => {
          if (i < 20) {
            results.push(`<a> "${a.textContent?.trim()}" onclick="${a.getAttribute('onclick')?.substring(0, 50) || ''}"`);
          }
        });
        
        return results;
      });
      
      console.log('IBGrid 내 링크들:');
      clickables.forEach(c => console.log('  ' + c));
      
      // "[보기]" 텍스트 포함 요소 찾기
      const viewElements = await page.evaluate(() => {
        const all = document.querySelectorAll('*');
        const results: string[] = [];
        all.forEach(el => {
          const text = el.textContent || '';
          if (text.includes('[보기]') || text === '보기' || text === '[보기]') {
            if (el.tagName !== 'BODY' && el.tagName !== 'HTML' && el.children.length === 0) {
              results.push(`<${el.tagName}> class="${el.className}" text="${text.trim().substring(0, 30)}"`);
            }
          }
        });
        return results.slice(0, 10);
      });
      
      console.log('\n"보기" 텍스트 포함 요소:');
      viewElements.forEach(e => console.log('  ' + e));
      
      break;
    }
  }
  
  await browser.close();
}

findButtons().catch(console.error);
