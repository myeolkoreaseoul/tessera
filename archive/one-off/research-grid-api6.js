/**
 * cl-grid DOM → 부모 ndid 추적 → 올바른 앱 인스턴스 찾기
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

  // 1) cl-grid DOM의 부모 ndid 체인
  console.log('=== 1) Grid DOM 부모 ndid 체인 ===');
  const parentChain = await page.evaluate(() => {
    const out = [];
    const gridEl = document.querySelectorAll('.cl-grid')[2];
    if (!gridEl) return ['no grid'];

    out.push('grid ndid: ' + gridEl.dataset.ndid);
    out.push('grid class: ' + gridEl.className);

    let parent = gridEl.parentElement;
    let depth = 0;
    while (parent && depth < 20) {
      if (parent.dataset && parent.dataset.ndid) {
        out.push(`parent[${depth}]: ndid=${parent.dataset.ndid} class=${parent.className.substring(0, 80)}`);
      }
      if (parent.classList && (parent.classList.contains('cl-embeddedapp') || parent.classList.contains('cl-app'))) {
        out.push(`  *** cl-embeddedapp 발견! depth=${depth} ***`);
      }
      parent = parent.parentElement;
      depth++;
    }

    return out;
  });
  parentChain.forEach(r => console.log('  ' + r));

  // 2) 모든 data-ndid를 가진 부모에 대해 lookupByUUID 시도
  console.log('\n=== 2) 부모 ndid로 lookupByUUID ===');
  const parentLookup = await page.evaluate(() => {
    const out = [];
    const gridEl = document.querySelectorAll('.cl-grid')[2];
    if (!gridEl) return ['no grid'];

    const app = AppUtil.getMainApp();
    const gridNdid = gridEl.dataset.ndid;

    // 그리드 자체
    try {
      const ctrl = app.lookupByUUID(gridNdid);
      out.push('grid lookup: ' + (ctrl ? 'FOUND' : 'null'));
    } catch(e) { out.push('grid lookup err: ' + e.message); }

    // 모든 부모 ndid 수집
    const parentNdids = [];
    let parent = gridEl.parentElement;
    while (parent) {
      if (parent.dataset && parent.dataset.ndid) {
        parentNdids.push({
          ndid: parent.dataset.ndid,
          cls: parent.className.substring(0, 60)
        });
      }
      parent = parent.parentElement;
    }
    out.push('parent ndids: ' + parentNdids.length);

    for (const p of parentNdids) {
      try {
        const ctrl = app.lookupByUUID(p.ndid);
        if (ctrl) {
          out.push(`  FOUND: ndid=${p.ndid.substring(0,20)}... type=${ctrl.type} name="${ctrl.name}"`);

          // 이 컨트롤에서 앱 인스턴스 가져오기
          try {
            const ctrlApp = ctrl.getAppInstance();
            if (ctrlApp && ctrlApp.uuid !== app.uuid) {
              out.push(`    다른 앱: id="${ctrlApp.id}" uuid="${ctrlApp.uuid}"`);
            }
          } catch(e) {}
        }
      } catch(e) {}
    }

    return out;
  });
  parentLookup.forEach(r => console.log('  ' + r));

  // 3) 핵심: cl-embeddedapp의 data-ndid로 임베디드 앱 찾기
  console.log('\n=== 3) cl-embeddedapp에서 로드된 앱 찾기 ===');
  const embAppSearch = await page.evaluate(() => {
    const out = [];

    // cl-embeddedapp 요소 찾기
    const embEls = [...document.querySelectorAll('[class*="cl-embeddedapp"], [class*="cl-mdifolder"]')];
    out.push('embeddedapp elements: ' + embEls.length);
    for (const el of embEls) {
      const r = el.getBoundingClientRect();
      out.push(`  class="${el.className.substring(0, 60)}" ndid=${el.dataset.ndid || 'none'} size=${Math.round(r.width)}x${Math.round(r.height)}`);
    }

    // cl-tabfolder-content (탭 내용 영역) 찾기
    const tabContents = [...document.querySelectorAll('.cl-tabfolder-content, [class*="cl-mdi"]')];
    out.push('\ntab content elements: ' + tabContents.length);
    for (const el of tabContents) {
      const r = el.getBoundingClientRect();
      if (r.width > 0) {
        out.push(`  class="${el.className.substring(0, 80)}" ndid=${el.dataset.ndid || 'none'} size=${Math.round(r.width)}x${Math.round(r.height)}`);
      }
    }

    return out;
  });
  embAppSearch.forEach(r => console.log('  ' + r));

  // 4) 그리드를 포함하는 앱 찾기 - 다른 접근법
  console.log('\n=== 4) 그리드 조상의 embeddedapp 내부 앱 ===');
  const gridAppFind = await page.evaluate(() => {
    const out = [];
    const gridEl = document.querySelectorAll('.cl-grid')[2];
    if (!gridEl) return ['no grid'];

    // 그리드의 가장 가까운 cl-embeddedapp 부모 찾기
    let parent = gridEl.parentElement;
    let embParent = null;
    while (parent) {
      if (parent.className && parent.className.includes('cl-embeddedapp')) {
        embParent = parent;
        break;
      }
      parent = parent.parentElement;
    }

    if (embParent) {
      out.push('embParent ndid: ' + embParent.dataset.ndid);

      // 이 embeddedapp의 app id를 찾자
      const mainApp = AppUtil.getMainApp();
      try {
        const embCtrl = mainApp.lookupByUUID(embParent.dataset.ndid);
        if (embCtrl) {
          out.push('embCtrl found! type: ' + embCtrl.type);

          // embeddedapp 프로토타입에서 앱 관련 메서드 찾기
          let proto = Object.getPrototypeOf(embCtrl);
          const allMethods = [];
          while (proto && proto.constructor.name !== 'Object') {
            const methods = Object.getOwnPropertyNames(proto)
              .filter(m => !m.startsWith('µ') && m !== 'constructor');
            allMethods.push(...methods);
            proto = Object.getPrototypeOf(proto);
          }
          const unique = [...new Set(allMethods)];
          const appMethods = unique.filter(m =>
            m.toLowerCase().includes('app') || m.toLowerCase().includes('module') ||
            m.toLowerCase().includes('instance') || m.toLowerCase().includes('content') ||
            m.toLowerCase().includes('src') || m.toLowerCase().includes('load')
          );
          out.push('app-related methods: ' + appMethods.join(', '));

          // getAllRecursiveChildren 가능한지
          if (typeof embCtrl.getChildren === 'function') {
            try {
              const kids = embCtrl.getChildren();
              out.push('embCtrl children: ' + (kids ? kids.length : 'null'));
            } catch(e) { out.push('getChildren err: ' + e.message); }
          }
        }
      } catch(e) { out.push('embCtrl lookup err: ' + e.message); }
    } else {
      out.push('no cl-embeddedapp parent found');

      // 가장 가까운 cl-app 또는 data-ndid 부모
      parent = gridEl.parentElement;
      while (parent) {
        if (parent.dataset && parent.dataset.ndid) {
          out.push('closest ndid parent: ' + parent.dataset.ndid + ' class=' + parent.className.substring(0, 60));
          break;
        }
        parent = parent.parentElement;
      }
    }

    return out;
  });
  gridAppFind.forEach(r => console.log('  ' + r));

  // 5) 결정적 접근: cpr 내부의 전역 컨트롤 레지스트리
  console.log('\n=== 5) cpr 내부 레지스트리 ===');
  const registry = await page.evaluate(() => {
    const out = [];

    // cpr._scopeImpl 또는 유사
    const platform = new cpr.core.Platform();
    const platformKeys = Object.keys(platform);
    out.push('platform instance keys: ' + platformKeys.join(', '));

    // _scopeImpl 안에 레지스트리가 있을 수 있음
    if (platform._scopeImpl) {
      const scopeKeys = Object.keys(platform._scopeImpl);
      out.push('_scopeImpl keys: ' + scopeKeys.join(', '));

      for (const k of scopeKeys) {
        const v = platform._scopeImpl[k];
        if (v && typeof v === 'object') {
          if (v instanceof Map) {
            out.push(`  ${k} (Map): size=${v.size}`);
            // 처음 5개 키
            let count = 0;
            for (const [mk, mv] of v) {
              if (count >= 5) break;
              out.push(`    "${mk}": ${typeof mv}`);
              count++;
            }
          } else if (Array.isArray(v)) {
            out.push(`  ${k} (Array): length=${v.length}`);
          } else {
            const vKeys = Object.keys(v);
            out.push(`  ${k}: keys=${vKeys.slice(0, 5).join(', ')}`);
          }
        }
      }
    }

    return out;
  });
  registry.forEach(r => console.log('  ' + r));

  await page.screenshot({ path: '/tmp/botem-grid-research2.png' });
  await b.close();
})().catch(e => console.error('ERROR:', e.message));
