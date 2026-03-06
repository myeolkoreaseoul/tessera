/**
 * 보탬e 집행내역 수집 - innerText 파싱 + 보이는 pager 사용
 * node collect-botem.js
 * node collect-botem.js --dry-run   # 1페이지만
 */
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const DRY_RUN = process.argv.includes('--dry-run');
const OUTPUT = path.join(__dirname, 'projects/캠퍼스타운-고려대/data.json');

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ── innerText 파싱: 현재 페이지의 그리드 행 추출 ──
function parseRows(text, pageNum) {
  const t = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').replace(/\t/g, ' ');

  const listMarker = t.indexOf('집행내역 목록');
  if (listMarker === -1) return [];

  // 페이지 1: "\n1\n날짜\n", 페이지 2+: 첫 순번이 11, 21 등
  // 범용: "집행내역 목록" 이후의 첫 "\n숫자\n날짜\n" 패턴
  const firstRowRe = /\n(\d{1,4})\n(\d{4}-\d{2}-\d{2})\n/;
  const afterList = t.substring(listMarker);
  const firstRowMatch = afterList.match(firstRowRe);
  if (!firstRowMatch) return [];

  const dataStart = listMarker + afterList.indexOf(firstRowMatch[0]) + 1;
  let dataSection = t.substring(dataStart);

  // 페이지 하단 제거: 페이지네이션 숫자열 or 메뉴 항목
  // "집행계획대비 실적조회" or 페이지 번호 패턴 이전까지
  const endPatterns = [
    /\n집행계획대비/,
    /\n이자 및 수익금/,
    /\n업무 따라하기/,
  ];
  let endPos = dataSection.length;
  for (const pat of endPatterns) {
    const m = dataSection.search(pat);
    if (m > 0 && m < endPos) endPos = m;
  }
  dataSection = dataSection.substring(0, endPos);

  // 행 분리: "\n숫자\n날짜\n" 패턴
  const rowBoundary = /(?=\n\d{1,4}\n\d{4}-\d{2}-\d{2}\n)/g;
  const parts = dataSection.split(rowBoundary).map(s => s.trim()).filter(Boolean);

  const STATUS_VOCAB = ['미검토', '검토완료', '검토중', '반려', '보완요청'];
  const METHOD_VOCAB = ['기타', '전자세금계산서', '지로', '수납', '법인카드', '계좌이체', '현금', '어음', '지로/수납'];

  const rows = [];
  for (const part of parts) {
    const tokens = part.split('\n').map(t => t.trim()).filter(Boolean);
    if (tokens.length < 5) continue;
    if (!/^\d{1,4}$/.test(tokens[0])) continue;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(tokens[1])) continue;

    // 검증검토진행상태 위치 찾기
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
      집행목적: purposeStr || method,
      검증검토진행상태: rest[0] || '',
      보조세목: rest[1] || '',
      지방비집행금액: rest[2] || '',
      자부담집행금액: rest[3] || '',
      불인정금액: rest[4] || '',
      거래처명: rest[5] || '',
      거래처업종명: rest[6] || '',
      계약정보등록여부: rest[7] || '',
      중요재산등록여부: rest[8] || '',
    });
  }
  return rows;
}

// ── 보이는 pager 찾기 (두 번째 cl-pageindexer) ──
async function getVisiblePager(page) {
  return page.evaluate(() => {
    const pagers = [...document.querySelectorAll('.cl-pageindexer')];
    const visible = pagers.find(p => p.getBoundingClientRect().width > 0);
    if (!visible) return null;

    const indices = [...visible.querySelectorAll('.cl-pageindexer-index')];
    const next = visible.querySelector('.cl-pageindexer-next');
    const selected = indices.find(el => el.classList.contains('cl-selected'));

    return {
      currentPage: selected ? selected.innerText.trim() : '?',
      pages: indices.map(el => el.innerText.trim()),
      nextDisabled: next ? next.classList.contains('cl-disabled') : true,
    };
  });
}

// ── 다음 페이지 클릭 (보이는 pager의 next 버튼) ──
async function clickNextPage(page) {
  return page.evaluate(() => {
    const pagers = [...document.querySelectorAll('.cl-pageindexer')];
    const visible = pagers.find(p => p.getBoundingClientRect().width > 0);
    if (!visible) return false;

    const next = visible.querySelector('.cl-pageindexer-next');
    if (!next || next.classList.contains('cl-disabled')) return false;

    next.click();
    return true;
  });
}

// ── 특정 페이지 번호 클릭 ──
async function clickPageNum(page, num) {
  return page.evaluate((targetNum) => {
    const pagers = [...document.querySelectorAll('.cl-pageindexer')];
    const visible = pagers.find(p => p.getBoundingClientRect().width > 0);
    if (!visible) return false;

    const indices = [...visible.querySelectorAll('.cl-pageindexer-index')];
    const target = indices.find(el => el.innerText.trim() === String(targetNum));
    if (!target) return false;

    target.click();
    return true;
  }, num);
}

