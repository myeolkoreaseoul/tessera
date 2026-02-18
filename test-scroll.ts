import { chromium } from 'playwright';

async function testScroll() {
  const browser = await chromium.connectOverCDP('http://localhost:9222');
  const contexts = browser.contexts();
  const pages = contexts[0].pages();
  
  for (const page of pages) {
    const url = page.url();
    if (url.includes('gosims') || url.includes('naradomum')) {
      
      // IBSectionScroll 요소 모두 찾기
      const scrollContainers = await page.$$('#DD001002QGridObj .IBSectionScroll');
      console.log(`IBSectionScroll 요소 개수: ${scrollContainers.length}`);
      
      // 각 컨테이너 정보 출력
      for (let i = 0; i < scrollContainers.length; i++) {
        const info = await scrollContainers[i].evaluate((el: HTMLElement) => ({
          scrollHeight: el.scrollHeight,
          clientHeight: el.clientHeight,
          scrollTop: el.scrollTop,
          childCount: el.children.length
        }));
        console.log(`[${i}] scrollHeight=${info.scrollHeight} clientHeight=${info.clientHeight} scrollTop=${info.scrollTop} children=${info.childCount}`);
      }
      
      // 가장 큰 스크롤 컨테이너에서 스크롤 테스트
      if (scrollContainers.length > 0) {
        // 스크롤 전 데이터 행 개수
        const beforeCount = await page.$$eval('#DD001002QGridObj .IBBodyMid tr', rows => 
          rows.filter(r => r.querySelectorAll('td').length > 5).length
        );
        console.log(`스크롤 전 데이터 행: ${beforeCount}`);
        
        // 스크롤 실행
        for (const container of scrollContainers) {
          await container.evaluate((el: HTMLElement) => {
            el.scrollTop += 500;
          });
        }
        
        await page.waitForTimeout(1000);
        
        // 스크롤 후 데이터 행 개수
        const afterCount = await page.$$eval('#DD001002QGridObj .IBBodyMid tr', rows => 
          rows.filter(r => r.querySelectorAll('td').length > 5).length
        );
        console.log(`스크롤 후 데이터 행: ${afterCount}`);
        
        // 스크롤 위치 확인
        for (let i = 0; i < scrollContainers.length; i++) {
          const scrollTop = await scrollContainers[i].evaluate((el: HTMLElement) => el.scrollTop);
          console.log(`[${i}] 스크롤 후 scrollTop: ${scrollTop}`);
        }
      }
      
      break;
    }
  }
  
  await browser.close();
}

testScroll().catch(console.error);
