/**
 * XHR/fetch 몽키패치로 API 파라미터 캡처
 * 브라우저 내에서 직접 요청을 가로채서 POST body 확인
 */
const { chromium } = require('playwright');
const fs = require('fs');
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

(async () => {
  const b = await chromium.connectOverCDP('http://localhost:9445', { timeout: 10000 });
  const page = b.contexts()[0].pages().find(p => p.url().includes('lss.do'));
  if (!page) { console.error('lss.do 탭 없음'); process.exit(1); }

  // 브라우저 컨텍스트에서 XHR/fetch 몽키패치 주입
  await page.evaluate(() => {
    window.__capturedApiCalls = [];

    // XHR 몽키패치
    const origXHROpen = XMLHttpRequest.prototype.open;
    const origXHRSend = XMLHttpRequest.prototype.send;

    XMLHttpRequest.prototype.open = function(method, url, ...args) {
      this._url = url;
      this._method = method;
      return origXHROpen.apply(this, [method, url, ...args]);
    };

    XMLHttpRequest.prototype.send = function(body) {
      if (this._url && this._url.includes('retvLstExeCntt')) {
        this.addEventListener('load', function() {
          window.__capturedApiCalls.push({
            type: 'XHR',
            url: this._url,
            method: this._method,
            requestBody: body,
            responseBody: this.responseText.substring(0, 2000),
            status: this.status,
          });
        }.bind(this));
      }
      return origXHRSend.apply(this, [body]);
    };

    // fetch 몽키패치
    const origFetch = window.fetch;
    window.fetch = async function(url, options = {}) {
      if (url && String(url).includes('retvLstExeCntt')) {
        const bodyText = options.body
          ? (typeof options.body === 'string' ? options.body : '(binary)')
          : '';
        const response = await origFetch.apply(this, [url, options]);
        const clone = response.clone();
        clone.text().then(respText => {
          window.__capturedApiCalls.push({
            type: 'fetch',
            url: String(url),
            method: (options.method || 'GET'),
            requestBody: bodyText,
            responseBody: respText.substring(0, 2000),
          });
        });
        return response;
      }
      return origFetch.apply(this, [url, options]);
    };

    console.log('몽키패치 완료');
  });

  console.log('몽키패치 주입 완료');

  // 조회 버튼 클릭
  const clicked = await page.evaluate(() => {
    const btns = [...document.querySelectorAll('div,button,a')].filter(el => {
      const t = (el.innerText || '').trim();
      const r = el.getBoundingClientRect();
      return t === '조회' && r.width > 0;
    });
    if (btns.length > 0) { btns[0].click(); return true; }
    return false;
  });
  console.log('조회 클릭:', clicked);
  await sleep(3000);

  // PageDown도 시도
  await page.keyboard.press('PageDown');
  await sleep(3000);
  await page.keyboard.press('PageDown');
  await sleep(3000);

  // 캡처된 호출 확인
  const calls = await page.evaluate(() => window.__capturedApiCalls || []);
  console.log(`\n캡처된 API 호출: ${calls.length}건`);

  calls.forEach((c, i) => {
    console.log(`\n--- 호출 ${i + 1} (${c.type}) ---`);
    console.log('URL:', c.url);
    console.log('Method:', c.method);
    console.log('Request body:', c.requestBody ? c.requestBody.substring(0, 300) : '(없음)');
    console.log('Response 앞부분:', c.responseBody ? c.responseBody.substring(0, 200) : '(없음)');
  });

  if (calls.length > 0) {
    fs.writeFileSync('/tmp/botem-api-calls.json', JSON.stringify(calls, null, 2));
    console.log('\n저장: /tmp/botem-api-calls.json');
  }

  await b.close();
})().catch(e => console.error('ERROR:', e.message));
