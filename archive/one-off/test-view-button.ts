import { chromium } from 'playwright';

async function testViewButton() {
  const browser = await chromium.connectOverCDP('http://localhost:9222');
  const contexts = browser.contexts();
  const pages = contexts[0].pages();
  
  for (const page of pages) {
    const url = page.url();
    if (url.includes('gosims') || url.includes('naradomum')) {
      console.log('e나라도움 페이지 발견\n');
      
      // 1. [보기] 버튼/링크 찾기
      const viewButtons = await page.$$eval('a, button, input[type="button"]', els => 
        els.filter(el => el.textContent?.includes('보기') || (el as HTMLInputElement).value?.includes('보기'))
          .map(el => ({
            tag: el.tagName,
            text: el.textContent?.trim().substring(0, 30) || (el as HTMLInputElement).value,
            onclick: el.getAttribute('onclick')?.substring(0, 80) || '',
            href: (el as HTMLAnchorElement).href || ''
          }))
      );
      
      console.log(`[보기] 버튼/링크 ${viewButtons.length}개 발견:`);
      viewButtons.slice(0, 5).forEach((b, i) => {
        console.log(`  [${i}] <${b.tag}> "${b.text}"`);
        if (b.onclick) console.log(`      onclick="${b.onclick}"`);
        if (b.href) console.log(`      href="${b.href}"`);
      });
      
      // 2. 첫 번째 보기 버튼 클릭 테스트
      if (viewButtons.length > 0) {
        console.log('\n첫 번째 [보기] 버튼 클릭 시도...');
        
        const popupPromise = page.waitForEvent('popup', { timeout: 5000 }).catch(() => null);
        
        // 버튼 클릭
        const btn = await page.$('a:has-text("보기"), button:has-text("보기")');
        if (btn) {
          await btn.click();
          console.log('버튼 클릭 완료');
          
          const popup = await popupPromise;
          if (popup) {
            console.log('팝업 열림!');
            console.log('팝업 URL:', popup.url());
            
            await popup.waitForTimeout(1000);
            
            // 팝업에서 파일 링크 찾기
            const fileLinks = await popup.$$eval('a', els => 
              els.map(el => ({
                text: el.textContent?.trim().substring(0, 50) || '',
                href: el.href
              })).filter(l => l.text.length > 0)
            );
            console.log('\n팝업의 링크들:');
            fileLinks.forEach(l => console.log(`  "${l.text}"`));
            
            // 팝업 닫기
            await popup.close();
          } else {
            console.log('팝업 열리지 않음 (알림창일 수 있음)');
            
            // 알림창 확인
            const alert = await page.$('.popupMask, .alert, [role="dialog"]');
            if (alert) {
              console.log('알림창 발견');
            }
          }
        } else {
          console.log('버튼을 찾을 수 없음');
        }
      }
      
      break;
    }
  }
  
  await browser.close();
}

testViewButton().catch(console.error);
