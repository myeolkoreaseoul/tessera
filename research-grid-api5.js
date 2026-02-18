/**
 * MDI 폴더 → 탭별 앱 인스턴스 → 그리드 찾기
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

  // 1) MDI 폴더 탐색
  console.log('=== 1) MDI 폴더 ===');
  const mdiInfo = await page.evaluate(() => {
    const out = [];
    const app = AppUtil.getMainApp();
    const container = app.getContainer();
    const children = container.getAllRecursiveChildren();

    // mdifolder 찾기
    const mdi = children.find(c => c.type === 'mdifolder');
    if (!mdi) { out.push('mdifolder not found'); return out; }

    out.push('mdifolder uuid: ' + mdi.uuid);

    // MDI의 메서드들 (읽을 수 있는 것들)
    let proto = Object.getPrototypeOf(mdi);
    const allMethods = [];
    while (proto && proto.constructor.name !== 'Object') {
      const methods = Object.getOwnPropertyNames(proto)
        .filter(m => !m.startsWith('µ') && m !== 'constructor' && typeof proto[m] === 'function');
      allMethods.push(...methods);
      proto = Object.getPrototypeOf(proto);
    }
    const unique = [...new Set(allMethods)];
    const relevant = unique.filter(m =>
      m.includes('child') || m.includes('Child') ||
      m.includes('tab') || m.includes('Tab') ||
      m.includes('item') || m.includes('Item') ||
      m.includes('app') || m.includes('App') ||
      m.includes('page') || m.includes('Page') ||
      m.includes('active') || m.includes('Active') ||
      m.includes('select') || m.includes('Select') ||
      m.includes('get') || m.includes('open')
    );
    out.push('MDI relevant methods: ' + relevant.join(', '));

    // getChildren
    try {
      const mdiChildren = mdi.getChildren();
      out.push('MDI children: ' + mdiChildren.length);
      for (let i = 0; i < mdiChildren.length; i++) {
        const c = mdiChildren[i];
        out.push(`  child[${i}]: type="${c.type}" name="${c.name}" uuid="${c.uuid}"`);

        // 이 안에 appInstance가 있는지?
        try {
          if (typeof c.getAppInstance === 'function') {
            const subApp = c.getAppInstance();
            if (subApp && subApp.uuid !== app.uuid) {
              out.push(`    subApp: id="${subApp.id}" uuid="${subApp.uuid}"`);
            }
          }
        } catch(e) {}

        // embeddedapp인 경우
        if (c.type === 'embeddedapp') {
          try {
            // embeddedapp의 메서드
            const embProto = Object.getPrototypeOf(c);
            const embMethods = Object.getOwnPropertyNames(embProto)
              .filter(m => !m.startsWith('µ') && m !== 'constructor');
            out.push(`    embeddedapp methods: ${embMethods.slice(0, 20).join(', ')}`);

            // getAppInstance가 다른 앱을 가리키는지
            const embApp = c.getAppInstance();
            out.push(`    embApp: id="${embApp?.id}" uuid="${embApp?.uuid}"`);

            // getAllRecursiveChildren에서 grid 찾기
            if (typeof c.getAllRecursiveChildren === 'function') {
              const embChildren = c.getAllRecursiveChildren();
              out.push(`    embChildren: ${embChildren.length}`);
              const embGrids = embChildren.filter(ch => ch.type === 'grid');
              out.push(`    grids in embedded: ${embGrids.length}`);
            }
          } catch(e) { out.push('    emb err: ' + e.message); }
        }
      }
    } catch(e) { out.push('MDI children err: ' + e.message); }

    return out;
  });
  mdiInfo.forEach(r => console.log('  ' + r));

  // 2) MDI에서 열려있는 탭의 embeddedApp 내부 앱 찾기
  console.log('\n=== 2) 탭 내부 앱 인스턴스 ===');
  const tabApps = await page.evaluate(() => {
    const out = [];
    const app = AppUtil.getMainApp();
    const container = app.getContainer();
    const children = container.getAllRecursiveChildren();

    // embeddedapp 4개를 다 뒤져보자
    const embedded = children.filter(c => c.type === 'embeddedapp');
    out.push('embedded apps: ' + embedded.length);

    for (let i = 0; i < embedded.length; i++) {
      const e = embedded[i];
      out.push(`\nembedded[${i}]: uuid=${e.uuid}`);

      // embeddedapp에서 로드된 앱의 id를 알아내는 방법
      // embeddedapp의 속성들
      const props = {};
      try {
        // getAppProperty 시도
        const embApp = e.getAppInstance();
        if (embApp) {
          // getAllAppProperties
          const allProps = embApp.getAllAppProperties();
          out.push(`  appProps: ${JSON.stringify(allProps).substring(0, 200)}`);
        }
      } catch(e2) {}

      // 이 임베디드 앱의 내부 앱 ID를 찾는 다른 방법
      // - 연결된 DOM 요소에서 data 속성 확인
      try {
        // userAttr, userData
        const ua = typeof e.userAttr === 'function' ? e.userAttr() : e.userData;
        out.push(`  userAttr: ${JSON.stringify(ua)}`);
      } catch(e2) {}

      // bind 정보
      try {
        const bindCtx = e.getBindContext();
        out.push(`  bindContext: ${typeof bindCtx}`);
      } catch(e2) {}
    }

    return out;
  });
  tabApps.forEach(r => console.log('  ' + r));

  // 3) window에서 다른 앱 인스턴스 직접 검색
  console.log('\n=== 3) window 글로벌 검색 ===');
  const windowSearch = await page.evaluate(() => {
    const out = [];

    // cpr.core.App의 모든 인스턴스
    // App.prototype.getInstances 사용
    try {
      // 모든 로드된 앱 ID 찾기
      // cpr 내부에 앱 레지스트리가 있을 것
      // cpr.core._apps 같은
      for (const k of Object.keys(cpr.core)) {
        if (typeof cpr.core[k] === 'object' && cpr.core[k] !== null) {
          const subKeys = Object.keys(cpr.core[k]).slice(0, 5);
          if (subKeys.some(sk => sk.includes('app') || sk.includes('App'))) {
            out.push(`cpr.core.${k}: ${subKeys.join(', ')}`);
          }
        }
      }
    } catch(e) {}

    // pushNewApp 함수에서 힌트
    try {
      const fn = pushNewApp.toString();
      // 변수명 추출
      out.push('pushNewApp refs: ' + fn.substring(0, 300));
    } catch(e) {}

    // 이벤트 리스너가 달린 iframe이 있는지
    const iframes = document.querySelectorAll('iframe');
    out.push('iframes: ' + iframes.length);

    // WebSocket 연결 확인
    out.push('WebSocket: ' + typeof WebSocket);

    return out;
  });
  windowSearch.forEach(r => console.log('  ' + r));

  // 4) 핵심: cl-grid DOM에서 직접 cpr 컨트롤 참조 찾기
  console.log('\n=== 4) cl-grid DOM → cpr 컨트롤 참조 ===');
  const domToCpr = await page.evaluate(() => {
    const out = [];
    const gridEl = document.querySelectorAll('.cl-grid')[2]; // 메인 그리드
    if (!gridEl) return ['no grid el'];

    // data-ndid
    const ndid = gridEl.dataset.ndid;
    out.push('ndid: ' + ndid);

    // 모든 부모의 data-ndid 추적
    let parent = gridEl.parentElement;
    let depth = 0;
    while (parent && depth < 15) {
      if (parent.dataset && parent.dataset.ndid) {
        out.push(`  parent[${depth}] ndid: ${parent.dataset.ndid} class: ${parent.className.substring(0, 60)}`);
      }
      parent = parent.parentElement;
      depth++;
    }

    // AppUtil.getMainApp().lookupByUUID 시도 (다른 방식)
    const app = AppUtil.getMainApp();
    try {
      const ctrl = app.lookupByUUID(ndid);
      out.push('app.lookupByUUID: ' + (ctrl ? 'FOUND' : 'null'));
      if (ctrl) {
        out.push('  type: ' + ctrl.type);
        out.push('  name: ' + ctrl.name);
      }
    } catch(e) { out.push('lookupByUUID err: ' + e.message); }

    // 부모 ndid로 시도
    parent = gridEl.parentElement;
    depth = 0;
    while (parent && depth < 15) {
      if (parent.dataset && parent.dataset.ndid) {
        try {
          const ctrl = app.lookupByUUID(parent.dataset.ndid);
          if (ctrl) {
            out.push(`parent[${depth}] lookupByUUID: FOUND type="${ctrl.type}" name="${ctrl.name}"`);

            // 이 컨트롤의 앱 인스턴스
            if (typeof ctrl.getAppInstance === 'function') {
              const ctrlApp = ctrl.getAppInstance();
              if (ctrlApp) {
                out.push(`  ctrlApp: id="${ctrlApp.id}" uuid="${ctrlApp.uuid}"`);
                if (ctrlApp.uuid !== app.uuid) {
                  out.push('  *** 다른 앱 인스턴스 발견! ***');

                  // 이 앱에서 그리드 찾기
                  const ctrlContainer = ctrlApp.getContainer();
                  if (ctrlContainer) {
                    const ctrlChildren = ctrlContainer.getAllRecursiveChildren();
                    out.push(`  children: ${ctrlChildren.length}`);
                    const ctrlGrids = ctrlChildren.filter(c => c.type === 'grid');
                    for (const g of ctrlGrids) {
                      out.push(`    GRID: name="${g.name}" rows=${g.getRowCount ? g.getRowCount() : '?'} uuid="${g.uuid}"`);
                    }
                  }
                }
              }
            }
          }
        } catch(e) {}
      }
      parent = parent.parentElement;
      depth++;
    }

    return out;
  });
  domToCpr.forEach(r => console.log('  ' + r));

  await b.close();
})().catch(e => console.error('ERROR:', e.message));
