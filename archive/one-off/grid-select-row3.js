/**
 * CEvent 올바른 속성 + 부모 앱 메서드 탐색 + callAppMethod
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

  // 1) CEvent 프로토타입 탐색 + 부모 앱 메서드
  console.log('=== 1) CEvent + 부모 앱 ===');
  const exploration = await page.evaluate(() => {
    const out = [];

    // CEvent 구조
    const ev = new cpr.events.CEvent('test');
    const evKeys = Object.keys(ev);
    out.push('CEvent keys: ' + evKeys.join(', '));

    const evProto = Object.getOwnPropertyNames(Object.getPrototypeOf(ev))
      .filter(m => m !== 'constructor');
    out.push('CEvent methods: ' + evProto.join(', '));

    // CEvent 생성자 파라미터
    out.push('CEvent constructor: ' + cpr.events.CEvent.toString().substring(0, 200));

    // 다른 이벤트 클래스
    const eventClasses = Object.keys(cpr.events);
    out.push('cpr.events: ' + eventClasses.join(', '));

    // 부모 앱 찾기
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

    const embApps = findEmbeddedApps(container, 0);

    // 각 앱 인스턴스의 앱 메서드 확인
    for (let i = 0; i < embApps.length; i++) {
      const emb = embApps[i];
      try {
        const embApp = emb.getEmbeddedAppInstance();
        if (!embApp) continue;
        out.push(`\nemb[${i}] ${embApp.id}:`);

        // 일반적인 메서드명 확인
        const commonMethods = [
          'onBodyCellDblClick', 'onBodyCellClick', 'onSelectionChange',
          'onCellDblClick', 'onCellClick', 'onRowDblClick',
          'openDetail', 'loadDetail', 'selectItem', 'onItemSelect',
          'onGridSelect', 'onGridCellDblClick', 'onGridBodyCellDblClick',
          'searchDetail', 'getDetail', 'setDetail', 'fnDetail',
          'fnSearch', 'fnSelectRow', 'fnOpenDetail', 'fnClick',
          'onClickRow', 'onSelectRow', 'fn_select', 'fn_click',
          'fn_detail', 'grd_onBodyCellDblClick', 'grd1_onBodyCellDblClick',
          'grdList_onBodyCellDblClick', 'grd_onSelectionChange',
        ];
        const found = [];
        for (const m of commonMethods) {
          if (embApp.hasAppMethod(m)) found.push(m);
        }
        if (found.length > 0) out.push('  methods: ' + found.join(', '));

        // 부모 앱
        try {
          const parentApp = embApp.getHostAppInstance();
          if (parentApp) {
            out.push(`  parentApp: ${parentApp.id}`);
            // 부모 앱 메서드
            const parentFound = [];
            for (const m of commonMethods) {
              if (parentApp.hasAppMethod(m)) parentFound.push(m);
            }
            if (parentFound.length > 0) out.push('  parent methods: ' + parentFound.join(', '));
          }
        } catch(e) {}
      } catch(e) {}
    }

    return out;
  });
  exploration.forEach(r => console.log('  ' + r));

  // 2) 이벤트에 올바른 속성 넣어서 dispatch
  console.log('\n=== 2) CEvent with row data ===');
  const eventResult = await page.evaluate(() => {
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

    // selectRows
    mainGrid.selectRows([0]);

    // CEvent with proper data
    const events = ['celldblclick', 'selection-change', 'cellclick'];
    for (const evName of events) {
      try {
        const ev = new cpr.events.CEvent(evName);
        // 이벤트에 속성 추가
        ev.rowIndex = 0;
        ev.cellIndex = 1; // 순번 컬럼
        ev.row = mainGrid.getRow(0);
        ev.dataRow = mainGrid.getDataRow(0);
        ev.source = mainGrid;
        ev.target = mainGrid;

        mainGrid.dispatchEvent(ev);
        out.push(`✓ ${evName} with row data`);
      } catch(e) {
        out.push(`✗ ${evName}: ${e.message.substring(0, 80)}`);
      }
    }

    // 3) 그리드에 이벤트 프로퍼티가 있는 다른 이벤트 클래스?
    if (cpr.events.CGridEvent) {
      out.push('\nCGridEvent exists!');
      try {
        const gev = new cpr.events.CGridEvent('celldblclick', mainGrid, 0, 1);
        mainGrid.dispatchEvent(gev);
        out.push('CGridEvent dispatched!');
      } catch(e) { out.push('CGridEvent err: ' + e.message); }
    }

    // ItemEvent?
    if (cpr.events.CItemEvent) {
      out.push('\nCItemEvent exists!');
    }

    // 모든 이벤트 클래스 나열
    out.push('\ncpr.events classes:');
    for (const k of Object.keys(cpr.events)) {
      out.push(`  ${k}: ${typeof cpr.events[k]}`);
    }

    return out;
  });
  eventResult.forEach(r => console.log('  ' + r));

  await sleep(3000);

  // 3) 결과 확인
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
  console.log('\n현재 건:', info);
  console.log(info.includes('47차') ? '✓ 1번!' : '✗ ' + info.substring(0, 50));

  await b.close();
})().catch(e => console.error('ERROR:', e.message));
