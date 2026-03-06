import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';

// Playwright CDP dialog 에러 무시
process.on('unhandledRejection', (err: any) => {
  if (err?.message?.includes('No dialog is showing')) return;
  console.error('Unhandled:', err?.message?.substring(0, 100));
});

async function test() {
  const browser = await chromium.connectOverCDP('http://localhost:9444');
  const context = browser.contexts()[0];

  let popup = context.pages().find(p => p.url().includes('getDB003002SView'));
  const ePage = context.pages().find(p => p.url().includes('getDD001002QView'));

  if (!popup && ePage) {
    await ePage.evaluate(() => {
      document.querySelectorAll('.popupMask.on').forEach(el => {
        (el as HTMLElement).classList.remove('on');
        (el as HTMLElement).style.display = 'none';
      });
    });
    const viewCells = await ePage.$$('td.IBTextUnderline.HideCol0atchmnflTmp');
    const pp = context.waitForEvent('page', { timeout: 10000 });
    await viewCells[0].click({ timeout: 5000 });
    popup = await pp;
    if (popup.url() === 'about:blank') await popup.waitForURL(/gosims/, { timeout: 15000 });
    await popup.waitForLoadState('domcontentloaded');
    await popup.waitForTimeout(1000);
  }

  if (!popup) { console.log('팝업 없음'); await browser.close(); return; }
  console.log('팝업:', popup.url());

  const dlDir = '/mnt/c/projects/e-naradomum-rpa/downloads/test';
  fs.mkdirSync(dlDir, { recursive: true });

  // CDP로 다운로드 설정 + dialog 자동 수락
  const cdpSession = await popup.context().newCDPSession(popup);
  await cdpSession.send('Page.setDownloadBehavior', {
    behavior: 'allow',
    downloadPath: 'C:\\projects\\e-naradomum-rpa\\downloads\\test'
  });

  // CDP에서 직접 dialog 자동 수락
  cdpSession.on('Page.javascriptDialogOpening', async (event: any) => {
    console.log(`[CDP dialog] ${event.type}: ${event.message}`);
    try {
      await cdpSession.send('Page.handleJavaScriptDialog', { accept: true });
    } catch {}
  });
  await cdpSession.send('Page.enable');

  // 체크박스 선택
  await popup.evaluate(() => {
    document.querySelectorAll('input[type="checkbox"]').forEach(cb => {
      (cb as HTMLInputElement).checked = true;
    });
  });

  const filesBefore = new Set(fs.readdirSync(dlDir));

  console.log('다운로드 시작...');
  await popup.evaluate(() => {
    // popupMask 자동 확인
    const obs = new MutationObserver(() => {
      const mask = document.querySelector('.popupMask.on') as HTMLElement;
      if (mask) {
        const btn = mask.querySelector('footer button') as HTMLElement;
        if (btn) setTimeout(() => btn.click(), 200);
      }
    });
    obs.observe(document.body, { subtree: true, attributes: true, attributeFilter: ['class'] });
    (window as any).f_downloadDB003002S();
  });

  console.log('대기 중...');
  for (let i = 0; i < 20; i++) {
    await new Promise(r => setTimeout(r, 1000));
    try {
      const files = fs.readdirSync(dlDir);
      const newFiles = files.filter(f => !filesBefore.has(f) && !f.endsWith('.crdownload'));
      const dl = files.filter(f => f.endsWith('.crdownload'));
      if (dl.length > 0) console.log(`  진행중: ${dl.join(', ')}`);
      if (newFiles.length > 0) {
        console.log('\n다운로드 완료!');
        for (const f of newFiles) {
          const s = fs.statSync(path.join(dlDir, f));
          console.log(`  ${f} (${s.size} bytes)`);
        }
        await popup.close().catch(() => {});
        await browser.close();
        return;
      }
    } catch {}
  }

  console.log('다운로드 안됨. 파일 확인:');
  console.log('  dlDir:', fs.readdirSync(dlDir));
  // 기본 다운로드 폴더
  try {
    const defDl = '/mnt/c/temp/chrome-debug';
    if (fs.existsSync(defDl)) {
      const files = fs.readdirSync(defDl, { recursive: true }) as string[];
      const recent = files.filter(f => f.includes('Download') || f.endsWith('.pdf') || f.endsWith('.zip'));
      console.log('  temp profile:', recent.slice(0, 10));
    }
  } catch {}

  await popup.close().catch(() => {});
  await browser.close();
}

test().catch(console.error);