async function main() {
  const browser = await chromium.connectOverCDP('http://localhost:9445', { timeout: 10000 });
  const context = browser.contexts()[0];
  const page = context.pages().find(p => p.url().includes('lss.do'));
  page.on('dialog', async d => { try { await d.accept(); } catch {} });

  // 총 건수 확인
  const totalText = await page.evaluate(() => {
    const m = document.body.innerText.match(/총\s*\n?\s*(\d+)\s*\n?\s*건/);
    return m ? m[1] : '?';
  });
  const totalCount = parseInt(totalText) || 0;
  console.log(`집행내역 총 ${totalText}건`);

  // 현재 pager 상태
  const pagerState = await getVisiblePager(page);
  if (!pagerState) {
    console.log('보이는 pager 없음');
    await browser.close();
    process.exit(1);
  }
  console.log('pager:', pagerState);

  // 1페이지로 리셋 (이미 1이면 skip)
  if (pagerState.currentPage !== '1') {
    console.log('1페이지로 이동...');
    await page.evaluate(() => {
      const pagers = [...document.querySelectorAll('.cl-pageindexer')];
      const visible = pagers.find(p => p.getBoundingClientRect().width > 0);
      if (visible) {
        const first = visible.querySelector('.cl-pageindexer-first');
        if (first && !first.classList.contains('cl-disabled')) first.click();
      }
    });
    await sleep(2000);
  }

  // 전체 수집: 페이지 그룹(1-5, 6-10, ...) 내 각 번호를 순서대로 클릭
  const allRecords = [];
  let logicalPage = 1;
  const maxPages = DRY_RUN ? 1 : 200;

  // 현재 페이지(1) 추출
  async function extractCurrentPage() {
    await sleep(400);
    let rows = [];
    for (let retry = 0; retry < 3; retry++) {
      const text = await page.evaluate(() => document.body.innerText);
      rows = parseRows(text, logicalPage);
      if (rows.length > 0) break;
      await sleep(1000);
    }
    return rows;
  }

  while (logicalPage <= maxPages) {
    const rows = await extractCurrentPage();

    if (rows.length === 0) {
      console.log(`페이지 ${logicalPage}: 데이터 없음, 종료`);
      break;
    }

    // 중복 체크
    const firstSeq = rows[0].순번;
    const lastSeq = allRecords.length > 0 ? allRecords[allRecords.length - 1].순번 : '0';
    if (parseInt(firstSeq) <= parseInt(lastSeq)) {
      console.log(`  중복 감지 (순번 ${firstSeq} <= ${lastSeq}), 종료`);
      break;
    }

    console.log(`페이지 ${logicalPage}: ${rows.length}건 [${rows[0].순번}~${rows[rows.length-1].순번}] (누계: ${allRecords.length + rows.length})`);
    allRecords.push(...rows);

    if (DRY_RUN) break;
    if (totalCount > 0 && allRecords.length >= totalCount) {
      console.log('전체 건수 도달');
      break;
    }

    // 다음 페이지로 이동
    const pState = await getVisiblePager(page);
    if (!pState) break;

    const curNum = parseInt(pState.currentPage);
    const nextNum = curNum + 1;
    const visibleNums = pState.pages.map(Number);

    if (visibleNums.includes(nextNum)) {
      // 현재 그룹 내 다음 번호 클릭
      await clickPageNum(page, nextNum);
    } else {
      // 그룹 경계: next(>) 버튼으로 다음 그룹 이동 (자동으로 첫 페이지 선택됨)
      const hasNext = await clickNextPage(page);
      if (!hasNext) {
        console.log('마지막 페이지 (next 비활성)');
        break;
      }
    }

    await sleep(1200);
    logicalPage++;
  }

  console.log(`\n총 ${allRecords.length}건 수집 (예상: ${totalText}건)`);

  if (allRecords.length === 0) {
    await browser.close();
    process.exit(1);
  }

  // 저장
  fs.mkdirSync(path.dirname(OUTPUT), { recursive: true });
  fs.writeFileSync(OUTPUT, JSON.stringify(allRecords, null, 2), 'utf-8');
  const kb = (fs.statSync(OUTPUT).size / 1024).toFixed(0);
  console.log(`저장: ${OUTPUT} (${kb}KB)`);

  // 보조세목별 요약
  const catMap = {};
  for (const r of allRecords) {
    const cat = r['보조세목'] || '(미분류)';
    catMap[cat] = (catMap[cat] || 0) + 1;
  }
  console.log('\n보조세목별:');
  Object.entries(catMap).sort((a, b) => b[1] - a[1]).forEach(([k, v]) => console.log(`  ${k}: ${v}건`));

  await browser.close();
}

main().catch(e => { console.error('ERROR:', e.message); process.exit(1); });
