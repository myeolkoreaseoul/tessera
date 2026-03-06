/**
 * EmbeddedApp.getEmbeddedAppInstance() → 내부 앱 → 그리드 찾기!
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

  // 1) mainApp에서 embeddedapp 타입 컨트롤 찾기 + getEmbeddedAppInstance
  console.log('=== 1) EmbeddedApp → getEmbeddedAppInstance ===');
  const embResult = await page.evaluate(() => {
    const out = [];
    const app = AppUtil.getMainApp();
    const container = app.getContainer();

    // embeddedapp 타입 자식 찾기 (직접 lookup)
    // container의 자식 중 type=embeddedapp
    // getAllRecursiveChildren에서 에러가 나므로 다른 방법
    // mainApp.lookup은 이름이 필요한데... embeddedapp은 이름이 null

    // 다른 접근: mainApp의 _scopeImpl에서 직접
    // 아니면 container.getChildren() + 재귀

    function findEmbeddedApps(ctrl, depth) {
      const result = [];
      if (depth > 10) return result;
      if (ctrl.type === 'embeddedapp') {
        result.push(ctrl);
      }
      try {
        if (typeof ctrl.getChildren === 'function') {
          const children = ctrl.getChildren();
          if (children) {
            for (const child of children) {
              result.push(...findEmbeddedApps(child, depth + 1));
            }
          }
        }
      } catch(e) {}
      return result;
    }

    const embApps = findEmbeddedApps(container, 0);
    out.push('embedded apps found: ' + embApps.length);

    for (let i = 0; i < embApps.length; i++) {
      const emb = embApps[i];
      out.push(`\nemb[${i}]: name="${emb.name || ''}" app="${emb.app || ''}" module="${emb.module || ''}" uuid="${emb.uuid}"`);

      try {
        const embAppInst = emb.getEmbeddedAppInstance();
        if (embAppInst) {
          out.push(`  embAppInst: id="${embAppInst.id}" uuid="${embAppInst.uuid}" state=${embAppInst.state}`);

          // 이 앱 인스턴스에서 그리드 찾기
          try {
            const embContainer = embAppInst.getContainer();
            if (embContainer) {
              // 재귀적으로 그리드 찾기
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

              const grids = findGrids(embContainer, 0);
              out.push(`  grids: ${grids.length}`);
              for (const g of grids) {
                const rows = typeof g.getRowCount === 'function' ? g.getRowCount() : '?';
                const dataRows = typeof g.getDataRowCount === 'function' ? g.getDataRowCount() : '?';
                out.push(`    GRID: name="${g.name}" rows=${rows} dataRows=${dataRows} uuid="${g.uuid}"`);

                // selectRows 메서드 확인
                out.push(`    selectRows: ${typeof g.selectRows}`);
                out.push(`    focusCell: ${typeof g.focusCell}`);
                out.push(`    getSelectedRowIndex: ${typeof g.getSelectedRowIndex}`);
              }
            }
          } catch(e) { out.push('  grid search err: ' + e.message); }
        } else {
          out.push('  embAppInst: null');
        }
      } catch(e) { out.push('  getEmbeddedAppInstance err: ' + e.message); }
    }

    return out;
  });
  embResult.forEach(r => console.log('  ' + r));

  await b.close();
})().catch(e => console.error('ERROR:', e.message));
