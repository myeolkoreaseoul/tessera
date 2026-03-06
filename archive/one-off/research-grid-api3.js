/**
 * Platform → AppInstance → Grid 위젯 인스턴스 접근 + 행 선택 시도
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

  // 1) Platform에서 모든 앱 인스턴스 가져오기
  console.log('=== 1) Platform → AppInstances ===');
  const appInstances = await page.evaluate(() => {
    const out = [];
    try {
      const platform = new cpr.core.Platform();
      const apps = platform.getAllRunningAppInstances();
      out.push('running apps: ' + (apps ? apps.length : 'null'));

      if (apps && apps.length > 0) {
        for (let i = 0; i < apps.length; i++) {
          const app = apps[i];
          out.push(`\napp[${i}]: id="${app.id || ''}", uuid="${app.uuid || ''}", state=${app.state || ''}`);

          // lookup으로 그리드 찾기 시도
          try {
            // 자식 컨트롤 목록
            const container = app.getContainer();
            if (container) {
              const children = container.getAllRecursiveChildren();
              const gridChildren = children.filter(c => c.type === 'grid' || (c.constructor && c.constructor.name && c.constructor.name.includes('Grid')));
              out.push(`  container children: ${children.length}, grids: ${gridChildren.length}`);
              for (const gc of gridChildren) {
                out.push(`    grid: name="${gc.name || ''}" id="${gc.id || ''}" uuid="${gc.uuid || ''}" type="${gc.type || ''}"`);
              }
            }
          } catch(e) { out.push('  container err: ' + e.message); }
        }
      }
    } catch(e) { out.push('platform err: ' + e.message); }
    return out;
  });
  appInstances.forEach(r => console.log('  ' + r));

  // 2) AppUtil.getMainApp()
  console.log('\n=== 2) AppUtil ===');
  const appUtilInfo = await page.evaluate(() => {
    const out = [];
    try {
      const mainApp = AppUtil.getMainApp();
      out.push('mainApp: ' + typeof mainApp);
      if (mainApp) {
        out.push('mainApp id: ' + (mainApp.id || ''));
        out.push('mainApp uuid: ' + (mainApp.uuid || ''));

        // lookup으로 그리드 찾기
        // 먼저 모든 자식 목록
        const container = mainApp.getContainer();
        if (container) {
          const children = container.getAllRecursiveChildren();
          out.push('children count: ' + children.length);

          // type이나 이름으로 그리드 찾기
          for (const c of children) {
            const typeName = c.type || c.constructor?.name || '';
            if (typeName.toLowerCase().includes('grid') || (c.name && c.name.toLowerCase().includes('grid'))) {
              out.push(`  found: name="${c.name}" type="${typeName}" uuid="${c.uuid}"`);
            }
          }
        }

        // 직접 lookup 시도
        try {
          const g1 = mainApp.lookup('grid');
          out.push('lookup("grid"): ' + (g1 ? 'found' : 'null'));
        } catch(e) {}

        try {
          const g2 = mainApp.lookup('grd');
          out.push('lookup("grd"): ' + (g2 ? 'found' : 'null'));
        } catch(e) {}
      }
    } catch(e) { out.push('AppUtil err: ' + e.message); }
    return out;
  });
  appUtilInfo.forEach(r => console.log('  ' + r));

  // 3) Platform의 lookupByUUID로 그리드 찾기
  console.log('\n=== 3) lookupByUUID ===');
  const gridNdid = 'uuid-b52f57f1-a968-22f8-42e7-81ce9391420d'; // 메인 그리드
  const lookupResult = await page.evaluate((ndid) => {
    const out = [];
    try {
      const platform = new cpr.core.Platform();

      // lookupByUUID
      const ctrl = platform.lookupByUUID(ndid);
      out.push('lookupByUUID: ' + (ctrl ? typeof ctrl : 'null'));
      if (ctrl) {
        out.push('  name: ' + (ctrl.name || ''));
        out.push('  type: ' + (ctrl.type || ''));
        out.push('  uuid: ' + (ctrl.uuid || ''));
        out.push('  rowCount: ' + (typeof ctrl.rowCount !== 'undefined' ? ctrl.rowCount : 'N/A'));
        out.push('  getRowCount: ' + (typeof ctrl.getRowCount === 'function' ? ctrl.getRowCount() : 'N/A'));
      }

      // 모든 등록된 컨트롤 중 그리드만
      const allApps = platform.getAllRunningAppInstances();
      if (allApps) {
        for (const app of allApps) {
          try {
            const container = app.getContainer();
            if (!container) continue;
            const children = container.getAllRecursiveChildren();
            for (const c of children) {
              if (c.type === 'grid') {
                out.push(`\nGrid in app "${app.id}": name="${c.name}" uuid="${c.uuid}" rows=${typeof c.getRowCount === 'function' ? c.getRowCount() : '?'}`);

                // 메서드 확인
                const readable = Object.getOwnPropertyNames(Object.getPrototypeOf(c))
                  .filter(m => !m.startsWith('µ') && m !== 'constructor')
                  .filter(m => m.includes('select') || m.includes('focus') || m.includes('row') || m.includes('Row'));
                out.push(`  row/select methods: ${readable.join(', ')}`);
              }
            }
          } catch(e) {}
        }
      }
    } catch(e) { out.push('lookup err: ' + e.message); }
    return out;
  }, gridNdid);
  lookupResult.forEach(r => console.log('  ' + r));

  await b.close();
})().catch(e => console.error('ERROR:', e.message));
