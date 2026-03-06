/**
 * cl-grid JavaScript API로 1번 행 선택
 */
const { chromium } = require('playwright');
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

(async () => {
  const b = await chromium.connectOverCDP('http://localhost:9445', { timeout: 10000 });
  const page = b.contexts()[0].pages().find(p => p.url().includes('lss.do'));
  if (!page) { console.error('lss.do 탭 없음'); process.exit(1); }

  // 목록 탭 활성화 확인
  await page.evaluate(() => {
    const tabs = [...document.querySelectorAll('.cl-tabfolder-item')];
    const t = tabs.find(t => (t.innerText || '').includes('집행내역 목록'));
    if (t) t.click();
  });
  await sleep(2000);

  // 1) window에서 grid 객체 찾기
  const gridSearch = await page.evaluate(() => {
    const results = [];

    // 방법 1: cpr (CLeopatra) 프레임워크 검색
    if (typeof cpr !== 'undefined') {
      results.push('cpr exists');
      try {
        const apps = cpr.getAppInstance ? cpr.getAppInstance() : null;
        results.push('app: ' + typeof apps);
      } catch(e) { results.push('cpr err: ' + e.message); }
    }

    // 방법 2: cl-grid DOM 요소의 _widget 또는 data 속성
    const grids = [...document.querySelectorAll('.cl-grid')];
    results.push('cl-grid count: ' + grids.length);
    for (const g of grids) {
      const keys = Object.keys(g).filter(k => k.startsWith('_') || k.includes('widget') || k.includes('grid'));
      results.push('grid keys: ' + keys.join(', '));

      // jQuery data?
      if (typeof $ !== 'undefined' && $(g).data) {
        const d = $(g).data();
        results.push('jquery data keys: ' + Object.keys(d).join(', '));
      }
    }

    // 방법 3: window 전역 변수에서 grid 찾기
    const globalGrids = Object.keys(window).filter(k =>
      k.toLowerCase().includes('grid') || k.toLowerCase().includes('sheet')
    );
    results.push('global grid vars: ' + globalGrids.slice(0, 10).join(', '));

    // 방법 4: __vue__ 또는 React 인스턴스
    const gridEl = grids[grids.length - 1]; // 마지막 그리드 (집행내역 목록)
    if (gridEl) {
      const reactKey = Object.keys(gridEl).find(k => k.startsWith('__react'));
      const vueKey = Object.keys(gridEl).find(k => k.startsWith('__vue'));
      results.push('react: ' + !!reactKey + ', vue: ' + !!vueKey);

      // el의 숨겨진 속성들
      const hiddenKeys = Object.getOwnPropertyNames(gridEl).filter(k => !k.startsWith('on'));
      results.push('hidden props: ' + hiddenKeys.slice(0, 10).join(', '));
    }

    // 방법 5: CustomEvent dispatch
    results.push('will try dispatchEvent');

    return results;
  });

  console.log('Grid API 검색:');
  gridSearch.forEach(r => console.log('  ' + r));

  // 2) cl-grid에 이벤트 직접 발송 시도
  const eventResult = await page.evaluate(() => {
    const grids = [...document.querySelectorAll('.cl-grid')];
    const grid = grids[grids.length - 1]; // 마지막 그리드 (집행내역)
    if (!grid) return 'no grid';

    // 그리드의 첫 번째 데이터 행 셀 찾기
    const cells = [...grid.querySelectorAll('[class*="cl-grid-cell"]')]
      .filter(el => {
        const r = el.getBoundingClientRect();
        return r.height > 0 && (el.innerText || '').trim() === '1';
      });

    if (cells.length === 0) return 'no cell "1"';

    const cell = cells[0];

    // MouseEvent 시퀀스 (mousedown → mouseup → click → dblclick)
    const rect = cell.getBoundingClientRect();
    const x = rect.x + rect.width / 2;
    const y = rect.y + rect.height / 2;

    ['mousedown', 'mouseup', 'click'].forEach(type => {
      cell.dispatchEvent(new MouseEvent(type, {
        bubbles: true, cancelable: true, view: window,
        clientX: x, clientY: y
      }));
    });

    return 'dispatched events to cell at (' + Math.round(x) + ',' + Math.round(y) + ')';
  });
  console.log('\n이벤트 발송:', eventResult);
  await sleep(2000);

  // 3) 의견등록 탭 확인
  await page.evaluate(() => {
    const tabs = [...document.querySelectorAll('.cl-tabfolder-item')];
    const t = tabs.find(t => (t.innerText || '').includes('의견등록'));
    if (t) t.click();
  });
  await sleep(2000);

  const info = await page.evaluate(() => {
    const text = document.body.innerText;
    const m = text.match(/집행목적\(용도\)\n(.+)/);
    return (m?.[1] || '').trim();
  });
  console.log('현재 건:', info);
  console.log(info.includes('47차') ? '✓ 1번!' : '✗ 실패');

  await b.close();
})().catch(e => console.error('ERROR:', e.message));
