/**
 * 보탬e 집행내역 수집 v3
 * - CDP Network 레벨 인터셉트 (XHR/fetch/Service Worker 모두 캡처)
 * - 목록 복귀 → 조회 클릭 → 모든 retvLstExeCntt.do 응답 캡처
 * - PageDown으로 추가 페이지 로드
 * - Node.js fetch로 직접 나머지 페이지 가져오기
 */
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const OUTPUT = path.join(__dirname, 'projects/캠퍼스타운-고려대/data.json');
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

(async () => {
  const b = await chromium.connectOverCDP('http://localhost:9445', { timeout: 10000 });
  const page = b.contexts()[0].pages().find(p => p.url().includes('lss.do'));
  if (!page) { console.error('lss.do 탭 없음'); process.exit(1); }

  // ── CDP 세션: 네트워크 모니터링 ──
  const client = await page.context().newCDPSession(page);
  await client.send('Network.enable');

  const allItems = new Map(); // key: rn
  const capturedRequests = []; // 요청 파라미터 저장

  client.on('Network.requestWillBeSent', event => {
    if (event.request.url.includes('retvLstExeCntt')) {
      capturedRequests.push({
        requestId: event.requestId,
        url: event.request.url,
        method: event.request.method,
        postData: event.request.postData || '',
      });
    }
  });

  client.on('Network.responseReceived', async event => {
    if (!event.response.url.includes('retvLstExeCntt')) return;
    try {
      await sleep(200); // 응답 바디가 준비될 때까지 대기
      const resp = await client.send('Network.getResponseBody', { requestId: event.requestId }).catch(() => null);
      if (!resp) return;
      const body = resp.base64Encoded ? Buffer.from(resp.body, 'base64').toString('utf-8') : resp.body;
      const json = JSON.parse(body);
      const listKey = Object.keys(json).find(k => Array.isArray(json[k]));
      if (listKey && json[listKey].length > 0) {
        const items = json[listKey];
        items.forEach(item => allItems.set(item.rn || item.no, item));
        console.log(`  [API] ${items.length}건 수신 (rn: ${items[0].rn}~${items[items.length-1].rn}), 누계: ${allItems.size}`);
      }
    } catch (e) {
      // 응답 바디 읽기 실패 - 무시
    }
  });

  // ── 현재 페이지 상태 확인 및 목록 복귀 ──
  const isDetailPage = await page.evaluate(() => {
    const text = document.body.innerText;
    return text.includes('거래처 정보') || text.includes('증빙유형');
  });

  if (isDetailPage) {
    console.log('상세 페이지 → 목록으로 복귀...');
    await page.evaluate(() => {
      const allEls = [...document.querySelectorAll('div, a, li')];
      const listLink = allEls.find(el => {
        const t = (el.innerText || '').trim();
        return t === '집행내역 목록조회(민간회계사)' || t === '집행내역 목록조회';
      });
      if (listLink) { listLink.click(); return true; }
      return false;
    });
    await sleep(2000);
  }

  // ── 목록 페이지 확인 ──
  const listState = await page.evaluate(() => {
    const text = document.body.innerText;
    return {
      hasTotal: /총\s*\n?\s*\d+\s*\n?\s*건/.test(text),
      totalMatch: text.match(/총\s*\n?\s*(\d+)\s*\n?\s*건/)?.[1],
    };
  });
  console.log('목록 페이지:', listState.hasTotal, '총', listState.totalMatch, '건');

  // ── 1단계: 조회 버튼 클릭으로 첫 배치 로드 ──
  console.log('\n=== 1단계: 조회 버튼으로 데이터 로드 ===');
  const clickResult = await page.evaluate(() => {
    const allVisible = [...document.querySelectorAll('div,button,a')].filter(el => {
      const r = el.getBoundingClientRect();
      return r.width > 0 && el.childElementCount === 0;
    });
    const btn = allVisible.find(el => (el.innerText || '').trim() === '조회');
    if (btn) { btn.click(); return '조회 클릭'; }
    return '버튼 없음';
  });
  console.log(clickResult);
  await sleep(4000);

  console.log(`1단계 후 수집: ${allItems.size}건`);

  // ── 2단계: PageDown으로 추가 페이지 로드 ──
  console.log('\n=== 2단계: PageDown으로 추가 로드 ===');
  let prevCount = allItems.size;
  let stuck = 0;

  for (let i = 0; i < 50 && allItems.size < 685; i++) {
    await page.keyboard.press('PageDown');
    await sleep(1500);

    if (allItems.size > prevCount) {
      console.log(`  [PageDown ${i+1}] 누계: ${allItems.size}건`);
      stuck = 0;
      prevCount = allItems.size;
    } else {
      stuck++;
      if (stuck >= 5) {
        console.log('  5회 연속 새 데이터 없음');
        break;
      }
    }
  }

  console.log(`2단계 후 수집: ${allItems.size}건`);

  // ── 3단계: 마지막 수집된 요청 분석 + 직접 API 호출 ──
  if (allItems.size < 685 && capturedRequests.length > 0) {
    console.log('\n=== 3단계: 직접 API 호출로 나머지 수집 ===');
    console.log('캡처된 요청 파라미터:', JSON.stringify(capturedRequests[0]).substring(0, 200));

    const lastReq = capturedRequests[capturedRequests.length - 1];
    console.log('마지막 요청:', lastReq.postData.substring(0, 200));

    // 현재 수집 범위 파악
    const rnValues = [...allItems.keys()].sort((a, b) => a - b);
    const maxRn = rnValues[rnValues.length - 1] || 0;
    console.log(`현재 rn 범위: 1~${maxRn}`);

    // 부족한 구간 파악
    const missing = [];
    for (let rn = 1; rn <= 685; rn++) {
      if (!allItems.has(rn)) missing.push(rn);
    }
    console.log(`누락된 rn: ${missing.slice(0, 10).join(', ')}... 총 ${missing.length}개`);

    // page.evaluate()에서 fetch() 직접 호출 (브라우저 세션 활용)
    const nextRnToFetch = missing[0] || (maxRn + 1);
    if (nextRnToFetch <= 685) {
      // postData에서 pageIndex/startIndex 파라미터 찾기
      const postBody = lastReq.postData;
      const params = new URLSearchParams(postBody);
      console.log('파라미터 목록:');
      for (const [k, v] of params) {
        console.log(`  ${k}=${v}`);
      }
    }
  }

  // ── 결과 저장 ──
  console.log(`\n최종 수집: ${allItems.size}건`);

  if (capturedRequests.length > 0) {
    fs.writeFileSync('/tmp/botem-requests.json', JSON.stringify(capturedRequests, null, 2));
    console.log('요청 파라미터 저장: /tmp/botem-requests.json');
  }

  if (allItems.size > 0) {
    const unique = [...allItems.values()].sort((a, b) => (a.rn || a.no || 0) - (b.rn || b.no || 0));
    fs.writeFileSync('/tmp/botem-raw.json', JSON.stringify(unique.slice(0, 5), null, 2));

    // 첫 항목 키 분석
    const first = unique[0];
    console.log('\n첫 항목 API 키:');
    Object.entries(first || {}).forEach(([k, v]) => {
      if (v !== null && v !== undefined) console.log(`  ${k}: ${String(v).substring(0, 50)}`);
    });
  }

  await client.detach();
  await b.close();
})().catch(e => console.error('ERROR:', e.message));
