/**
 * 공통 유틸리티 모듈
 * - e나라도움 Playwright 헬퍼
 * - OCR/텍스트 유틸
 * - 파일 검색 유틸
 */
const { chromium } = require('playwright');

// ── 기본 유틸 ──

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

// ── 주류 키워드 (1글자 제외 - OCR 오탐 방지) ──
const ALCOHOL = [
  '맥주','소주','와인','위스키','사케','주류','막걸리','하이볼',
  '칵테일','보드카','데킬라','생맥주','병맥주','beer','wine','soju',
  '참이슬','처음처럼','진로','카스맥주','하이트맥주','테라맥주'
];

// ── 파일 검색 유틸 ──

function hasFileByName(files, ...keywords) {
  return files.some(f => {
    const n = f.name.toLowerCase();
    return keywords.some(kw => n.includes(kw.toLowerCase()));
  });
}

/**
 * 파일 내용에서 키워드 검색 (OCR 공백 대응)
 * - 한글 키워드는 글자 사이에 \s* 삽입하여 "회  의  록" 등 매칭
 * - 영문/숫자 키워드는 정확 매칭
 */
function hasFileByContent(files, ...keywords) {
  return files.some(f => {
    const t = (f.text || '').toLowerCase();
    return keywords.some(kw => {
      const kwLower = kw.toLowerCase();
      // 한글이 포함된 키워드: 글자 사이에 선택적 공백 허용
      if (/[가-힣]/.test(kw)) {
        const chars = [...kwLower];
        const pattern = chars.map(c => c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('\\s*');
        return new RegExp(pattern).test(t);
      }
      return t.includes(kwLower);
    });
  });
}

function getTexts(files) {
  return files.map(f => f.text || '').join('\n');
}

// ── OCR 데이터 추출 유틸 ──

function extractParticipants(text) {
  const patterns = [
    /참석자[:\s]*(\d+)\s*명/,
    /참석인원[:\s]*(\d+)\s*명/,
    /(\d+)\s*명\s*\(/,
  ];
  for (const p of patterns) {
    const m = text.match(p);
    if (m) return parseInt(m[1]);
  }

  // KNUH 스타일: 참여인력(N명) + 내부인력(N명) + 외부인력(N명)
  let part = 0, intern = 0, ext = 0;
  const m1 = text.match(/참여인력\((\d{1,2})/);
  if (m1) part = parseInt(m1[1]);
  const m2 = text.match(/[내개네4]부\s*인[력랙략]\(?(\d{1,2})/);
  if (m2 && parseInt(m2[1]) <= 10) intern = parseInt(m2[1]);
  const m3 = text.match(/[외의]부인력\((\d{1,2})/);
  if (m3) ext = parseInt(m3[1]);

  const total = part + intern + ext;
  if (total > 0 && total < 50) return total;

  return 0;
}

function extractConsultHours(text) {
  // "14~16시" → 2
  const m1 = text.match(/(\d{1,2})\s*[~\-–]\s*(\d{1,2})\s*시/);
  if (m1) return parseInt(m1[2]) - parseInt(m1[1]);
  // "10:00~12:30" → 2.5
  const m2 = text.match(/(\d{1,2}):(\d{2})\s*[~\-–]\s*(\d{1,2}):(\d{2})/);
  if (m2) return (parseInt(m2[3]) * 60 + parseInt(m2[4]) - parseInt(m2[1]) * 60 - parseInt(m2[2])) / 60;
  return 0;
}

function hasAlcohol(text) {
  const lower = text.toLowerCase();
  return ALCOHOL.some(kw => lower.includes(kw));
}

function grossFromNet(net) {
  // 3.3% 원천징수 (소득세 3% + 주민세 0.3%)
  return Math.round(net / 0.967);
}

// ── 숫자 파싱 ──

function parseNumber(val) {
  if (typeof val === 'number') return val;
  if (!val) return 0;
  return parseInt(String(val).replace(/[^0-9-]/g, '')) || 0;
}

function formatDate(val) {
  if (!val) return '';
  if (val instanceof Date) return val.toISOString().substring(0, 10);
  return String(val);
}

// ── e나라도움 Playwright 헬퍼 ──

async function connectBrowser(port = 9444) {
  const host = process.env.CDP_HOST || '100.87.3.123';
  const browser = await chromium.connectOverCDP(`http://${host}:${port}`);
  const context = browser.contexts()[0];
  return { browser, context };
}

async function findEnaraPage(context) {
  // 불필요한 팝업 닫기
  for (const p of context.pages()) {
    if (p.url().includes('blank') || p.url() === 'about:blank') {
      await p.close().catch(() => {});
    }
  }
  // gosims 또는 dd001 페이지 찾기
  const page = context.pages().find(p =>
    p.url().includes('gosims') || p.url().includes('dd001')
  );
  if (page) {
    page.on('dialog', async d => { try { await d.accept(); } catch {} });
  }
  return page;
}

async function dismissModals(page) {
  await page.evaluate(() => {
    document.querySelectorAll('.popupMask.on').forEach(modal => {
      const ok = modal.querySelector('button.fn.ok, .fn.ok, footer button');
      if (ok) ok.click();
    });
  }).catch(() => {});
}

async function waitModal(page, timeout = 10000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const found = await page.evaluate(() => {
      const modal = document.querySelector('.popupMask.on');
      if (modal) {
        const ok = modal.querySelector('button.fn.ok, .fn.ok, footer button');
        if (ok) { ok.click(); return true; }
      }
      return false;
    }).catch(() => false);
    if (found) return true;
    await sleep(300);
  }
  return false;
}

async function waitForGrid(page, gridName, timeout = 15000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const ready = await page.evaluate((name) => {
      const grid = window[name];
      return grid &&
        typeof grid.getDataRows === 'function' &&
        grid.getDataRows().length > 0;
    }, gridName).catch(() => false);
    if (ready) return true;
    await sleep(500);
  }
  return false;
}

async function restoreXHR(page) {
  // iframe 기법으로 XHR 프로토타입 복원
  await page.evaluate(() => {
    const iframe = document.createElement('iframe');
    iframe.style.display = 'none';
    document.body.appendChild(iframe);
    window.XMLHttpRequest = iframe.contentWindow.XMLHttpRequest;
    document.body.removeChild(iframe);
  }).catch(() => {});
}

/**
 * DOM 클릭 방식으로 그리드 행 선택 (selectRow 대신 사용)
 * - selectRow()는 getFocusedRow() 버그를 유발하므로 사용 금지
 */
async function clickRowByText(page, gridName, text) {
  return page.evaluate(({ name, searchText }) => {
    const grid = window[name];
    if (!grid) return false;
    const rows = grid.getDataRows();
    for (const row of rows) {
      const rv = grid.getRowValue(row);
      const rowText = Object.values(rv).join(' ');
      if (rowText.includes(searchText)) {
        // DOM 엘리먼트 찾아서 클릭
        const el = document.querySelector(`[data-row="${row}"]`) ||
                   document.querySelector(`tr[data-index="${row}"]`);
        if (el) { el.click(); return true; }
        // fallback: grid API
        grid.selectRow(row);
        return true;
      }
    }
    return false;
  }, { name: gridName, searchText: text });
}

/**
 * 그리드 행을 인덱스로 DOM 클릭 선택
 */
async function clickRowByIndex(page, gridName, idx) {
  return page.evaluate(({ name, index }) => {
    const grid = window[name];
    if (!grid) return null;
    const rows = grid.getDataRows();
    if (index >= rows.length) return null;

    const row = rows[index];
    const rv = grid.getRowValue(row);

    // DOM 클릭 시도
    const trs = document.querySelectorAll(`#${name} tbody tr, .${name} tbody tr`);
    if (trs[index]) {
      trs[index].click();
    } else {
      // fallback: grid selectRow (DOM 못 찾을 때)
      grid.selectRow(row);
    }

    return rv;
  }, { name: gridName, index: idx });
}

module.exports = {
  sleep,
  ALCOHOL,
  hasFileByName,
  hasFileByContent,
  getTexts,
  extractParticipants,
  extractConsultHours,
  hasAlcohol,
  grossFromNet,
  parseNumber,
  formatDate,
  connectBrowser,
  findEnaraPage,
  dismissModals,
  waitModal,
  waitForGrid,
  restoreXHR,
  clickRowByText,
  clickRowByIndex,
};
