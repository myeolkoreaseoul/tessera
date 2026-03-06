const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

const DL_DIR = '/home/john/e-naradomum-rpa/projects/캠퍼스타운-고려대/downloads';
if (!fs.existsSync(DL_DIR)) fs.mkdirSync(DL_DIR, { recursive: true });

(async () => {
  const b = await chromium.connectOverCDP('http://100.87.3.123:9445', { timeout: 10000 });
  const ctx = b.contexts()[0];
  const page = ctx.pages().find(p => p.url().includes('lss.do'));
  if (!page) { console.error('lss.do 탭 없음'); process.exit(1); }

  // 현재 팝업의 '다운로드' 버튼 클릭
  console.log('다운로드 버튼 클릭...');
  const downloadPromise = page.waitForEvent('download', { timeout: 15000 }).catch(() => null);

  await page.evaluate(() => {
    const btns = [...document.querySelectorAll('button, [role="button"], a, div, span')].filter(el => {
      const t = (el.innerText || '').trim();
      return t === '다운로드' && el.getBoundingClientRect().width > 0 && el.childElementCount === 0;
    });
    console.log('버튼 수:', btns.length);
    if (btns[0]) btns[0].click();
  });

  const download = await downloadPromise;
  if (download) {
    const fn = download.suggestedFilename();
    const savePath = path.join(DL_DIR, fn);
    await download.saveAs(savePath);
    const size = fs.statSync(savePath).size;
    console.log('다운로드 완료:', fn, '(' + Math.round(size / 1024) + 'KB)');
  } else {
    console.log('download 이벤트 없음, 새 탭 확인...');
    await sleep(3000);
    const allPages = ctx.pages();
    console.log('전체 탭:', allPages.length);
    for (const p of allPages) {
      if (p !== page) {
        const url = p.url();
        console.log('새 탭:', url.substring(0, 200));
        // PDF 내용 스크린샷
        try {
          await p.screenshot({ path: '/tmp/botem-dl-tab.png' });
          console.log('새 탭 스크린샷 저장');
        } catch (e) {
          console.log('스크린샷 실패:', e.message);
        }
      }
    }
  }

  // 팝업 닫기
  await page.evaluate(() => {
    const closeBtn = [...document.querySelectorAll('button, [role="button"], div, span')].filter(el => {
      const t = (el.innerText || '').trim();
      return (t === '닫기' || t === 'X' || t === '×') && el.getBoundingClientRect().width > 0 && el.childElementCount === 0;
    });
    if (closeBtn[0]) closeBtn[0].click();
  });

  await sleep(500);
  await page.screenshot({ path: '/tmp/botem-after-close.png' });
  console.log('팝업 닫기 후 스크린샷');

  await b.close();
})().catch(e => console.error('ERROR:', e.message));
