/**
 * CGridMouseEvent + CGridSelectionEvent 정확히 생성해서 dispatch
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

  // 1) GridEventType, CGridMouseEvent 구조 분석
  console.log('=== 1) 그리드 이벤트 타입/생성자 분석 ===');
  const analysis = await page.evaluate(() => {
    const out = [];

    // GridEventType
    const get = cpr.events.GridEventType;
    out.push('GridEventType: ' + JSON.stringify(get));
    // 열거형이면 키:값
    if (typeof get === 'function') {
      const getProto = Object.getOwnPropertyNames(get);
      out.push('  props: ' + getProto.join(', '));
      // static values
      for (const k of getProto) {
        if (typeof get[k] === 'string' || typeof get[k] === 'number') {
          out.push(`  ${k}: ${get[k]}`);
        }
      }
    }

    // CGridMouseEvent 생성자
    out.push('\nCGridMouseEvent: ' + cpr.events.CGridMouseEvent.toString().substring(0, 300));
    const gme = Object.getOwnPropertyNames(cpr.events.CGridMouseEvent.prototype)
      .filter(m => m !== 'constructor');
    out.push('CGridMouseEvent proto: ' + gme.join(', '));

    // CGridEvent 생성자
    out.push('\nCGridEvent: ' + cpr.events.CGridEvent.toString().substring(0, 300));
    const ge = Object.getOwnPropertyNames(cpr.events.CGridEvent.prototype)
      .filter(m => m !== 'constructor');
    out.push('CGridEvent proto: ' + ge.join(', '));

    // CGridSelectionEvent 생성자
    out.push('\nCGridSelectionEvent: ' + cpr.events.CGridSelectionEvent.toString().substring(0, 300));
    const gse = Object.getOwnPropertyNames(cpr.events.CGridSelectionEvent.prototype)
      .filter(m => m !== 'constructor');
    out.push('CGridSelectionEvent proto: ' + gse.join(', '));

    // SelectionEventType
    const set = cpr.events.SelectionEventType;
    out.push('\nSelectionEventType: ' + (typeof set));
    if (typeof set === 'function') {
      for (const k of Object.getOwnPropertyNames(set)) {
        if (typeof set[k] === 'string' || typeof set[k] === 'number') {
          out.push(`  ${k}: ${set[k]}`);
        }
      }
    }

    return out;
  });
  analysis.forEach(r => console.log('  ' + r));

  // 2) 올바른 이벤트 생성 + dispatch
  console.log('\n=== 2) 올바른 CGridMouseEvent dispatch ===');
  const result = await page.evaluate(() => {
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

    // 먼저 selectRows
    mainGrid.selectRows([0]);
    out.push('selectRows([0]) done, selected: ' + mainGrid.getSelectedRowIndex());

    // CGridMouseEvent 시도
    try {
      // 생성자 파라미터 추측: (eventType, nativeEvent?)
      const mouseEvt = new MouseEvent('dblclick', { bubbles: true, clientX: 500, clientY: 500 });
      const gridMouseEvt = new cpr.events.CGridMouseEvent('celldblclick', mouseEvt);
      // 속성 설정
      try { gridMouseEvt.rowIndex = 0; } catch(e) {}
      try { gridMouseEvt.cellIndex = 1; } catch(e) {}

      // CGridMouseEvent의 속성 확인
      const gmKeys = Object.keys(gridMouseEvt);
      out.push('CGridMouseEvent keys: ' + gmKeys.join(', '));
      // readable properties
      for (const m of Object.getOwnPropertyNames(Object.getPrototypeOf(gridMouseEvt))) {
        if (!m.startsWith('µ') && m !== 'constructor') {
          try {
            const v = gridMouseEvt[m];
            if (typeof v !== 'function') {
              out.push(`  ${m}: ${v}`);
            }
          } catch(e) {}
        }
      }

      mainGrid.dispatchEvent(gridMouseEvt);
      out.push('CGridMouseEvent dispatched!');
    } catch(e) {
      out.push('CGridMouseEvent err: ' + e.message);
    }

    // CGridSelectionEvent 시도
    try {
      const selEvt = new cpr.events.CGridSelectionEvent('selection-change');
      const selKeys = Object.keys(selEvt);
      out.push('\nCGridSelectionEvent keys: ' + selKeys.join(', '));

      // readable properties
      for (const m of Object.getOwnPropertyNames(Object.getPrototypeOf(selEvt))) {
        if (!m.startsWith('µ') && m !== 'constructor') {
          try {
            const v = selEvt[m];
            if (typeof v !== 'function') out.push(`  ${m}: ${v}`);
          } catch(e) {}
        }
      }

      mainGrid.dispatchEvent(selEvt);
      out.push('CGridSelectionEvent dispatched!');
    } catch(e) {
      out.push('CGridSelectionEvent err: ' + e.message);
    }

    return out;
  });
  result.forEach(r => console.log('  ' + r));

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
