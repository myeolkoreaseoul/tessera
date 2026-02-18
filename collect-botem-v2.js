/**
 * 보탬e 집행내역 수집 v2
 * - 정렬 방향 무관 (오름/내림차순 모두 대응)
 * - cl-pageindexer-next 직접 클릭 (cl-disabled 없을 때)
 * - 내림차순 정렬 시 마지막 페이지 = 순번1 (가장 오래된 데이터)
 *
 * 사용법:
 *   node collect-botem-v2.js           # 전체 수집
 *   node collect-botem-v2.js --dry-run # 현재 페이지만
 */
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const DRY_RUN = process.argv.includes('--dry-run');
const OUTPUT = path.join(__dirname, 'projects/캠퍼스타운-고려대/data.json');

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

const COLS = [
  '순번', '집행실행일자', '집행방식', '집행목적 (용도)',
  '검증검토 진행상태', '보조세목(통계목)', '지방비 집행금액', '자부담 집행금액',
  '불인정금액', '거래처명',
];

// ── innerText 파싱 ──
// 정렬 방향 무관: \n숫자\n날짜\n 패턴으로 행 분리
function parseRows(text) {
  const t = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').replace(/\t/g, ' ');

  // "집행내역 목록" 이후 구간만 처리
  const listMarker = t.indexOf('집행내역 목록');
  if (listMarker === -1) return [];

  const section = t.substring(listMarker);

  // 첫 번째 데이터 행: \n숫자\n날짜\n (숫자 1~4자리, 오름/내림차순 모두)
  const firstRowRe = /\n(\d{1,4})\n(\d{4}-\d{2}-\d{2})\n/;
  const firstMatch = section.match(firstRowRe);
  if (!firstMatch) return [];

  const dataStart = listMarker + section.indexOf(firstMatch[0]) + 1;
  let dataSection = t.substring(dataStart);

  // 페이지네이션 하단 마커 (숫자만 있는 줄 연속 or 특정 키워드)
  // "집행계획대비 실적조회" 이후 자르기
  const footerMarker = dataSection.search(/\n집행계획대비 실적조회\n|\n업무 따라하기\n|\n이자 및 수익금/);
  if (footerMarker > 0) dataSection = dataSection.substring(0, footerMarker);

  // 행 분리: \n순번\n날짜\n 경계
  const rowBoundary = /(?=\n\d{1,4}\n\d{4}-\d{2}-\d{2}\n)/g;
  const parts = dataSection.split(rowBoundary).map(s => s.trim()).filter(Boolean);

  const STATUS_VOCAB = ['미검토', '검토완료', '미검토판', '검토중', '반려'];
  const METHOD_VOCAB = ['기타', '전자세금계산서', '지로', '수납', '법인카드', '계좌이체', '현금', '어음', '보조금전용신용카드', '보조금전용카드'];

  const rows = [];
  for (const part of parts) {
    const tokens = part.split('\n').map(s => s.trim()).filter(Boolean);
    if (tokens.length < 5) continue;

    if (!/^\d{1,4}$/.test(tokens[0])) continue;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(tokens[1])) continue;

    // 검증검토 진행상태 위치 찾기
    let statusIdx = -1;
    for (let i = 3; i < tokens.length; i++) {
      if (STATUS_VOCAB.some(s => tokens[i].startsWith(s))) {
        statusIdx = i;
        break;
      }
    }
    if (statusIdx === -1) continue;

    const method = tokens[2];
    const purposeStart = METHOD_VOCAB.some(m => tokens[2].includes(m)) ? 3 : 2;
    const purposeStr = tokens.slice(purposeStart, statusIdx).join(' ');
    const rest = tokens.slice(statusIdx);

    rows.push({
      순번: tokens[0],
      집행실행일자: tokens[1],
      집행방식: method,
      '집행목적 (용도)': purposeStr || method,
      '검증검토 진행상태': rest[0] || '',
      '보조세목(통계목)': rest[1] || '',
      '지방비 집행금액': rest[2] || '',
      '자부담 집행금액': rest[3] || '',
      불인정금액: rest[4] || '',
      거래처명: rest[5] || '',
      _raw: tokens,
    });
  }
  return rows;
}

// ── 다음 페이지 클릭 (컨테이너 확장 후 클릭) ──
async function clickNext(page) {
  return page.evaluate(() => {
    const btn = document.querySelector('[class*=cl-pageindexer-next]');
    if (!btn) return false;
    if (btn.classList.contains('cl-disabled')) return false;

    // 부모 컨테이너 h=0 확장 (클릭이 무시되지 않도록)
    let el = btn.parentElement;
    while (el && el !== document.body) {
      const r = el.getBoundingClientRect();
      if (r.height === 0 || r.width === 0) {
        el.style.overflow = 'visible';
        el.style.minHeight = '50px';
        el.style.minWidth = '300px';
      }
      el = el.parentElement;
    }

    // 다양한 이벤트 방식으로 클릭 시도
    btn.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, view: window }));
    btn.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, view: window }));
    btn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
    return true;
  });
}

