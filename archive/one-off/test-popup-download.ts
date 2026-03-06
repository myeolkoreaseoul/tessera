import { chromium } from 'playwright';
import fs from 'fs';

async function testPopupDownload() {
  const browser = await chromium.connectOverCDP('http://localhost:9222');
  const contexts = browser.contexts();
  const pages = contexts[0].pages();
  
  for (const page of pages) {
    const url = page.url();
    if (url.includes('gosims') || url.includes('naradomum')) {
      console.log('e나라도움 페이지 발견\n');
      
      // 알림 닫기
      const alertBtn = await page.$('.popupMask.on button');
      if (alertBtn) {
        await alertBtn.click();
        await page.waitForTimeout(500);
      }
      
      // [보기] 클릭
      const viewCells = await page.$$('td:has-text("[보기]")');
      console.log(`[보기] 셀 ${viewCells.length}개`);
      
      if (viewCells.length > 0) {
        await viewCells[0].click();
        await page.waitForTimeout(2000);
        
        // 팝업 찾기
        const context = page.context();
        const popupPage = context.pages().find(p => p.url().includes('getDB003002SView'));
        
        if (popupPage) {
          console.log('\n팝업 열림:', popupPage.url());
          await popupPage.waitForLoadState('domcontentloaded');
          
          // 파일 링크 찾기
          const fileLinks = await popupPage.$$('table a');
          console.log(`파일 링크 ${fileLinks.length}개 발견`);
          
          if (fileLinks.length > 0) {
            // 다운로드 폴더 생성
            if (!fs.existsSync('C:/projects/e-naradomum-rpa/downloads')) {
              fs.mkdirSync('C:/projects/e-naradomum-rpa/downloads', { recursive: true });
            }
            
            // 다운로드 시도
            console.log('파일 다운로드 시도...');
            const downloadPromise = popupPage.waitForEvent('download', { timeout: 15000 });
            await fileLinks[0].click();
            
            try {
              const download = await downloadPromise;
              const filename = download.suggestedFilename();
              const savePath = `C:/projects/e-naradomum-rpa/downloads/${filename}`;
              await download.saveAs(savePath);
              console.log(`다운로드 성공: ${filename}`);
            } catch (e) {
              console.log('다운로드 이벤트 없음, 버튼 방식 시도...');
              
              // 체크박스 선택 후 다운로드 버튼
              const checkboxes = await popupPage.$$('input[type="checkbox"]');
              for (const cb of checkboxes) {
                await cb.check().catch(() => {});
              }
              
              const dlBtn = await popupPage.$('button:has-text("다운로드"), input[value*="다운로드"]');
              if (dlBtn) {
                const downloadPromise2 = popupPage.waitForEvent('download', { timeout: 15000 });
                await dlBtn.click();
                const download = await downloadPromise2;
                const filename = download.suggestedFilename();
                console.log(`버튼으로 다운로드 성공: ${filename}`);
              }
            }
          }
          
          // 닫기
          await popupPage.close();
        }
      }
      
      break;
    }
  }
  
  await browser.close();
}

testPopupDownload().catch(console.error);
