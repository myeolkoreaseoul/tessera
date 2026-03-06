/**
 * AppUtil.getMainApp() → 자식에서 그리드 찾기
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

  // 1) mainApp에서 모든 자식의 type/name 수집
  console.log('=== 1) 모든 grid 타입 자식 찾기 ===');
  const gridList = await page.evaluate(() => {
    const out = [];
    const app = AppUtil.getMainApp();
    if (!app) return ['no main app'];

    const container = app.getContainer();
    if (!container) return ['no container'];

    const children = container.getAllRecursiveChildren();
    out.push('total children: ' + children.length);

    // 모든 타입 수집
    const typeMap = {};
    for (const c of children) {
      const t = c.type || 'unknown';
      typeMap[t] = (typeMap[t] || 0) + 1;
    }
    out.push('\ntype distribution:');
    for (const [t, count] of Object.entries(typeMap).sort((a,b) => b[1] - a[1]).slice(0, 30)) {
      out.push(`  ${t}: ${count}`);
    }

    // grid 타입 찾기
    const grids = children.filter(c => c.type === 'grid');
    out.push('\ngrids found: ' + grids.length);
    for (const g of grids) {
      out.push(`  name="${g.name}" type="${g.type}" uuid="${g.uuid}"`);
      out.push(`    rowCount=${typeof g.getRowCount === 'function' ? g.getRowCount() : '?'}`);
      out.push(`    dataRowCount=${typeof g.getDataRowCount === 'function' ? g.getDataRowCount() : '?'}`);
    }

    return out;
  });
  gridList.forEach(r => console.log('  ' + r));

  // 2) grid가 없으면 다른 이름으로 찾기
  console.log('\n=== 2) "grid" 이름 포함 컨트롤 ===');
  const gridByName = await page.evaluate(() => {
    const out = [];
    const app = AppUtil.getMainApp();
    const container = app.getContainer();
    const children = container.getAllRecursiveChildren();

    // 이름에 grid, sheet, list, table 포함하는 것
    const candidates = children.filter(c => {
      const n = (c.name || '').toLowerCase();
      return n.includes('grid') || n.includes('sheet') || n.includes('list') || n.includes('table') || n.includes('grd');
    });
    out.push('candidates: ' + candidates.length);
    for (const c of candidates) {
      out.push(`  name="${c.name}" type="${c.type}" uuid="${c.uuid}"`);
    }

    return out;
  });
  gridByName.forEach(r => console.log('  ' + r));

  // 3) 메인 앱이 아닌 다른 경로로 접근
  console.log('\n=== 3) 임베디드 앱 인스턴스 탐색 ===');
  const embeddedInfo = await page.evaluate(() => {
    const out = [];
    const app = AppUtil.getMainApp();
    const container = app.getContainer();
    const children = container.getAllRecursiveChildren();

    // EmbeddedApp 같은 것 찾기
    const embeddedTypes = children.filter(c =>
      c.type === 'embeddedapp' || c.type === 'app' ||
      (c.type || '').includes('embed') || (c.type || '').includes('frame')
    );
    out.push('embedded/app controls: ' + embeddedTypes.length);
    for (const e of embeddedTypes) {
      out.push(`  name="${e.name}" type="${e.type}" uuid="${e.uuid}"`);

      // 이 안에 자식이 있는지?
      try {
        if (typeof e.getAppInstance === 'function') {
          const subApp = e.getAppInstance();
          if (subApp) {
            out.push(`    subApp: id="${subApp.id}" uuid="${subApp.uuid}"`);
            const subContainer = subApp.getContainer();
            if (subContainer) {
              const subChildren = subContainer.getAllRecursiveChildren();
              out.push(`    subChildren: ${subChildren.length}`);
              const subGrids = subChildren.filter(c => c.type === 'grid');
              for (const g of subGrids) {
                out.push(`      grid: name="${g.name}" rows=${g.getRowCount ? g.getRowCount() : '?'}`);
              }
            }
          }
        }
      } catch(e2) { out.push('    subApp err: ' + e2.message); }
    }

    return out;
  });
  embeddedInfo.forEach(r => console.log('  ' + r));

  // 4) 직접 lookup 시도 — 다양한 이름
  console.log('\n=== 4) lookup 다양한 이름 ===');
  const lookupResult = await page.evaluate(() => {
    const out = [];
    const app = AppUtil.getMainApp();

    const names = ['grid', 'grd', 'Grid', 'Grd', 'grid1', 'grd1', 'listGrid', 'dataGrid',
      'grpGrid', 'gridExec', 'grdList', 'grdExec', 'gridList', 'grdDetail'];
    for (const n of names) {
      try {
        const ctrl = app.lookup(n);
        if (ctrl) out.push(`lookup("${n}"): found! type=${ctrl.type}`);
      } catch(e) {}
    }

    // lookup 모든 자식 이름
    const container = app.getContainer();
    const children = container.getAllRecursiveChildren();
    const allNames = children.map(c => c.name).filter(Boolean);
    const uniqueNames = [...new Set(allNames)];
    out.push('\nall unique control names (' + uniqueNames.length + '):');
    // grid 관련만
    const gridNames = uniqueNames.filter(n => n.toLowerCase().includes('grid') || n.toLowerCase().includes('grd') || n.toLowerCase().includes('list'));
    out.push('grid/list names: ' + gridNames.join(', '));

    // 전체 이름 (처음 50개)
    out.push('first 50 names: ' + uniqueNames.slice(0, 50).join(', '));

    return out;
  });
  lookupResult.forEach(r => console.log('  ' + r));

  await b.close();
})().catch(e => console.error('ERROR:', e.message));
