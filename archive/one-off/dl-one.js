// 1건만 파일 다운로드 시도 — 네트워크 감시 + DOM 분석
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

  // 1. 파일 링크 주변 DOM 상세 분석
  const domInfo = await page.evaluate(() => {
    const exts = ['.pdf', '.jpg', '.jpeg', '.png', '.hwp', '.xlsx', '.xls'];
    const fileEl = [...document.querySelectorAll('*')].find(el => {
      if (el.childElementCount > 0) return false;
      const t = (el.innerText || '').trim();
      return t.length > 3 && exts.some(ext => t.toLowerCase().endsWith(ext)) && getComputedStyle(el).cursor === 'pointer';
    });
    if (!fileEl) return { found: false };

    // 부모 체인 분석
    const parents = [];
    let p = fileEl;
    for (let i = 0; i < 8 && p; i++) {
      parents.push({
        tag: p.tagName,
        cls: p.className.substring(0, 80),
        id: p.id,
        onclick: (p.getAttribute('onclick') || '').substring(0, 200),
        dataAttrs: [...p.attributes].filter(a => a.name.startsWith('data-')).map(a => `${a.name}=${a.value}`),
      });
      p = p.parentElement;
    }

    // 형제 요소
    const siblings = fileEl.parentElement ? [...fileEl.parentElement.children].map(el => ({
      tag: el.tagName,
      cls: el.className.substring(0, 60),
      text: (el.innerText || '').trim().substring(0, 60),
      onclick: (el.getAttribute('onclick') || '').substring(0, 200),
    })) : [];

    return {
      found: true,
      text: (fileEl.innerText || '').trim(),
      tag: fileEl.tagName,
      cls: fileEl.className,
      parents,
      siblings,
    };
  });

  console.log('=== 파일 링크 DOM 분석 ===');
  console.log(JSON.stringify(domInfo, null, 2));

  // 2. CDP로 네트워크 감시 시작
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Network.enable');

  const requests = [];
  cdp.on('Network.requestWillBeSent', (params) => {
    requests.push({
      url: params.request.url,
      method: params.request.method,
      type: params.type,
    });
  });

  // 3. 파일 링크 클릭
  console.log('\n=== 파일 링크 클릭 ===');
  await page.evaluate(() => {
    const exts = ['.pdf', '.jpg', '.jpeg', '.png', '.hwp', '.xlsx', '.xls'];
    const fileEl = [...document.querySelectorAll('*')].find(el => {
      if (el.childElementCount > 0) return false;
      const t = (el.innerText || '').trim();
      return t.length > 3 && exts.some(ext => t.toLowerCase().endsWith(ext)) && getComputedStyle(el).cursor === 'pointer';
    });
    if (fileEl) fileEl.click();
  });

  // 4. 대기 후 상태 확인
  await sleep(3000);

  console.log('\n=== 클릭 후 네트워크 요청 ===');
  requests.forEach(r => console.log(`${r.method} ${r.url.substring(0, 150)} [${r.type}]`));

  // 5. 팝업 확인
  await page.screenshot({ path: '/tmp/botem-after-click.png' });
  console.log('\n스크린샷: /tmp/botem-after-click.png');

  // 팝업 내 다운로드 관련 요소
  const popupInfo = await page.evaluate(() => {
    const allEls = [...document.querySelectorAll('*')].filter(el => {
      const r = el.getBoundingClientRect();
      return r.width > 0 && el.childElementCount === 0;
    });
    const dlBtns = allEls.filter(el => (el.innerText || '').trim() === '다운로드');
    const closeBtns = allEls.filter(el => (el.innerText || '').trim() === '닫기');

    return {
      hasDlBtn: dlBtns.length > 0,
      dlBtnInfo: dlBtns.map(el => ({
        tag: el.tagName,
        cls: el.className.substring(0, 80),
        onclick: (el.getAttribute('onclick') || '').substring(0, 200),
        parentOnclick: (el.parentElement?.getAttribute('onclick') || '').substring(0, 200),
      })),
      hasCloseBtn: closeBtns.length > 0,
    };
  });

  console.log('\n=== 팝업 정보 ===');
  console.log(JSON.stringify(popupInfo, null, 2));

  // 6. 다운로드 버튼이 있으면 클릭하고 네트워크 감시
  if (popupInfo.hasDlBtn) {
    console.log('\n=== 다운로드 버튼 클릭 ===');
    requests.length = 0; // 초기화

    await page.evaluate(() => {
      const btn = [...document.querySelectorAll('*')].find(el => {
        return (el.innerText || '').trim() === '다운로드' &&
          el.getBoundingClientRect().width > 0 && el.childElementCount === 0;
      });
      if (btn) btn.click();
    });

    await sleep(5000);

    console.log('다운로드 후 네트워크 요청:');
    requests.forEach(r => console.log(`${r.method} ${r.url.substring(0, 200)} [${r.type}]`));

    // 새 탭 확인
    const allPages = ctx.pages();
    console.log(`\n탭 수: ${allPages.length}`);
    for (const p of allPages) {
      if (p !== page) {
        console.log(`다른 탭: ${p.url().substring(0, 200)}`);
      }
    }
  }

  await cdp.detach();
  await b.close();
})().catch(e => console.error('ERROR:', e.message));
