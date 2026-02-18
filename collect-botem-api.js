/**
 * 보탬e 집행내역 수집 - HTTP API 인터셉트 방식
 * retvLstExeCntt.do 엔드포인트 직접 호출로 전체 685건 수집
 *
 * 사용법:
 *   node collect-botem-api.js           # 전체 수집
 *   node collect-botem-api.js --capture # 1회 요청 파라미터 캡처만
 */
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const CAPTURE_ONLY = process.argv.includes('--capture');
const OUTPUT = path.join(__dirname, 'projects/캠퍼스타운-고려대/data.json');

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

(async () => {
  const b = await chromium.connectOverCDP('http://localhost:9445', { timeout: 10000 });
  const page = b.contexts()[0].pages().find(p => p.url().includes('lss.do'));
  if (!page) { console.error('lss.do 탭 없음'); process.exit(1); }

  const TARGET = 'retvLstExeCntt.do';
  const capturedRequests = [];
  const allData = [];

  // ── route()로 API 요청 가로채기 ──
  await page.route(`**/${TARGET}`, async (route) => {
    const req = route.request();
    const postData = req.postData() || '';
    console.log(`[인터셉트] POST ${TARGET} | body: ${postData.substring(0, 150)}`);

    // 원래 요청 계속 진행
    const resp = await route.fetch();
    const body = await resp.text();

    try {
      const json = JSON.parse(body);
      const listKey = Object.keys(json).find(k => Array.isArray(json[k]));
      if (listKey && json[listKey].length > 0) {
        console.log(`  → ${json[listKey].length}건 수신 (첫 rn=${json[listKey][0].rn})`);
        capturedRequests.push({ postData, responseKey: listKey, items: json[listKey] });
        if (!CAPTURE_ONLY) {
          allData.push(...json[listKey]);
          console.log(`  누계: ${allData.length}건`);
        }
      }
    } catch (e) {
      console.log('  → JSON 파싱 실패');
    }

    await route.fulfill({ response: resp, body });
  });

  // ── PageDown으로 페이지 이동하면서 데이터 수집 ──
  console.log('PageDown으로 페이지 순회 시작...');

  // 현재 날짜 확인 함수
  const getFirstDate = () => page.evaluate(() => {
    const cells = [...document.querySelectorAll('div')].filter(d => {
      if (d.childElementCount > 0) return false;
      return /^\d{4}-\d{2}-\d{2}$/.test((d.innerText || '').trim());
    });
    return cells[0]?.innerText.trim() || null;
  });

  // 첫 페이지로 이동 (K 버튼 = 첫 페이지)
  await page.evaluate(() => {
    const firstBtn = document.querySelector('[class*=cl-pageindexer-first]');
    if (firstBtn) {
      firstBtn.classList.remove('cl-disabled');
      firstBtn.click();
    }
  });
  await sleep(2000);

  let prevDate = await getFirstDate();
  console.log('현재 첫 날짜:', prevDate);

  if (CAPTURE_ONLY) {
    // 파라미터 캡처만 (1회 PageDown)
    await page.keyboard.press('PageDown');
    await sleep(3000);
    if (capturedRequests.length > 0) {
      const req = capturedRequests[0];
      console.log('\n=== 캡처된 요청 파라미터 ===');
      console.log('PostData:', req.postData);
      console.log('Response key:', req.responseKey);
      console.log('첫 항목 keys:', Object.keys(req.items[0] || {}));
      console.log('첫 항목:');
      Object.entries(req.items[0] || {}).forEach(([k, v]) => {
        console.log(`  ${k}: ${String(v).substring(0, 50)}`);
      });
      fs.writeFileSync('/tmp/botem-capture.json', JSON.stringify(capturedRequests[0], null, 2));
      console.log('\n저장: /tmp/botem-capture.json');
    } else {
      console.log('캡처 실패 - PageDown이 HTTP 요청을 안 트리거함');
    }
    await b.close();
    return;
  }

  // ── 전체 수집: PageDown 반복 ──
  const seenDates = new Set();
  let stuck = 0;
  let pageNum = 0;
  const MAX_PAGES = 30;

  while (pageNum < MAX_PAGES) {
    await page.keyboard.press('PageDown');
    await sleep(2000);

    const curDate = await getFirstDate();
    console.log(`[PageDown ${pageNum + 1}] 날짜: ${curDate}, 수집: ${allData.length}건`);

    if (curDate === prevDate) {
      stuck++;
      if (stuck >= 3) {
        console.log('3회 연속 변화 없음 → 종료');
        break;
      }
    } else {
      stuck = 0;
      prevDate = curDate;
    }

    if (seenDates.has(curDate) && seenDates.size > 5) {
      console.log('날짜가 반복됨 → 마지막 페이지');
      break;
    }
    if (curDate) seenDates.add(curDate);
    pageNum++;

    if (allData.length >= 685) {
      console.log('685건 달성!');
      break;
    }
  }

  console.log(`\n총 ${allData.length}건 수집`);

  if (allData.length > 0) {
    // 중복 제거 (rn 기준)
    const byRn = new Map();
    for (const item of allData) byRn.set(item.rn, item);
    const unique = [...byRn.values()].sort((a, b) => a.rn - b.rn);
    console.log('중복 제거 후:', unique.length, '건');

    // 원본 JSON 저장 (API 응답 그대로)
    const rawPath = path.join(__dirname, 'projects/캠퍼스타운-고려대/data-raw.json');
    fs.mkdirSync(path.dirname(rawPath), { recursive: true });
    fs.writeFileSync(rawPath, JSON.stringify(unique, null, 2));
    console.log('원본 저장:', rawPath);

    // data.json 형식으로 변환
    const mapped = unique.map(item => ({
      순번: String(item.rn || item.no || ''),
      집행실행일자: item.sbatExeCmptnYmd || item.exeDt || '',
      집행방식: item.exeTypNm || item.exeMethod || '',
      '집행목적 (용도)': item.sbatExePrposCn || item.purpose || '',
      '검증검토 진행상태': item.rvwPrgrSttus || item.status || '',
      '보조세목(통계목)': item.sbatSubtitleNm || item.subtitle || '',
      '지방비 집행금액': item.sbatExeAmount ? String(item.sbatExeAmount) : '',
      '자부담 집행금액': item.ownBurnExeAmount ? String(item.ownBurnExeAmount) : '0',
      불인정금액: item.dsalwAmount ? String(item.dsalwAmount) : '0',
      거래처명: item.trdpsNm || item.vendorNm || '',
      _api: item,
    }));

    // 첫 항목 키 출력 (어떤 필드가 있는지 확인용)
    if (unique.length > 0) {
      console.log('\n첫 항목 API 키:', Object.keys(unique[0]).join(', '));
      console.log('첫 항목 샘플:');
      const first = unique[0];
      Object.entries(first).forEach(([k, v]) => {
        if (v !== null && v !== undefined && String(v).length < 60) console.log(`  ${k}: ${v}`);
      });
    }

    fs.writeFileSync(OUTPUT, JSON.stringify(mapped, null, 2));
    console.log(`\n저장: ${OUTPUT}`);
  } else {
    console.log('\nAPI 데이터 없음 → 별도 분석 필요');
  }

  await b.close();
})().catch(e => console.error('ERROR:', e.message));
