/**
 * 상세 페이지 버튼/이벤트 메커니즘 추가 탐색
 */
const { chromium } = require('playwright');

process.on('unhandledRejection', (err) => {
  if (err && err.message && err.message.includes('No dialog is showing')) return;
});

async function main() {
  const browser = await chromium.connectOverCDP('http://localhost:9444');
  const context = browser.contexts()[0];
  let page = context.pages().find(p => p.url().includes('DD001003S') || p.url().includes('dd001003'));
  if (!page) page = context.pages().find(p => p.url().includes('dd001'));
  if (!page) { console.log('페이지 없음'); return; }
  page.on('dialog', async d => { try { await d.accept(); } catch {} });
  await page.evaluate(() => {
    document.querySelectorAll('.popupMask.on .fn.ok').forEach(b => b.click());
  });
  await new Promise(r => setTimeout(r, 300));

  // 1. 일괄 검토완료/보완요청 관련 함수 전체
  console.log('=== 1. 일괄 처리 함수들 ===');
  const fns = await page.evaluate(() => {
    const result = {};
    const names = [
      'f_exmntPrgst', 'f_exmntPrgst001', 'f_exmntPrgst002',
      'f_registExmntPrgst', 'f_clickExmntPrgst',
      'DD001003S_btnExmntPrgst001', 'DD001003S_btnExmntPrgst002',
      'f_save', 'f_saveDD001003S', 'f_registDD001003S',
      'f_clickSave', 'f_btnSave',
    ];
    for (const n of names) {
      if (typeof window[n] === 'function') {
        result[n] = window[n].toString().substring(0, 600);
      }
    }
    return result;
  });
  for (const [k, v] of Object.entries(fns)) {
    console.log(`\n--- ${k} ---`);
    console.log(v);
  }

  // 2. IBSheet/SBGrid 이벤트 바인딩 탐색
  console.log('\n=== 2. 그리드 이벤트 ===');
  const gridEvents = await page.evaluate(() => {
    const grid = DD001003SGridObj;
    const result = {};
    // OnClick, OnCellClick 등
    const evNames = ['OnClick', 'OnDblClick', 'OnCellClick', 'OnChange', 'onCellClick',
      'onclick', 'OnBeforeChange', 'OnAfterChange', 'ClickCell'];
    for (const e of evNames) {
      if (grid[e]) result[e] = String(grid[e]).substring(0, 200);
    }
    return result;
  });
  console.log(JSON.stringify(gridEvents, null, 2));

  // 3. exclexCnRow 변수 확인
  console.log('\n=== 3. exclexCnRow 변수 ===');
  const exclRow = await page.evaluate(() => {
    return {
      exclexCnRow: typeof exclexCnRow !== 'undefined' ? exclexCnRow : 'undefined',
      exclexCnCol: typeof exclexCnCol !== 'undefined' ? exclexCnCol : 'undefined',
    };
  });
  console.log(JSON.stringify(exclRow));

  // 4. [등록] 클릭 시 어떤 일이 일어나는지 - 그리드 OnCellClick 핸들러 확인
  console.log('\n=== 4. 그리드 셀 클릭 핸들러 ===');
  const cellClickFn = await page.evaluate(() => {
    // IBSheet 프레임워크에서는 셀 클릭 이벤트 핸들러가 별도 함수로 등록됨
    const candidates = [
      'DD001003SGridObj_OnCellClick', 'f_DD001003SGridObjCellClick',
      'DD001003S_OnCellClick', 'f_cellClick', 'f_gridCellClick',
    ];
    const found = {};
    for (const c of candidates) {
      if (typeof window[c] === 'function') found[c] = window[c].toString().substring(0, 500);
    }

    // 전역 함수 중 DD001003S 관련 찾기
    const dd003Fns = Object.keys(window).filter(k => {
      try { return typeof window[k] === 'function' && k.includes('DD001003S'); } catch { return false; }
    });
    found.allDD003Fns = dd003Fns;

    // exclexCn 관련 함수
    const exclFns = Object.keys(window).filter(k => {
      try { return typeof window[k] === 'function' && (k.includes('exclexCn') || k.includes('ExclexCn')); } catch { return false; }
    });
    found.exclFns = exclFns;

    return found;
  });
  console.log(JSON.stringify(cellClickFn, null, 2));

  // 5. 저장 버튼의 jQuery 이벤트 확인
  console.log('\n=== 5. 버튼 이벤트 리스너 ===');
  const btnEvents = await page.evaluate(() => {
    const result = {};
    const btnIds = ['DD001003S_btnSave', 'DD001003S_btnPrevPage',
      'DD001003S_btnExmntPrgst001', 'DD001003S_btnExmntPrgst002', 'DD001003S_btnExclexCnApply'];
    for (const id of btnIds) {
      const el = document.getElementById(id);
      if (!el) { result[id] = 'not found'; continue; }
      // jQuery 이벤트
      try {
        const $el = jQuery._data ? jQuery._data(el, 'events') : null;
        if ($el) {
          result[id] = Object.keys($el).map(evName => ({
            event: evName,
            handlers: $el[evName].map(h => h.handler.toString().substring(0, 200))
          }));
        } else {
          result[id] = 'no jQuery events';
        }
      } catch (e) {
        result[id] = 'jQuery error: ' + e.message;
      }
    }
    return result;
  });
  console.log(JSON.stringify(btnEvents, null, 2));

  // 6. 페이지 내 모든 DD001003S 관련 전역 함수 목록
  console.log('\n=== 6. DD001003S 전역 함수 전체 목록 ===');
  const allFns = await page.evaluate(() => {
    return Object.keys(window).filter(k => {
      try { return typeof window[k] === 'function' && k.includes('DD001003S'); } catch { return false; }
    }).sort();
  });
  console.log(allFns.join('\n'));

  // 7. pfrsChckSttusCode 값에 따른 UI 변화 관련 함수
  console.log('\n=== 7. pfrsChck 관련 함수 ===');
  const pfrsChckFns = await page.evaluate(() => {
    const found = {};
    const allFnNames = Object.keys(window).filter(k => {
      try { return typeof window[k] === 'function' && (k.includes('pfrsChck') || k.includes('PfrsChck')); } catch { return false; }
    });
    for (const n of allFnNames) {
      found[n] = window[n].toString().substring(0, 400);
    }
    return found;
  });
  console.log(JSON.stringify(pfrsChckFns, null, 2));
}

main().catch(console.error);
