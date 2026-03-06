import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';

async function test() {
  const browser = await chromium.connectOverCDP('http://localhost:9444');
  const context = browser.contexts()[0];

  // 기존 팝업 찾기 또는 새로 열기
  let popup = context.pages().find(p => p.url().includes('getDB003002SView'));
  if (!popup) {
    const ePage = context.pages().find(p => p.url().includes('getDD001002QView'));
    if (!ePage) { console.log('페이지 없음'); await browser.close(); return; }

    await ePage.evaluate(() => {
      document.querySelectorAll('.popupMask.on').forEach(el => {
        (el as HTMLElement).classList.remove('on');
        (el as HTMLElement).style.display = 'none';
      });
    });

    const viewCells = await ePage.$$('td.IBTextUnderline.HideCol0atchmnflTmp');
    if (viewCells.length === 0) { console.log('[보기] 없음'); await browser.close(); return; }

    const popupPromise = context.waitForEvent('page', { timeout: 10000 });
    await viewCells[0].click({ timeout: 5000 });
    popup = await popupPromise;
    if (popup.url() === 'about:blank') {
      await popup.waitForURL(/gosims/, { timeout: 15000 });
    }
    await popup.waitForLoadState('domcontentloaded');
    await popup.waitForTimeout(1000);
  }

  console.log('팝업:', popup.url());

  const dlDir = '/mnt/c/projects/e-naradomum-rpa/downloads/test';
  fs.mkdirSync(dlDir, { recursive: true });

  // CDP 다운로드 설정
  const cdpSession = await popup.context().newCDPSession(popup);
  await cdpSession.send('Page.setDownloadBehavior', {
    behavior: 'allow',
    downloadPath: 'C:\\projects\\e-naradomum-rpa\\downloads\\test'
  });

  // popupMask 감시 및 자동 닫기
  const maskInterval = setInterval(async () => {
    try {
      await popup!.evaluate(() => {
        const mask = document.querySelector('.popupMask.on') as HTMLElement;
        if (mask) {
          const btn = mask.querySelector('footer button, button') as HTMLElement;
          if (btn) btn.click();
          mask.classList.remove('on');
          mask.style.display = 'none';
        }
      });
    } catch {}
  }, 500);

  // 체크박스 전체 선택
  await popup.evaluate(() => {
    document.querySelectorAll('input[type="checkbox"]').forEach(cb => {
      (cb as HTMLInputElement).checked = true;
      cb.dispatchEvent(new Event('change', { bubbles: true }));
    });
  });
  console.log('체크박스 전체 선택');

  // 다운로드 전 파일 목록
  const filesBefore = new Set(fs.readdirSync(dlDir));

  // f_downloadDB003002S 직접 호출
  console.log('f_downloadDB003002S() 직접 호출...');
  const callResult = await popup.evaluate(() => {
    try {
      (window as any).f_downloadDB003002S();
      return 'called';
    } catch (e: any) {
      return 'error: ' + e.message;
    }
  });
  console.log('결과:', callResult);

  // 다운로드 대기
  console.log('다운로드 대기 중...');
  for (let i = 0; i < 10; i++) {
    await popup.waitForTimeout(1000);
    const currentFiles = fs.readdirSync(dlDir);
    const newFiles = currentFiles.filter(f => !filesBefore.has(f));
    if (newFiles.length > 0) {
      console.log('\n다운로드 성공!');
      for (const f of newFiles) {
        const stat = fs.statSync(path.join(dlDir, f));
        console.log(`  ${f} (${stat.size} bytes)`);
      }
      break;
    }
    if (i === 9) {
      console.log('10초 대기 후에도 새 파일 없음');

      // 기본 다운로드 폴더 확인 (임시 프로필)
      const tempDl = 'C:/temp/chrome-debug/Default/Downloads';
      if (fs.existsSync(tempDl)) {
        console.log('임시 프로필 다운로드 폴더:', fs.readdirSync(tempDl));
      }
    }
  }

  clearInterval(maskInterval);
  await popup.close();
  await browser.close();
}

test().catch(console.error);
