import { chromium } from 'playwright';

async function analyzeGrid() {
  const browser = await chromium.connectOverCDP('http://localhost:9222');
  const contexts = browser.contexts();
  const pages = contexts[0].pages();
  
  for (const page of pages) {
    const url = page.url();
    if (url.includes('gosims') || url.includes('naradomum')) {
      
      // IBMainTable 구조 분석
      const gridInfo = await page.evaluate(() => {
        const mainTable = document.getElementById('DD001002QGridObj');
        if (!mainTable) return { error: '테이블 없음' };
        
        // IBSection 내부 구조 확인
        const sections = mainTable.querySelectorAll('.IBSection');
        const sectionInfo = Array.from(sections).map((s, i) => {
          const rows = s.querySelectorAll('tr');
          return {
            index: i,
            rowCount: rows.length,
            firstRowHTML: rows[0]?.innerHTML?.substring(0, 200) || ''
          };
        });
        
        // 실제 데이터 행 찾기 - div나 다른 구조일 수 있음
        const allDivs = mainTable.querySelectorAll('div[row]');
        const allTrs = mainTable.querySelectorAll('tr');
        
        // 텍스트 내용이 있는 행 확인
        let dataRows = 0;
        allTrs.forEach(tr => {
          const text = tr.textContent?.trim() || '';
          if (text.length > 20 && text.includes('2025')) {
            dataRows++;
          }
        });
        
        return {
          sectionCount: sections.length,
          sectionInfo,
          divRowCount: allDivs.length,
          trCount: allTrs.length,
          dataRows,
          tableHTML: mainTable.outerHTML.substring(0, 500)
        };
      });
      
      console.log('=== IBMainTable 분석 ===');
      console.log(JSON.stringify(gridInfo, null, 2));
      
      break;
    }
  }
  
  await browser.close();
}

analyzeGrid().catch(console.error);
