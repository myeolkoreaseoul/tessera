/**
 * 기본서류 클릭 → 팝업 열기 → 파일 목록 + 다운로드 URL 캡처
 */
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

const DOWNLOAD_DIR = path.join(__dirname, 'projects/캠퍼스타운-고려대/downloads');

(async () => {
  if (!fs.existsSync(DOWNLOAD_DIR)) fs.mkdirSync(DOWNLOAD_DIR, { recursive: true });

  const b = await chromium.connectOverCDP('http://localhost:9445', { timeout: 10000 });
  const ctx = b.contexts()[0];
  const page = ctx.pages().find(p => p.url().includes('lss.do'));
  if (!page) { console.error('lss.do 탭 없음'); process.exit(1); }

  // 네트워크 요청 캡처 시작
  const requests = [];
  page.on('request', req => {
    const url = req.url();
    if (url.includes('download') || url.includes('file') || url.includes('attach') ||
        url.includes('.pdf') || url.includes('atch')) {
      requests.push({ url: url.substring(0, 200), method: req.method() });
    }
  });

  page.on('response', resp => {
    const url = resp.url();
    const ct = resp.headers()['content-type'] || '';
    if (ct.includes('pdf') || ct.includes('octet-stream') || ct.includes('download') ||
        url.includes('download') || url.includes('attach') || url.includes('atch')) {
      requests.push({ url: url.substring(0, 200), status: resp.status(), contentType: ct });
    }
  });

  // 1) 기본서류 링크 클릭 → 팝업 열기
  console.log('기본서류 클릭...');
  await page.evaluate(() => {
    const fileExts = ['.pdf', '.jpg', '.jpeg', '.png', '.hwp', '.xlsx'];
    const els = [...document.querySelectorAll('*')].filter(el => {
      if (el.childElementCount > 0) return false;
      const text = (el.innerText || '').trim();
      return text.length > 3 && getComputedStyle(el).cursor === 'pointer' &&
        fileExts.some(ext => text.toLowerCase().endsWith(ext));
    });
    if (els.length > 0) els[0].click();
  });
  await sleep(2000);

  // 2) 팝업에서 파일 목록 추출
  const popupInfo = await page.evaluate(() => {
    // 팝업/다이얼로그 찾기
    const dialogs = [...document.querySelectorAll('.cl-dialog, [class*="cl-window"], [class*="modal"]')]
      .filter(el => el.getBoundingClientRect().width > 100);

    if (dialogs.length === 0) return { error: '팝업 없음', pageText: document.body.innerText.substring(0, 1000) };

    const popup = dialogs[dialogs.length - 1]; // 마지막 (최상위) 다이얼로그
    const text = (popup.innerText || '').trim();

    // 파일 관련 텍스트 추출 (확장자 기반)
    const fileExts = ['.pdf', '.jpg', '.jpeg', '.png', '.hwp', '.xlsx', '.xls', '.docx', '.zip'];
    const fileNames = [...popup.querySelectorAll('*')]
      .filter(el => {
        const t = (el.innerText || '').trim();
        return el.childElementCount === 0 && t.length > 3 &&
          fileExts.some(ext => t.toLowerCase().endsWith(ext));
      })
      .map(el => (el.innerText || '').trim());

    // 다운로드 버튼
    const dlBtns = [...popup.querySelectorAll('*')]
      .filter(el => (el.innerText || '').trim() === '다운로드' &&
        el.childElementCount === 0 && el.getBoundingClientRect().width > 0);

    return {
      fileNames,
      downloadBtns: dlBtns.length,
      popupText: text.substring(0, 600),
    };
  });

  console.log('\n=== 팝업 정보 ===');
  if (popupInfo.error) {
    console.log('에러:', popupInfo.error);
    console.log('페이지:', popupInfo.pageText?.substring(0, 200));
  } else {
    console.log('파일명:', popupInfo.fileNames);
    console.log('다운로드 버튼:', popupInfo.downloadBtns);
    console.log('팝업 텍스트:', popupInfo.popupText.substring(0, 300));
  }

  // 3) 다운로드 클릭 (네트워크 요청 캡처)
  if (popupInfo.downloadBtns > 0) {
    console.log('\n--- 다운로드 클릭 (네트워크 캡처) ---');

    const downloadPromise = page.waitForEvent('download', { timeout: 10000 }).catch(() => null);

    await page.evaluate(() => {
      const dialogs = [...document.querySelectorAll('.cl-dialog, [class*="cl-window"]')]
        .filter(el => el.getBoundingClientRect().width > 100);
      if (dialogs.length === 0) return;
      const popup = dialogs[dialogs.length - 1];
      const btns = [...popup.querySelectorAll('*')]
        .filter(el => (el.innerText || '').trim() === '다운로드' &&
          el.childElementCount === 0 && el.getBoundingClientRect().width > 0);
      if (btns.length > 0) btns[0].click();
    });

    await sleep(3000);
    const download = await downloadPromise;

    if (download) {
      const name = download.suggestedFilename();
      const savePath = path.join(DOWNLOAD_DIR, name);
      await download.saveAs(savePath);
      console.log(`✓ Playwright 다운로드: ${name} (${Math.round(fs.statSync(savePath).size / 1024)}KB)`);
    } else {
      console.log('Playwright download 이벤트 없음');
    }

    console.log('\n캡처된 네트워크 요청:');
    requests.forEach(r => console.log(`  ${r.method || ''} ${r.url} ${r.contentType || ''}`));
  }

  // 스크린샷
  await page.screenshot({ path: '/tmp/botem-download4.png' });
  console.log('\n스크린샷: /tmp/botem-download4.png');

  // 팝업 닫기
  await page.evaluate(() => {
    const dialogs = [...document.querySelectorAll('.cl-dialog')]
      .filter(el => el.getBoundingClientRect().width > 100);
    for (const d of dialogs) {
      const closeBtn = [...d.querySelectorAll('*')]
        .filter(el => ['닫기', '×', 'X'].includes((el.innerText || '').trim()) && el.childElementCount === 0);
      if (closeBtn.length > 0) { closeBtn[0].click(); break; }
    }
  });

  await b.close();
})().catch(e => console.error('ERROR:', e.message));
