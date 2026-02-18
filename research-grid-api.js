/**
 * cpr 프레임워크 그리드 API 심층 탐색
 * 목표: 프로그래밍적으로 그리드 행을 선택하는 방법 찾기
 */
const { chromium } = require('playwright');
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

(async () => {
  const b = await chromium.connectOverCDP('http://localhost:9445', { timeout: 10000 });
  const page = b.contexts()[0].pages().find(p => p.url().includes('lss.do'));
  if (!page) { console.error('lss.do 탭 없음'); process.exit(1); }

  // 1) 집행내역 목록조회 탭 클릭
  console.log('=== 1) 목록 탭으로 이동 ===');
  await page.evaluate(() => {
    const tabs = [...document.querySelectorAll('.cl-tabfolder-item')];
    const t = tabs.find(t => (t.innerText || '').includes('집행내역 목록'));
    if (t) t.click();
  });
  await sleep(3000);

  // 2) cpr 프레임워크 심층 탐색
  console.log('\n=== 2) cpr 프레임워크 탐색 ===');
  const cprDeep = await page.evaluate(() => {
    const out = [];
    if (typeof cpr === 'undefined') { out.push('cpr 없음'); return out; }

    // cpr 최상위 키
    out.push('cpr keys: ' + Object.keys(cpr).join(', '));

    // cpr.core
    if (cpr.core) {
      out.push('cpr.core keys: ' + Object.keys(cpr.core).slice(0, 20).join(', '));
    }

    // cpr.controls
    if (cpr.controls) {
      out.push('cpr.controls keys: ' + Object.keys(cpr.controls).slice(0, 30).join(', '));
    }

    // cpr.data
    if (cpr.data) {
      out.push('cpr.data keys: ' + Object.keys(cpr.data).slice(0, 20).join(', '));
    }

    // cpr.rpa
    if (cpr.rpa) {
      out.push('cpr.rpa keys: ' + Object.keys(cpr.rpa).slice(0, 20).join(', '));
      try {
        const svc = cpr.rpa.getRPAService();
        if (svc) {
          out.push('rpa service keys: ' + Object.keys(svc).slice(0, 20).join(', '));
          out.push('rpa service proto: ' + Object.getOwnPropertyNames(Object.getPrototypeOf(svc)).slice(0, 20).join(', '));
        }
      } catch(e) { out.push('rpa service err: ' + e.message); }
    }

    // cpr.core.AppInstance 관련
    try {
      if (cpr.core && cpr.core.Platform) {
        out.push('cpr.core.Platform keys: ' + Object.keys(cpr.core.Platform).slice(0, 20).join(', '));
      }
    } catch(e) {}

    // cpr.controls.Grid 또는 유사 클래스 찾기
    try {
      const gridRelated = Object.keys(cpr.controls || {}).filter(k =>
        k.toLowerCase().includes('grid') || k.toLowerCase().includes('sheet') || k.toLowerCase().includes('table')
      );
      out.push('grid-related controls: ' + gridRelated.join(', '));
    } catch(e) {}

    return out;
  });
  cprDeep.forEach(r => console.log('  ' + r));

  // 3) cl-grid DOM 요소에서 위젯 인스턴스 찾기
  console.log('\n=== 3) cl-grid 위젯 인스턴스 탐색 ===');
  const widgetInfo = await page.evaluate(() => {
    const out = [];
    const grids = [...document.querySelectorAll('.cl-grid')];
    out.push('cl-grid 수: ' + grids.length);

    for (let i = 0; i < grids.length; i++) {
      const g = grids[i];
      const rect = g.getBoundingClientRect();
      out.push(`\ngrid[${i}]: ${Math.round(rect.width)}x${Math.round(rect.height)} at (${Math.round(rect.x)},${Math.round(rect.y)})`);

      // 모든 속성 (non-standard) 찾기
      const allProps = [];
      for (const key in g) {
        if (key.startsWith('__') || key.startsWith('_cl') || key.startsWith('cl') || key.includes('widget') || key.includes('control')) {
          allProps.push(key);
        }
      }
      out.push(`  special props: ${allProps.join(', ')}`);

      // Object.keys 확인
      const ownKeys = Object.keys(g).filter(k => !k.startsWith('on'));
      out.push(`  own keys: ${ownKeys.slice(0, 15).join(', ')}`);

      // getOwnPropertyNames
      const ownNames = Object.getOwnPropertyNames(g).filter(k =>
        !k.startsWith('on') && !['innerHTML', 'outerHTML', 'textContent', 'innerText'].includes(k)
      );
      // 표준 DOM이 아닌 것만 필터
      out.push(`  own names count: ${ownNames.length}`);

      // dataset
      if (Object.keys(g.dataset).length > 0) {
        out.push(`  dataset: ${JSON.stringify(g.dataset)}`);
      }

      // id, class
      out.push(`  id: ${g.id}, class: ${g.className.substring(0, 100)}`);
    }

    return out;
  });
  widgetInfo.forEach(r => console.log('  ' + r));

  // 4) cpr 위젯 매핑 방법 탐색
  console.log('\n=== 4) cpr 위젯 매핑 ===');
  const widgetMapping = await page.evaluate(() => {
    const out = [];

    // 방법 1: cpr.core.getControlById 또는 유사 함수
    const coreFns = Object.keys(cpr.core || {}).filter(k => typeof cpr.core[k] === 'function');
    out.push('cpr.core functions: ' + coreFns.join(', '));

    // 방법 2: cpr._registry 또는 유사
    for (const k of Object.keys(cpr)) {
      if (k.includes('registry') || k.includes('Registry') || k.includes('map') || k.includes('Map') || k.includes('instance') || k.includes('Instance')) {
        out.push('cpr.' + k + ': ' + typeof cpr[k]);
      }
    }

    // 방법 3: cpr.core에서 인스턴스 관련
    for (const k of Object.keys(cpr.core || {})) {
      if (k.includes('Instance') || k.includes('App') || k.includes('Control') || k.includes('Widget') || k.includes('Page')) {
        out.push('cpr.core.' + k + ': ' + typeof cpr.core[k]);
      }
    }

    // 방법 4: window에서 앱 인스턴스 찾기
    const appVars = Object.keys(window).filter(k =>
      k.includes('app') || k.includes('App') || k.includes('_cpr') || k.includes('__cpr')
    ).slice(0, 15);
    out.push('window app vars: ' + appVars.join(', '));

    return out;
  });
  widgetMapping.forEach(r => console.log('  ' + r));

  // 5) 그리드 내부 이벤트 리스너 확인
  console.log('\n=== 5) 그리드 이벤트 리스너 ===');
  const eventInfo = await page.evaluate(() => {
    const out = [];
    const grids = document.querySelectorAll('.cl-grid');
    const lastGrid = grids[grids.length - 1];
    if (!lastGrid) return ['no grid'];

    // getEventListeners는 DevTools에서만 사용 가능
    // 대신 on* 속성 확인
    const onProps = [];
    for (const key in lastGrid) {
      if (key.startsWith('on') && lastGrid[key]) {
        onProps.push(key);
      }
    }
    out.push('on* handlers: ' + onProps.join(', '));

    // 내부 자식 구조
    const children = lastGrid.children;
    out.push('direct children: ' + children.length);
    for (let i = 0; i < Math.min(children.length, 5); i++) {
      const c = children[i];
      out.push(`  child[${i}]: ${c.tagName}.${c.className.substring(0, 60)} (${c.children.length} children)`);
    }

    return out;
  });
  eventInfo.forEach(r => console.log('  ' + r));

  // 6) 모든 cl-grid-cell 중 첫 데이터 행 찾기
  console.log('\n=== 6) 그리드 셀 구조 ===');
  const cellInfo = await page.evaluate(() => {
    const out = [];
    const grids = document.querySelectorAll('.cl-grid');
    const lastGrid = grids[grids.length - 1];
    if (!lastGrid) return ['no grid'];

    // cl-grid-row 또는 유사 클래스
    const rows = [...lastGrid.querySelectorAll('[class*="cl-grid-row"], [class*="cl-row"], tr')];
    out.push('rows: ' + rows.length);

    // 첫 5개 행의 구조
    for (let i = 0; i < Math.min(rows.length, 5); i++) {
      const r = rows[i];
      const rect = r.getBoundingClientRect();
      out.push(`  row[${i}]: ${r.className.substring(0,60)} at y=${Math.round(rect.y)}, h=${Math.round(rect.height)}, children=${r.children.length}`);
    }

    // cl-grid 안의 div 구조
    const gridDivs = [...lastGrid.querySelectorAll(':scope > div')];
    out.push('\ngrid direct divs: ' + gridDivs.length);
    for (const d of gridDivs.slice(0, 8)) {
      out.push(`  div: ${d.className.substring(0, 80)}`);
    }

    // cl-grid-cell-data
    const dataCells = [...lastGrid.querySelectorAll('[class*="cell-data"], [class*="celldata"]')];
    out.push('\ndata cells: ' + dataCells.length);
    if (dataCells.length > 0) {
      out.push(`  first: ${dataCells[0].className} text="${(dataCells[0].innerText||'').trim().substring(0,30)}"`);
    }

    return out;
  });
  cellInfo.forEach(r => console.log('  ' + r));

  // 7) cpr.controls.Grid 프로토타입 메서드 탐색
  console.log('\n=== 7) Grid 컨트롤 프로토타입 ===');
  const gridProto = await page.evaluate(() => {
    const out = [];

    // cpr.controls에서 Grid 관련 클래스
    if (cpr.controls) {
      for (const k of Object.keys(cpr.controls)) {
        if (k.toLowerCase().includes('grid') || k.toLowerCase().includes('list') || k.toLowerCase().includes('table')) {
          const cls = cpr.controls[k];
          out.push(`cpr.controls.${k}: ${typeof cls}`);
          if (typeof cls === 'function' && cls.prototype) {
            const methods = Object.getOwnPropertyNames(cls.prototype).filter(m => m !== 'constructor').slice(0, 30);
            out.push(`  methods: ${methods.join(', ')}`);
          }
        }
      }
    }

    return out;
  });
  gridProto.forEach(r => console.log('  ' + r));

  await page.screenshot({ path: '/tmp/botem-grid-research.png' });
  console.log('\n스크린샷: /tmp/botem-grid-research.png');
  await b.close();
})().catch(e => console.error('ERROR:', e.message));
