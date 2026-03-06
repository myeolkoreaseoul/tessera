/**
 * 그리드 선택 + 이벤트 발생으로 상세 뷰 로드 트리거
 */
const { chromium } = require('playwright');
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

(async () => {
  const b = await chromium.connectOverCDP('http://localhost:9445', { timeout: 10000 });
  const page = b.contexts()[0].pages().find(p => p.url().includes('lss.do'));
  if (!page) { console.error('lss.do 탭 없음'); process.exit(1); }

  // 목록 탭으로 이동
  await page.evaluate(() => {
    const tabs = [...document.querySelectorAll('.cl-tabfolder-item')];
    const t = tabs.find(t => (t.innerText || '').includes('집행내역 목록'));
    if (t) t.click();
  });
  await sleep(3000);

  // 1) 그리드 접근 + 이벤트 리스너 확인
  console.log('=== 1) 그리드 이벤트 리스너 ===');
  const eventInfo = await page.evaluate(() => {
    const out = [];
    const app = AppUtil.getMainApp();
    const container = app.getContainer();

    function findEmbeddedApps(ctrl, depth) {
      const result = [];
      if (depth > 10) return result;
      if (ctrl.type === 'embeddedapp') result.push(ctrl);
      try {
        if (typeof ctrl.getChildren === 'function') {
          const children = ctrl.getChildren();
          if (children) for (const child of children) result.push(...findEmbeddedApps(child, depth + 1));
        }
      } catch(e) {}
      return result;
    }

    function findGrids(ctrl, depth) {
      const grids = [];
      if (depth > 10) return grids;
      if (ctrl.type === 'grid') grids.push(ctrl);
      try {
        if (typeof ctrl.getChildren === 'function') {
          const ch = ctrl.getChildren();
          if (ch) for (const c of ch) grids.push(...findGrids(c, depth + 1));
        }
      } catch(e) {}
      return grids;
    }

    const embApps = findEmbeddedApps(container, 0);
    const listEmb = embApps[1];
    const listApp = listEmb.getEmbeddedAppInstance();
    const grids = findGrids(listApp.getContainer(), 0);
    const mainGrid = grids.find(g => g.getRowCount() > 2);

    // 그리드의 addEventListener 기록 확인
    // cpr 이벤트: selection-change, celldblclick, cellclick, item-click, etc.
    // 그리드에 등록된 이벤트 이름 확인이 어려움... dispatchEvent로 시도

    // 이벤트 목록 수집 - 그리드 내부에 등록된 이벤트
    const gridKeys = Object.keys(mainGrid);
    out.push('grid keys: ' + gridKeys.join(', '));

    // 이벤트 맵이 있을 수 있음
    for (const k of gridKeys) {
      const v = mainGrid[k];
      if (v instanceof Map && v.size > 0) {
        out.push(`${k} (Map): size=${v.size}`);
        for (const [mk, mv] of v) {
          out.push(`  "${mk}": ${typeof mv}`);
        }
      }
    }

    // listApp의 앱 메서드 확인
    out.push('\nlistApp methods:');
    try {
      // hasAppMethod로 일반적인 그리드 이벤트 핸들러 확인
      const methodNames = [
        'onGridSelectionChange', 'onGridClick', 'onGridDblClick',
        'onGridCellClick', 'onGridCellDblClick', 'onGridRowClick',
        'onGridRowDblClick', 'onSelection', 'onSelectionChange',
        'onItemClick', 'onItemDblClick', 'onClick', 'onDblClick',
        'onCellClick', 'onCellDblClick', 'onRowClick', 'onRowDblClick',
        'gridSelectionChange', 'gridCellDblClick', 'openDetail',
        'onBodyCellDblClick', 'onHeaderCellDblClick',
      ];
      for (const m of methodNames) {
        if (listApp.hasAppMethod(m)) {
          out.push(`  ✓ ${m}`);
        }
      }

      // 그리드에서 이벤트를 dispatch하면 어떤 앱 메서드가 호출되는지
      // → 바인딩 정보 확인
      const bindCtx = mainGrid.getBindContext();
      out.push('bindContext: ' + typeof bindCtx);
    } catch(e) { out.push('method check err: ' + e.message); }

    // listApp의 모든 앱 프로퍼티
    try {
      const props = listApp.getAllAppProperties();
      out.push('\nlistApp properties: ' + JSON.stringify(props).substring(0, 300));
    } catch(e) {}

    return out;
  });
  eventInfo.forEach(r => console.log('  ' + r));

  // 2) 이벤트 dispatch 시도
  console.log('\n=== 2) 이벤트 dispatch 시도 ===');
  const dispatchResult = await page.evaluate(() => {
    const out = [];
    const app = AppUtil.getMainApp();
    const container = app.getContainer();

    function findEmbeddedApps(ctrl, depth) {
      const result = [];
      if (depth > 10) return result;
      if (ctrl.type === 'embeddedapp') result.push(ctrl);
      try {
        if (typeof ctrl.getChildren === 'function') {
          const children = ctrl.getChildren();
          if (children) for (const child of children) result.push(...findEmbeddedApps(child, depth + 1));
        }
      } catch(e) {}
      return result;
    }

    function findGrids(ctrl, depth) {
      const grids = [];
      if (depth > 10) return grids;
      if (ctrl.type === 'grid') grids.push(ctrl);
      try {
        if (typeof ctrl.getChildren === 'function') {
          const ch = ctrl.getChildren();
          if (ch) for (const c of ch) grids.push(...findGrids(c, depth + 1));
        }
      } catch(e) {}
      return grids;
    }

    const embApps = findEmbeddedApps(container, 0);
    const listEmb = embApps[1];
    const listApp = listEmb.getEmbeddedAppInstance();
    const grids = findGrids(listApp.getContainer(), 0);
    const mainGrid = grids.find(g => g.getRowCount() > 2);

    // 먼저 행 선택
    mainGrid.selectRows([0]);
    out.push('selectRows([0]) done');

    // cpr 이벤트 dispatch 시도
    const eventNames = [
      'selection-change', 'selectionchange', 'celldblclick', 'cellclick',
      'rowdblclick', 'rowclick', 'itemclick', 'itemdblclick',
      'click', 'dblclick', 'bodycelldblclick', 'bodycellclick'
    ];

    for (const evName of eventNames) {
      try {
        // cpr의 dispatchEvent는 cpr.events.CEvent를 사용할 수 있음
        const evObj = new cpr.events.CEvent(evName);
        mainGrid.dispatchEvent(evObj);
        out.push(`✓ dispatched: ${evName}`);
      } catch(e) {
        out.push(`✗ ${evName}: ${e.message.substring(0, 60)}`);
      }
    }

    return out;
  });
  dispatchResult.forEach(r => console.log('  ' + r));

  await sleep(3000);

  // 3) 결과 확인
  console.log('\n=== 3) 결과 확인 ===');
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
  console.log(info.includes('47차') ? '✓ 1번!' : '✗ ' + info.substring(0, 50));

  await b.close();
})().catch(e => console.error('ERROR:', e.message));
