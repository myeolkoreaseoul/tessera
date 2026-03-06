/**
 * CDP Network 레벨에서 retvLstExeCntt.do POST body 캡처
 * 현재 페이지 상태 파악 + 다양한 트리거로 API 호출 유도
 */
const { chromium } = require('playwright');
const fs = require('fs');
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

(async () => {
  const b = await chromium.connectOverCDP('http://localhost:9445', { timeout: 10000 });
  const page = b.contexts()[0].pages().find(p => p.url().includes('lss.do'));
  if (!page) { console.error('lss.do 탭 없음'); process.exit(1); }

  // CDP 세션 설정
  const client = await page.context().newCDPSession(page);
  await client.send('Network.enable');

  const captured = [];
  client.on('Network.requestWillBeSent', event => {
    const url = event.request.url;
    if (url.includes('retvLstExeCntt') || url.includes('lss.do')) {
      if (!url.includes('.js') && !url.includes('.css')) {
        captured.push({
          url,
          method: event.request.method,
          postData: event.request.postData || '',
          headers: event.request.headers,
        });
        console.log(`[요청] ${event.request.method} ${url.substring(url.lastIndexOf('/') + 1)}`);
        if (event.request.postData) console.log('  body:', event.request.postData.substring(0, 200));
      }
    }
  });

  // 현재 페이지 상태 확인
  const state = await page.evaluate(() => {
    const text = document.body.innerText;
    const hasTotal = /총\s*\n?\s*\d+\s*\n?\s*건/.test(text);
    const hasDetailForm = text.includes('거래처 정보') && text.includes('증빙유형');
    const hasListMarker = text.includes('집행내역 목록');

    // 모든 버튼 텍스트 수집 (visible)
    const btns = [...document.querySelectorAll('div,button,a,span')].filter(el => {
      const r = el.getBoundingClientRect();
      const t = (el.innerText || '').trim();
      return r.width > 0 && t.length > 0 && t.length < 10 && el.childElementCount === 0;
    }).map(el => (el.innerText || '').trim()).filter(Boolean);
    const uniqueBtns = [...new Set(btns)].slice(0, 20);

    return { hasTotal, hasDetailForm, hasListMarker, uniqueBtns, bodyStart: text.substring(0, 100) };
  });

  console.log('현재 페이지:');
  console.log('  총건수 있음:', state.hasTotal);
  console.log('  상세폼:', state.hasDetailForm);
  console.log('  목록마커:', state.hasListMarker);
  console.log('  버튼들:', state.uniqueBtns.join(', '));
  console.log('  시작:', state.bodyStart.replace(/\n/g, '|').substring(0, 80));

  // 조회 버튼 또는 다음 페이지 트리거
  const triggerResult = await page.evaluate(() => {
    const results = [];
    const allVisible = [...document.querySelectorAll('div,button,a')].filter(el => {
      const r = el.getBoundingClientRect();
      return r.width > 0 && el.childElementCount === 0;
    });

    // "조회" 버튼
    const 조회Btn = allVisible.find(el => (el.innerText || '').trim() === '조회');
    if (조회Btn) { 조회Btn.click(); results.push('조회 클릭'); }

    return results;
  });
  console.log('\n트리거:', triggerResult);
  await sleep(3000);

  // 다음 방법들도 시도
  if (captured.length === 0) {
    // PageDown 여러번
    for (let i = 0; i < 5; i++) {
      await page.keyboard.press('PageDown');
      await sleep(1500);
    }
  }

  console.log(`\n캡처된 요청: ${captured.length}건`);
  captured.forEach((c, i) => {
    console.log(`\n[${i}] ${c.method} ${c.url.substring(c.url.lastIndexOf('/') + 1)}`);
    console.log('  postData:', c.postData.substring(0, 300));
  });

  if (captured.length > 0) {
    fs.writeFileSync('/tmp/botem-api-captured.json', JSON.stringify(captured, null, 2));
    console.log('\n저장: /tmp/botem-api-captured.json');
  }

  await client.detach();
  await b.close();
})().catch(e => console.error('ERROR:', e.message));
