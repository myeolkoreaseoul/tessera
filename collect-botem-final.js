/**
 * 보탬e 집행내역 전체 수집 - 직접 API 호출
 * page.evaluate()에서 fetch() 사용 (브라우저 세션/쿠키 자동 적용)
 *
 * API: POST /sm/clcn/privClrv/rvwIxInqSvi/retvLstExeCntt.do
 * 파라미터: fyr, pfmBizId, pfmInstId, curPage, pageSize 등
 */
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const OUTPUT = path.join(__dirname, 'projects/캠퍼스타운-고려대/data.json');
const TOTAL = 685;
const PAGE_SIZE = 40;
const TOTAL_PAGES = Math.ceil(TOTAL / PAGE_SIZE);

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// API 응답을 data.json 형식으로 변환
function mapItem(item) {
  const dateStr = item.sbatExeCmptnYmd || '';
  const date = dateStr.length === 8
    ? `${dateStr.substring(0, 4)}-${dateStr.substring(4, 6)}-${dateStr.substring(6, 8)}`
    : dateStr;

  // 금액 포맷 (원 단위, 천단위 콤마)
  const fmtAmt = v => v != null && v !== '' ? Number(v).toLocaleString('ko-KR') : '0';

  return {
    순번: String(item.rn || item.no || ''),
    집행실행일자: date,
    집행방식: item.exeMthdDvCdNm || '',
    '집행목적 (용도)': item.exePurpCn || item.exePurpCnSmy || '',
    '검증검토 진행상태': item.clrvPrgStatCdNm || '',
    '보조세목(통계목)': item.atitNm || '',
    '지방비 집행금액': fmtAmt(item.sbatExeSumAmt),
    '자부담 집행금액': fmtAmt(item.pyhwyExeSumAmt),
    불인정금액: fmtAmt(item.nackAmt),
    거래처명: item.cltNm || '',
    계약정보등록여부: item.ctrtMngNoYn || '',
    중요재산등록여부: item.imprMngNoYn || '',
    _raw: item,
  };
}

(async () => {
  const b = await chromium.connectOverCDP('http://localhost:9445', { timeout: 10000 });
  const page = b.contexts()[0].pages().find(p => p.url().includes('lss.do'));
  if (!page) { console.error('lss.do 탭 없음'); process.exit(1); }

  // 기본 파라미터 (요청 캡처에서 확인된 값)
  const baseParams = {
    fyr: '2025',
    pfmBizId: '20253070000000296751',
    pfmInstId: '000000058109',
    clrvPrgStatCd: '',
    srchBgngYmd: '20250101',
    srchEndYmd: '20260218',
    exeMthdDvCd: '',
    atitCd: '',
    pageSize: PAGE_SIZE,
    totalCnt: TOTAL,
    ctrtMngNoYn: '',
    imprMngNoYn: '',
  };

  const allItems = new Map();
  const API_URL = '/sm/clcn/privClrv/rvwIxInqSvi/retvLstExeCntt.do';

  console.log(`총 ${TOTAL}건, ${PAGE_SIZE}건/페이지, ${TOTAL_PAGES}페이지`);

  for (let page_num = 1; page_num <= TOTAL_PAGES; page_num++) {
    const params = { ...baseParams, curPage: page_num };
    const bodyStr = JSON.stringify(params);

    const result = await page.evaluate(async ({ url, body }) => {
      try {
        const resp = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json, text/plain, */*',
          },
          body,
        });
        const text = await resp.text();
        return { status: resp.status, body: text };
      } catch (e) {
        return { error: e.message };
      }
    }, { url: API_URL, body: bodyStr });

    if (result.error) {
      console.log(`페이지 ${page_num}: 에러 - ${result.error}`);
      // Content-Type을 form-urlencoded로 재시도
      const formResult = await page.evaluate(async ({ url, params }) => {
        try {
          const body = Object.entries(params).map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&');
          const resp = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body,
          });
          const text = await resp.text();
          return { status: resp.status, body: text };
        } catch (e) {
          return { error: e.message };
        }
      }, { url: API_URL, params });

      if (formResult.error) {
        console.log(`  form-urlencoded도 실패: ${formResult.error}`);
        continue;
      }
      Object.assign(result, formResult);
    }

    if (result.status !== 200) {
      console.log(`페이지 ${page_num}: HTTP ${result.status}`);
      console.log('  응답:', result.body?.substring(0, 100));
      continue;
    }

    try {
      const json = JSON.parse(result.body);
      const listKey = Object.keys(json).find(k => Array.isArray(json[k]));
      if (!listKey) {
        console.log(`페이지 ${page_num}: 배열 키 없음`, Object.keys(json));
        continue;
      }
      const items = json[listKey];
      items.forEach(item => allItems.set(item.rn || item.no, item));
      console.log(`페이지 ${page_num}/${TOTAL_PAGES}: ${items.length}건 (rn: ${items[0]?.rn}~${items[items.length-1]?.rn}), 누계: ${allItems.size}`);
    } catch (e) {
      console.log(`페이지 ${page_num}: JSON 파싱 실패`, result.body?.substring(0, 100));
    }

    await sleep(200); // 서버 부하 방지
  }

  console.log(`\n최종 수집: ${allItems.size}건 / ${TOTAL}건`);

  if (allItems.size === 0) {
    console.log('수집 실패. 프로그램 종료.');
    await b.close();
    process.exit(1);
  }

  // 순번 정렬
  const sorted = [...allItems.values()].sort((a, b) => (a.rn || a.no || 0) - (b.rn || b.no || 0));

  // data.json 형식으로 변환
  const mapped = sorted.map(mapItem);

  // 저장
  fs.mkdirSync(path.dirname(OUTPUT), { recursive: true });
  fs.writeFileSync(OUTPUT, JSON.stringify(mapped, null, 2), 'utf-8');
  const kb = Math.round(fs.statSync(OUTPUT).size / 1024);
  console.log(`저장: ${OUTPUT} (${kb}KB)`);

  // 요약 통계
  const catMap = {};
  for (const r of mapped) {
    const cat = r['보조세목(통계목)'] || '(미분류)';
    catMap[cat] = (catMap[cat] || 0) + 1;
  }
  console.log('\n보조세목별:');
  Object.entries(catMap).sort((a, b) => b[1] - a[1]).forEach(([k, v]) => console.log(`  ${k}: ${v}건`));

  const statusMap = {};
  for (const r of mapped) {
    const s = r['검증검토 진행상태'] || '(미설정)';
    statusMap[s] = (statusMap[s] || 0) + 1;
  }
  console.log('\n검증검토 진행상태별:');
  Object.entries(statusMap).sort((a, b) => b[1] - a[1]).forEach(([k, v]) => console.log(`  ${k}: ${v}건`));

  await b.close();
})().catch(e => console.error('ERROR:', e.message));
