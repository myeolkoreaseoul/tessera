/**
 * 보탬e 데이터 소스 탐색
 * 1. window 전역에 685건 데이터 있는지 스캔
 * 2. HTTP 요청 캡처 후 조회 버튼 클릭
 * 3. 키보드로 페이지 이동 시도
 */
const { chromium } = require('playwright');
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

(async () => {
  const b = await chromium.connectOverCDP('http://localhost:9445', { timeout: 10000 });
  const page = b.contexts()[0].pages().find(p => p.url().includes('lss.do'));
  if (!page) { console.error('lss.do 탭 없음'); process.exit(1); }

  // ── 1. window 스캔: 30개+ 배열 찾기 ──
  const windowScan = await page.evaluate(() => {
    const found = [];
    for (const key of Object.keys(window)) {
      try {
        const v = window[key];
        if (Array.isArray(v) && v.length >= 30) {
          found.push({ key, len: v.length, sample: JSON.stringify(v[0]).substring(0, 80) });
        }
        if (v && typeof v === 'object' && !Array.isArray(v)) {
          try {
            const name = v.constructor ? v.constructor.name : '';
            if (name !== 'Window' && name !== 'Document') {
              for (const k2 of Object.keys(v).slice(0, 20)) {
                try {
                  const v2 = v[k2];
                  if (Array.isArray(v2) && v2.length >= 30) {
                    found.push({ key: key + '.' + k2, len: v2.length, sample: JSON.stringify(v2[0]).substring(0, 80) });
                  }
                } catch (e) {}
              }
            }
          } catch (e) {}
        }
      } catch (e) {}
    }
    return found;
  });

  console.log('=== window에서 30개+ 배열 ===');
  if (windowScan.length === 0) console.log('없음');
  else windowScan.forEach(x => console.log(' ', JSON.stringify(x)));

  // ── 2. HTTP 요청 캡처 설정 ──
  const captured = [];
  page.on('requestfinished', async req => {
    try {
      const url = req.url();
      const skip = ['.js', '.css', '.png', '.gif', '.jpg', '.woff', 'chrome-extension', 'favicon'];
      if (skip.some(s => url.includes(s))) return;
      const resp = await req.response();
      if (!resp) return;
      const text = await resp.text().catch(() => '');
      if (text.length > 100) {
        captured.push({ url: url.substring(0, 100), len: text.length, preview: text.substring(0, 100) });
      }
    } catch (e) {}
  });

  // ── 3. 조회 버튼 클릭 ──
  const clickResult = await page.evaluate(() => {
    const btns = [...document.querySelectorAll('div,button,a')].filter(el => {
      const t = (el.innerText || '').trim();
      const r = el.getBoundingClientRect();
      return (t === '조회' || t === '검색') && r.width > 0;
    });
    if (btns.length > 0) {
      btns[0].click();
      return '클릭: ' + btns[0].innerText.trim();
    }
    return '버튼 없음';
  });
  console.log('\n조회 버튼:', clickResult);
  await sleep(5000);

  console.log('\n=== 캡처된 HTTP 요청 ===');
  if (captured.length === 0) console.log('없음 → WS로 통신하는 것으로 보임');
  else captured.forEach(c => console.log(' ', JSON.stringify(c)));

  // ── 4. 현재 보이는 행 수 확인 ──
  const rowInfo = await page.evaluate(() => {
    const text = document.body.innerText;
    const dates = (text.match(/\d{4}-\d{2}-\d{2}/g) || []);
    const totalMatch = text.match(/총\s*\n?\s*(\d+)\s*\n?\s*건/);
    return { dates: dates.length, total: totalMatch ? totalMatch[1] : '?', bodyLen: text.length };
  });
  console.log('\n현재 상태:', rowInfo);

  // ── 5. 키보드로 페이지 이동 시도 ──
  console.log('\n=== 키보드 페이지 이동 시도 ===');
  // pager에 포커스
  await page.evaluate(() => {
    const pager = document.querySelector('[class*=cl-pageindexer]');
    if (pager) pager.focus();
  });

  const beforeSeqs = await page.evaluate(() => {
    const cells = [...document.querySelectorAll('div')].filter(d => {
      if (d.childElementCount > 0) return false;
      return /^\d{4}-\d{2}-\d{2}$/.test((d.innerText || '').trim());
    });
    return cells.map(d => d.innerText.trim());
  });
  console.log('키보드 전 날짜 수:', beforeSeqs.length, '첫 날짜:', beforeSeqs[0]);

  // PageDown 키 시도
  await page.keyboard.press('PageDown');
  await sleep(2000);

  const afterSeqs = await page.evaluate(() => {
    const cells = [...document.querySelectorAll('div')].filter(d => {
      if (d.childElementCount > 0) return false;
      return /^\d{4}-\d{2}-\d{2}$/.test((d.innerText || '').trim());
    });
    return cells.map(d => d.innerText.trim());
  });
  console.log('PageDown 후 날짜 수:', afterSeqs.length, '첫 날짜:', afterSeqs[0]);
  console.log('변화:', beforeSeqs[0] !== afterSeqs[0] ? '페이지 이동!' : '변화 없음');

  await b.close();
})().catch(e => console.error('ERROR:', e.message));
