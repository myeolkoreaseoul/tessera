import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';

async function test() {
  const browser = await chromium.connectOverCDP('http://localhost:9444');
  const context = browser.contexts()[0];

  let popup = context.pages().find(p => p.url().includes('getDB003002SView'));
  if (!popup) {
    console.log('팝업 없음, 새로 열기...');
    const ePage = context.pages().find(p => p.url().includes('getDD001002QView'));
    if (!ePage) { console.log('페이지 없음'); await browser.close(); return; }

    await ePage.evaluate(() => {
      document.querySelectorAll('.popupMask.on').forEach(el => {
        (el as HTMLElement).classList.remove('on');
        (el as HTMLElement).style.display = 'none';
      });
    });

    const viewCells = await ePage.$$('td.IBTextUnderline.HideCol0atchmnflTmp');
    const popupPromise = context.waitForEvent('page', { timeout: 10000 });
    await viewCells[0].click({ timeout: 5000 });
    popup = await popupPromise;
    if (popup.url() === 'about:blank') await popup.waitForURL(/gosims/, { timeout: 15000 });
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

  // 체크박스 선택
  await popup.evaluate(() => {
    document.querySelectorAll('input[type="checkbox"]').forEach(cb => {
      (cb as HTMLInputElement).checked = true;
      cb.dispatchEvent(new Event('change', { bubbles: true }));
    });
  });

  const filesBefore = new Set(fs.readdirSync(dlDir));

  // popupMask의 확인 버튼을 JS로 클릭하는 핸들러 - 다운로드 후에 실행
  console.log('f_downloadDB003002S() 호출 + popupMask 자동 확인...');

  await popup.evaluate(() => {
    // popupMask가 뜨면 자동으로 확인 버튼 클릭
    const observer = new MutationObserver(() => {
      const mask = document.querySelector('.popupMask.on') as HTMLElement;
      if (mask) {
        const btn = mask.querySelector('footer button, button') as HTMLElement;
        if (btn) {
          setTimeout(() => btn.click(), 500);
        }
      }
    });
    observer.observe(document.body, { childList: true, subtree: true, attributes: true });
    (window as any).__maskObserver = observer;

    // 다운로드 함수 호출
    (window as any).f_downloadDB003002S();
  });

  // 다운로드 대기
  console.log('다운로드 대기...');
  for (let i = 0; i < 15; i++) {
    await popup.waitForTimeout(1000);
    const currentFiles = fs.readdirSync(dlDir);
    const newFiles = currentFiles.filter(f => !filesBefore.has(f) && !f.endsWith('.crdownload'));
    if (newFiles.length > 0) {
      console.log('\n다운로드 성공!');
      for (const f of newFiles) {
        const stat = fs.statSync(path.join(dlDir, f));
        console.log(`  ${f} (${stat.size} bytes)`);
      }
      break;
    }
    // .crdownload 파일 확인 (다운로드 진행 중)
    const downloading = currentFiles.filter(f => f.endsWith('.crdownload'));
    if (downloading.length > 0) {
      console.log(`  다운로드 진행 중: ${downloading.join(', ')}`);
    }
    if (i === 14) {
      console.log('15초 대기 완료, 파일 확인...');
      console.log('dlDir 파일:', currentFiles);
    }
  }

  // observer 정리
  await popup.evaluate(() => {
    (window as any).__maskObserver?.disconnect();
  }).catch(() => {});

  await popup.close().catch(() => {});
  await browser.close();
}

test().catch(console.error);
