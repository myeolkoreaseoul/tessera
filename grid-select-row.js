/**
 * cpr Grid API로 1번 행 선택!
 * emb[1] → getEmbeddedAppInstance() → grid(40rows) → selectRows
 */
const { chromium } = require('playwright');
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

(async () => {
  const b = await chromium.connectOverCDP('http://localhost:9445', { timeout: 10000 });
  const page = b.contexts()[0].pages().find(p => p.url().includes('lss.do'));
  if (!page) { console.error('lss.do 탭 없음'); process.exit(1); }

  // 1) 목록 탭으로 이동
  console.log('1) 목록 탭 이동...');
  await page.evaluate(() => {
    const tabs = [...document.querySelectorAll('.cl-tabfolder-item')];
    const t = tabs.find(t => (t.innerText || '').includes('집행내역 목록'));
    if (t) t.click();
  });
  await sleep(3000);

  // 2) 그리드 접근 + 행 선택
  console.log('2) 그리드 API로 1번 행 선택...');
  const selectResult = await page.evaluate(() => {
    const out = [];
    const app = AppUtil.getMainApp();
    const container = app.getContainer();

    // embeddedapp 찾기
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
    // emb[1] = sm/sm06/SM06308M1 (집행내역 목록조회)
    const listEmb = embApps[1];
    if (!listEmb) { out.push('emb[1] not found'); return out; }

    const listApp = listEmb.getEmbeddedAppInstance();
    if (!listApp) { out.push('listApp null'); return out; }
    out.push('listApp: ' + listApp.id);

    // 그리드 찾기
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

    const listContainer = listApp.getContainer();
    const grids = findGrids(listContainer, 0);
    out.push('grids: ' + grids.length);

    // 40행 그리드 (집행내역 목록)
    const mainGrid = grids.find(g => g.getRowCount() > 2);
    if (!mainGrid) { out.push('main grid not found'); return out; }
    out.push('mainGrid rows: ' + mainGrid.getRowCount());
    out.push('mainGrid dataRows: ' + mainGrid.getDataRowCount());

    // 현재 선택 상태
    const curSelected = mainGrid.getSelectedRowIndex();
    out.push('current selected: ' + curSelected);

    // 1번 행 데이터 확인
    try {
      const row0 = mainGrid.getRow(0);
      out.push('row[0]: ' + (row0 ? typeof row0 : 'null'));
      const dataRow0 = mainGrid.getDataRow(0);
      out.push('dataRow[0]: ' + (dataRow0 ? typeof dataRow0 : 'null'));

      // 셀 값 확인
      const cellVal = mainGrid.getCellValue(0, 0);
      out.push('cell(0,0): ' + cellVal);
      const cellText = mainGrid.getCellText(0, 0);
      out.push('cellText(0,0): ' + cellText);

      // 여러 컬럼 확인
      const colCount = mainGrid.columnCount || mainGrid.getColumnWidths()?.length || 0;
      out.push('columns: ' + colCount);
      for (let c = 0; c < Math.min(colCount, 10); c++) {
        try {
          const txt = mainGrid.getCellText(0, c);
          out.push(`  col[${c}]: "${txt}"`);
        } catch(e) {}
      }
    } catch(e) { out.push('row data err: ' + e.message); }

    // ★ selectRows 시도!
    out.push('\n*** selectRows([0]) 시도 ***');
    try {
      mainGrid.selectRows([0]);
      out.push('selectRows OK!');
    } catch(e) { out.push('selectRows err: ' + e.message); }

    // 선택 후 확인
    try {
      const newSelected = mainGrid.getSelectedRowIndex();
      out.push('after select: ' + newSelected);
    } catch(e) {}

    // focusCell도 시도
    out.push('\n*** focusCell(0, 0) 시도 ***');
    try {
      mainGrid.focusCell(0, 0);
      out.push('focusCell OK!');
    } catch(e) { out.push('focusCell err: ' + e.message); }

    return out;
  });
  selectResult.forEach(r => console.log('  ' + r));

  await sleep(3000);

  // 3) 의견등록 탭으로 이동해서 결과 확인
  console.log('\n3) 의견등록 탭 이동...');
  await page.evaluate(() => {
    const tabs = [...document.querySelectorAll('.cl-tabfolder-item')];
    const t = tabs.find(t => (t.innerText || '').includes('의견등록'));
    if (t) t.click();
  });
  await sleep(3000);

  const info = await page.evaluate(() => {
    const text = document.body.innerText;
    const m = text.match(/집행목적\(용도\)\n(.+)/);
    return (m?.[1] || '').trim();
  });
  console.log('현재 건:', info);
  console.log(info.includes('47차') ? '✓ 1번 건 확인!' : '✗ 1번 아님 - ' + info.substring(0, 50));

  await page.screenshot({ path: '/tmp/botem-grid-select.png' });
  console.log('스크린샷: /tmp/botem-grid-select.png');
  await b.close();
})().catch(e => console.error('ERROR:', e.message));
