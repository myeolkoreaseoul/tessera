import { chromium } from 'playwright';

async function analyzeTable() {
  const browser = await chromium.connectOverCDP('http://localhost:9222');
  const contexts = browser.contexts();
  const pages = contexts[0].pages();
  
  for (const page of pages) {
    const url = page.url();
    if (url.includes('gosims') || url.includes('naradomum')) {
      
      // 모든 테이블의 ID와 class 확인
      const tableInfo = await page.evaluate(() => {
        const tables = document.querySelectorAll('table');
        return Array.from(tables).map((t, i) => ({
          index: i,
          id: t.id,
          className: t.className,
          rowCount: t.querySelectorAll('tbody tr').length,
          firstRowCells: t.querySelector('tbody tr')?.querySelectorAll('td').length || 0
        }));
      });
      
      console.log('=== 테이블 정보 ===');
      tableInfo.forEach(t => {
        console.log(`[${t.index}] id="${t.id}" class="${t.className}" 행=${t.rowCount} 셀=${t.firstRowCells}`);
      });
      
      // 가장 많은 행을 가진 테이블 찾기
      const mainTable = tableInfo.reduce((max, t) => t.rowCount > max.rowCount ? t : max, tableInfo[0]);
      console.log(`\n메인 테이블 추정: index=${mainTable.index}, 행=${mainTable.rowCount}`);
      
      break;
    }
  }
  
  await browser.close();
}

analyzeTable().catch(console.error);