// ── 첫 페이지로 이동 ──
async function goToFirstPage(page) {
  await page.evaluate(() => {
    // 방법1: cl-pageindexer-first 버튼
    const firstBtn = document.querySelector('[class*=cl-pageindexer-first]');
    if (firstBtn && !firstBtn.classList.contains('cl-disabled')) {
      firstBtn.click();
      return;
    }
    // 방법2: 페이지 번호 "1" 클릭
    const pageLinks = [...document.querySelectorAll('[class*=cl-pageindexer-index]:not([class*=area])')];
    const p1 = pageLinks.find(el => el.innerText.trim() === '1');
    if (p1) p1.click();
  });
}

async function main() {
  const browser = await chromium.connectOverCDP('http://localhost:9445', { timeout: 10000 })
    .catch(e => { console.error('CDP 연결 실패:', e.message); process.exit(1); });

  const context = browser.contexts()[0];
  const page = context.pages().find(p => p.url().includes('lss.do'));
  if (!page) { console.error('lss.do 탭 없음'); await browser.close(); process.exit(1); }
  page.on('dialog', async d => { try { await d.accept(); } catch {} });

  // 현재 상태 확인
  const state = await page.evaluate(() => {
    const prevBtn = document.querySelector('[class*=cl-pageindexer-prev]');
    const nextBtn = document.querySelector('[class*=cl-pageindexer-next]');
    const totalMatch = document.body.innerText.match(/총\s*\n?\s*(\d+)\s*\n?\s*건/);
    return {
      prevDisabled: prevBtn?.classList.contains('cl-disabled'),
      nextDisabled: nextBtn?.classList.contains('cl-disabled'),
      total: totalMatch?.[1],
    };
  });
  console.log(`총 ${state.total}건 확인, prev=${state.prevDisabled?'disabled':'ok'}, next=${state.nextDisabled?'disabled':'ok'}`);

  // 페이지 1로 이동 (이미 page 1이면 skip)
  if (!state.prevDisabled) {
    console.log('첫 페이지로 이동 중...');
    await goToFirstPage(page);
    await sleep(2000);
  }

  const allRows = new Map(); // key: 순번, value: row (중복 제거)
  let pageNum = 1;
  const maxPages = DRY_RUN ? 1 : 200;

  while (pageNum <= maxPages) {
    const text = await page.evaluate(() => document.body.innerText);
    const rows = parseRows(text);

    if (rows.length === 0) {
      console.log(`페이지 ${pageNum}: 데이터 없음`);
      break;
    }

    let newCount = 0;
    for (const row of rows) {
      if (!allRows.has(row.순번)) {
        allRows.set(row.순번, row);
        newCount++;
      }
    }
    console.log(`페이지 ${pageNum}: ${rows.length}행 추출 (신규 ${newCount}, 누계 ${allRows.size})`);

    if (pageNum === 1) {
      const sample = rows[0];
      console.log('  첫행 샘플:', JSON.stringify({ 순번: sample.순번, 날짜: sample.집행실행일자, 목적: sample['집행목적 (용도)']?.substring(0, 30) }));
    }

    if (DRY_RUN) break;

    // 다음 페이지 클릭
    const hasNext = await clickNext(page);
    if (!hasNext) {
      console.log('마지막 페이지 (next disabled)');
      break;
    }

    // 페이지 로드 대기 (첫 순번 변화 확인, 최대 5초)
    const prevFirstSeq = rows[0].순번;
    let waited = 0;
    let changed = false;
    while (waited < 5000 && !changed) {
      await sleep(600);
      waited += 600;
      const newText = await page.evaluate(() => document.body.innerText);
      const newRows = parseRows(newText);
      if (newRows.length > 0 && newRows[0].순번 !== prevFirstSeq) {
        changed = true;
      }
    }
    if (!changed) {
      // 5초 내에 변화 없으면 추가 대기
      await sleep(1000);
    }

    pageNum++;
  }

  console.log(`\n총 ${allRows.size}건 수집`);

  if (allRows.size === 0) {
    await browser.close();
    process.exit(1);
  }

  // 순번 기준 정렬
  const sorted = [...allRows.values()].sort((a, b) => parseInt(a.순번) - parseInt(b.순번));

  if (!DRY_RUN) {
    fs.mkdirSync(path.dirname(OUTPUT), { recursive: true });
    fs.writeFileSync(OUTPUT, JSON.stringify(sorted, null, 2), 'utf-8');
    const kb = Math.round(fs.statSync(OUTPUT).size / 1024);
    console.log(`저장: ${OUTPUT} (${kb}KB)`);

    // 요약
    const catMap = {};
    for (const r of sorted) {
      const cat = r['보조세목(통계목)'] || '(미분류)';
      catMap[cat] = (catMap[cat] || 0) + 1;
    }
    console.log('\n보조세목별:');
    Object.entries(catMap).sort((a, b) => b[1] - a[1]).forEach(([k, v]) => console.log(`  ${k}: ${v}건`));
  } else {
    console.log('\n[DRY-RUN] 첫 3행:');
    sorted.slice(0, 3).forEach(r => console.log(' ', JSON.stringify({ 순번: r.순번, 날짜: r.집행실행일자, 방식: r.집행방식, 목적: r['집행목적 (용도)']?.substring(0, 30) })));
  }

  await browser.close();
}

main().catch(e => { console.error('ERROR:', e.message); process.exit(1); });
