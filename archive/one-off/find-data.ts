import { chromium } from 'playwright';

async function findData() {
  const browser = await chromium.connectOverCDP('http://localhost:9222');
  const contexts = browser.contexts();
  const pages = contexts[0].pages();
  
  for (const page of pages) {
    const url = page.url();
    if (url.includes('gosims') || url.includes('naradomum')) {
      
      // 날짜 패턴이 있는 셀 찾기
      const dateData = await page.evaluate(() => {
        const results: string[] = [];
        
        // 모든 td 중에서 날짜 형식(2025-xx-xx)이 있는 것 찾기
        const allTds = document.querySelectorAll('#DD001002QGridObj td');
        allTds.forEach(td => {
          const text = td.textContent?.trim() || '';
          if (/^\d{4}-\d{2}-\d{2}$/.test(text)) {
            results.push(text);
          }
        });
        
        return {
          dateCount: results.length,
          uniqueDates: [...new Set(results)].length,
          sample: results.slice(0, 10)
        };
      });
      
      console.log('날짜 셀:', dateData);
      
      // IBBody 내의 데이터 행 찾기
      const bodyData = await page.evaluate(() => {
        const body = document.querySelector('#DD001002QGridObj .IBBodyMid');
        if (!body) return { error: 'IBBodyMid 없음' };
        
        const rows = body.querySelectorAll('tr');
        const rowsWithData = Array.from(rows).filter(r => {
          const tds = r.querySelectorAll('td');
          return tds.length > 5;
        });
        
        // 첫 번째 데이터 행의 구조 확인
        let firstRowData: string[] = [];
        if (rowsWithData[0]) {
          const tds = rowsWithData[0].querySelectorAll('td');
          firstRowData = Array.from(tds).slice(0, 15).map(td => td.textContent?.trim() || '');
        }
        
        return {
          totalRows: rows.length,
          dataRows: rowsWithData.length,
          firstRowData
        };
      });
      
      console.log('본문 데이터:', bodyData);
      
      break;
    }
  }
  
  await browser.close();
}

findData().catch(console.error);
