// 1. retvFileList.do 응답 확인 → 2. fileDownload.do 파라미터 캡처 → 3. fetch로 다운로드
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

const DL_DIR = '/home/john/e-naradomum-rpa/projects/캠퍼스타운-고려대/downloads';

(async () => {
  const b = await chromium.connectOverCDP('http://100.87.3.123:9445', { timeout: 10000 });
  const ctx = b.contexts()[0];
  const page = ctx.pages().find(p => p.url().includes('lss.do'));
  if (!page) { console.error('lss.do 탭 없음'); process.exit(1); }

  // CDP 세션으로 요청 본문까지 캡처
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Network.enable');

  const captured = {};
  cdp.on('Network.requestWillBeSent', (params) => {
    const url = params.request.url;
    if (url.includes('retvFileList') || url.includes('fileDownload') || url.includes('FileDown')) {
      captured[url] = {
        method: params.request.method,
        url: url,
        postData: params.request.postData || '',
        headers: params.request.headers,
        requestId: params.requestId,
      };
      console.log(`[캡처] ${params.request.method} ${url}`);
      console.log(`  body: ${(params.request.postData || '').substring(0, 500)}`);
    }
  });

  // 현재 팝업에서 닫기 → 다시 파일 클릭 → 파일목록 API 캡처
  console.log('팝업 닫기...');
  await page.evaluate(() => {
    const btn = [...document.querySelectorAll('*')].find(el =>
      (el.innerText || '').trim() === '닫기' && el.getBoundingClientRect().width > 0 && el.childElementCount === 0
    );
    if (btn) btn.click();
  });
  await sleep(500);

  console.log('파일 클릭...');
  await page.evaluate(() => {
    const exts = ['.pdf', '.jpg', '.jpeg', '.png', '.hwp', '.xlsx', '.xls'];
    const fileEl = [...document.querySelectorAll('*')].find(el => {
      if (el.childElementCount > 0) return false;
      const t = (el.innerText || '').trim();
      return t.length > 3 && exts.some(ext => t.toLowerCase().endsWith(ext)) && getComputedStyle(el).cursor === 'pointer';
    });
    if (fileEl) fileEl.click();
  });
  await sleep(2000);

  console.log('\n=== retvFileList 응답 확인 ===');
  // retvFileList 응답을 가져오기
  const fileListResult = await page.evaluate(async () => {
    // 팝업 그리드에서 파일 정보 직접 추출
    // cl-grid 또는 테이블에서 파일명, 크기 등
    const rows = [...document.querySelectorAll('*')].filter(el => {
      const t = (el.innerText || '').trim();
      return t.includes('.pdf') && el.childElementCount > 2;
    });

    // 팝업 내 그리드 데이터
    const gridEls = document.querySelectorAll('[class*="cl-grid"]');
    const info = [];
    for (const g of gridEls) {
      const cells = g.querySelectorAll('[class*="cl-cell"]');
      for (const c of cells) {
        info.push((c.innerText || '').trim().substring(0, 100));
      }
    }
    return info;
  });
  console.log('팝업 그리드 데이터:', fileListResult);

  // 다운로드 버튼 클릭하고 요청 캡처
  console.log('\n다운로드 버튼 클릭...');
  await page.evaluate(() => {
    const btn = [...document.querySelectorAll('*')].find(el =>
      (el.innerText || '').trim() === '다운로드' && el.getBoundingClientRect().width > 0 && el.childElementCount === 0
    );
    if (btn) btn.click();
  });
  await sleep(3000);

  console.log('\n=== 캡처된 모든 요청 ===');
  for (const [url, info] of Object.entries(captured)) {
    console.log(`\nURL: ${url}`);
    console.log(`Method: ${info.method}`);
    console.log(`PostData: ${info.postData.substring(0, 1000)}`);
    console.log(`Content-Type: ${info.headers['Content-Type'] || info.headers['content-type'] || 'N/A'}`);
  }

  // 닫기
  await page.evaluate(() => {
    const btn = [...document.querySelectorAll('*')].find(el =>
      (el.innerText || '').trim() === '닫기' && el.getBoundingClientRect().width > 0 && el.childElementCount === 0
    );
    if (btn) btn.click();
  });

  await cdp.detach();
  await b.close();
})().catch(e => console.error('ERROR:', e.message));
