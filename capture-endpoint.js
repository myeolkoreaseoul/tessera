/**
 * retvLstExeCntt.do 엔드포인트 전체 파라미터 캡처
 * 조회 버튼 클릭 → 요청/응답 전체 저장
 */
const { chromium } = require('playwright');
const fs = require('fs');
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

(async () => {
  const b = await chromium.connectOverCDP('http://localhost:9445', { timeout: 10000 });
  const page = b.contexts()[0].pages().find(p => p.url().includes('lss.do'));
  if (!page) { console.error('lss.do 탭 없음'); process.exit(1); }

  const TARGET_URL = 'retvLstExeCntt.do';
  const captured = [];

  // 요청/응답 전체 캡처
  page.on('request', req => {
    if (req.url().includes(TARGET_URL)) {
      captured.push({
        type: 'request',
        url: req.url(),
        method: req.method(),
        headers: req.headers(),
        postData: req.postData(),
      });
    }
  });

  page.on('requestfinished', async req => {
    if (req.url().includes(TARGET_URL)) {
      try {
        const resp = await req.response();
        const body = await resp.text();
        const idx = captured.findIndex(c => c.type === 'request' && c.url === req.url());
        captured.push({
          type: 'response',
          url: req.url(),
          status: resp.status(),
          body: body,
          bodyLen: body.length,
        });
      } catch (e) {}
    }
  });

  // 조회 버튼 클릭 → 첫 페이지 데이터 요청
  await page.evaluate(() => {
    const btns = [...document.querySelectorAll('div,button,a')].filter(el => {
      const t = (el.innerText || '').trim();
      const r = el.getBoundingClientRect();
      return t === '조회' && r.width > 0;
    });
    if (btns.length > 0) btns[0].click();
  });
  await sleep(4000);

  // 결과 분석
  const requests = captured.filter(c => c.type === 'request');
  const responses = captured.filter(c => c.type === 'response');

  console.log(`요청 ${requests.length}건, 응답 ${responses.length}건`);

  if (requests.length > 0) {
    const req = requests[0];
    console.log('\n=== 요청 상세 ===');
    console.log('URL:', req.url);
    console.log('Method:', req.method);
    console.log('PostData:', req.postData);
    console.log('Headers (일부):');
    const important = ['content-type', 'cookie', 'x-csrf-token', 'authorization', 'referer'];
    for (const [k, v] of Object.entries(req.headers || {})) {
      if (important.some(i => k.toLowerCase().includes(i))) {
        console.log(`  ${k}: ${v.substring(0, 100)}`);
      }
    }
  }

  if (responses.length > 0) {
    const resp = responses[0];
    console.log('\n=== 응답 상세 ===');
    console.log('Status:', resp.status);
    console.log('Body length:', resp.bodyLen);

    try {
      const json = JSON.parse(resp.body);
      const keys = Object.keys(json);
      console.log('JSON keys:', keys);
      const listKey = keys.find(k => Array.isArray(json[k]));
      if (listKey) {
        console.log('Array key:', listKey, '길이:', json[listKey].length);
        console.log('첫 항목 keys:', Object.keys(json[listKey][0] || {}));
        console.log('첫 항목 샘플:');
        const first = json[listKey][0];
        for (const [k, v] of Object.entries(first || {})) {
          if (v && String(v).length < 50) console.log(`  ${k}: ${v}`);
        }
      }
    } catch (e) {
      console.log('JSON 파싱 실패:', e.message);
      console.log('Body 앞부분:', resp.body.substring(0, 200));
    }

    // 전체 저장
    fs.writeFileSync('/tmp/botem-response.json', resp.body);
    console.log('\n응답 저장: /tmp/botem-response.json');
  }

  // 요청 정보 저장 (쿠키, 헤더 등)
  if (requests.length > 0) {
    fs.writeFileSync('/tmp/botem-request.json', JSON.stringify(requests[0], null, 2));
    console.log('요청 저장: /tmp/botem-request.json');
  }

  await b.close();
})().catch(e => console.error('ERROR:', e.message));
