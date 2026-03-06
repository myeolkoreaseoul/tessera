import { chromium } from 'playwright';

async function simpleCount() {
  const browser = await chromium.connectOverCDP('http://localhost:9222');
  const contexts = browser.contexts();
  const pages = contexts[0].pages();
  
  for (const page of pages) {
    const url = page.url();
    if (url.includes('gosims') || url.includes('naradomum')) {
      
      // 페이지 전체 텍스트에서 정보 추출
      const pageText = await page.evaluate(() => {
        const text = document.body.innerText;
        
        // Total 건수 찾기
        const totalMatch = text.match(/Total\s*[:\s@]*\s*(\d+)\s*건/i);
        
        // 페이지 정보 찾기
        const pageMatch = text.match(/Page\s*[:\s]*(\d+)\s*\/\s*(\d+)/i);
        
        // 건수 설정 찾기
        const sizeMatch = text.match(/(\d+)개씩\s*보기/);
        
        return {
          total: totalMatch ? totalMatch[1] : 'not found',
          currentPage: pageMatch ? pageMatch[1] : 'not found',
          totalPages: pageMatch ? pageMatch[2] : 'not found',
          pageSize: sizeMatch ? sizeMatch[1] : 'not found'
        };
      });
      console.log('페이지 정보:', pageText);
      
      // 실제 보이는 행 개수 (날짜로 세기)
      const visibleRows = await page.evaluate(() => {
        // 모든 td에서 날짜 패턴 찾기
        const tds = document.querySelectorAll('#DD001002QGridObj td');
        const dates = new Set<string>();
        tds.forEach(td => {
          const text = td.textContent?.trim() || '';
          // 집행일자 패턴 (연-월-일)
          if (/^\d{4}-\d{2}-\d{2}$/.test(text)) {
            dates.add(text + '_' + td.closest('tr')?.rowIndex);
          }
        });
        return dates.size;
      });
      console.log('보이는 데이터 행 (추정):', visibleRows);
      
      // IBBodyMid 내의 모든 행
      const bodyRows = await page.$$eval('#DD001002QGridObj .IBBodyMid tr', rows => rows.length);
      console.log('IBBodyMid 행:', bodyRows);
      
      break;
    }
  }
  
  await browser.close();
}

simpleCount().catch(console.error);
