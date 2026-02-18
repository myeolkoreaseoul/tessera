/**
 * f_retrieveListBsnsExcutDetl 함수 소스 + AJAX 파라미터 탐색
 */
const { chromium } = require('playwright');

process.on('unhandledRejection', (err) => {
  if (err && err.message && err.message.includes('No dialog is showing')) return;
});

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function main() {
  const browser = await chromium.connectOverCDP('http://localhost:9444');
  const context = browser.contexts()[0];
  let page = context.pages().find(p => p.url().includes('dd001'));
  if (!page) { console.log('페이지 없음'); return; }
  page.on('dialog', async d => { try { await d.accept(); } catch {} });

  // 1. f_retrieveListBsnsExcutDetl 소스 확인
  const fnSource = await page.evaluate(() => {
    if (typeof f_retrieveListBsnsExcutDetl === 'function') {
      return f_retrieveListBsnsExcutDetl.toString();
    }
    return 'not found';
  });
  console.log('=== f_retrieveListBsnsExcutDetl ===');
  console.log(fnSource);

  // 2. 관련 함수들 소스
  const relatedFns = await page.evaluate(() => {
    const result = {};
    const names = ['f_retrieveListBsnsExcutDetl', 'f_retrieve', 'f_search',
      'f_detlListExmnt', 'f_clickGrid'];
    for (const name of names) {
      if (typeof window[name] === 'function') {
        const src = window[name].toString();
        if (src.length < 2000) result[name] = src;
        else result[name] = src.substring(0, 2000) + '...';
      }
    }
    return result;
  });

  for (const [name, src] of Object.entries(relatedFns)) {
    if (name !== 'f_retrieveListBsnsExcutDetl') {
      console.log(`\n=== ${name} ===`);
      console.log(src);
    }
  }

  // 3. 세부내역검토 버튼의 이벤트 핸들러
  const btnHandler = await page.evaluate(() => {
    const btn = document.getElementById('DD001002Q_detlListExmnt');
    if (!btn) return 'btn not found';

    // jQuery 이벤트 확인
    if (window.jQuery) {
      const events = jQuery._data(btn, 'events');
      if (events && events.click) {
        return events.click.map(e => e.handler.toString()).join('\n---\n');
      }
    }
    return 'no handler found';
  });
  console.log('\n=== 세부내역검토 버튼 핸들러 ===');
  console.log(btnHandler);

  // 4. IBCombo / SBCombo 확인
  const comboInfo = await page.evaluate(() => {
    const result = {};

    // IBCombo 전역 객체 확인
    if (typeof IBCombo !== 'undefined') result.IBCombo = 'exists';
    if (typeof SBCombo !== 'undefined') result.SBCombo = 'exists';

    // DD001002Q 관련 전역 변수 중 combo 관련
    for (const key of Object.keys(window)) {
      if (key.includes('DD001002Q') && key.toLowerCase().includes('combo')) {
        result[key] = typeof window[key];
      }
      if (key.includes('DD001002Q') && key.includes('exmnt')) {
        const val = window[key];
        result[key] = typeof val === 'object' ? JSON.stringify(val).substring(0, 200) : String(val);
      }
    }

    // 모든 IBCombo 요소
    const combos = document.querySelectorAll('.IBCombo, .SBCombo, [class*="Combo"]');
    result.comboElements = Array.from(combos).map(c => ({
      id: c.id,
      className: (c.className || '').substring(0, 60),
      text: (c.textContent || '').trim().substring(0, 30),
    }));

    return result;
  });
  console.log('\n=== Combo 정보 ===');
  console.log(JSON.stringify(comboInfo, null, 2));

  // 5. AJAX 인터셉트 설치 후 조회
  console.log('\n=== AJAX 인터셉트 ===');
  await page.evaluate(() => {
    window._capturedAjax = [];
    const origOpen = XMLHttpRequest.prototype.open;
    const origSend = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.open = function(method, url) {
      this._capturedUrl = url;
      this._capturedMethod = method;
      return origOpen.apply(this, arguments);
    };
    XMLHttpRequest.prototype.send = function(body) {
      window._capturedAjax.push({
        url: this._capturedUrl,
        method: this._capturedMethod,
        body: typeof body === 'string' ? body.substring(0, 500) : null,
      });
      return origSend.apply(this, arguments);
    };
  });

  // 조회 실행
  await page.evaluate(() => f_retrieveListBsnsExcutDetl(1));
  await sleep(3000);
  await page.evaluate(() => {
    document.querySelectorAll('.popupMask.on .fn.ok').forEach(b => b.click());
  });

  const captured = await page.evaluate(() => window._capturedAjax);
  console.log('캡처된 AJAX:');
  captured.forEach((req, i) => {
    console.log(`  [${i}] ${req.method} ${req.url}`);
    if (req.body) console.log(`      body: ${req.body}`);
  });

  // 인터셉트 해제
  await page.evaluate(() => { delete window._capturedAjax; });
}

main().catch(console.error);
