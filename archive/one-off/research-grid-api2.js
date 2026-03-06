/**
 * cpr Grid 위젯 인스턴스 접근 방법 탐색 (2)
 * data-ndid → 위젯 인스턴스 → 행 선택 API
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

  // 1) AppInstance 접근 방법
  console.log('=== 1) AppInstance 접근 ===');
  const appInfo = await page.evaluate(() => {
    const out = [];

    // AppInstance 프로토타입 메서드
    const proto = cpr.core.AppInstance.prototype;
    const methods = Object.getOwnPropertyNames(proto).filter(m => m !== 'constructor');
    out.push('AppInstance methods: ' + methods.slice(0, 40).join(', '));

    // AppInstance.prototype에서 읽을 수 있는 메서드명 (비난독화)
    const readable = methods.filter(m => !m.startsWith('µ'));
    out.push('readable methods: ' + readable.join(', '));

    // Platform에서 인스턴스 가져오기
    try {
      const platform = cpr.core.Platform;
      const platformProto = Object.getOwnPropertyNames(cpr.core.Platform.prototype || {});
      out.push('Platform proto: ' + platformProto.slice(0, 20).join(', '));

      // Platform static methods
      const platformStatic = Object.getOwnPropertyNames(cpr.core.Platform).filter(k => typeof cpr.core.Platform[k] === 'function');
      out.push('Platform static fns: ' + platformStatic.join(', '));
    } catch(e) { out.push('Platform err: ' + e.message); }

    // App
    try {
      const appProto = Object.getOwnPropertyNames(cpr.core.App.prototype || {});
      out.push('App proto: ' + appProto.slice(0, 30).join(', '));
      const readableApp = appProto.filter(m => !m.startsWith('µ'));
      out.push('App readable: ' + readableApp.join(', '));
    } catch(e) { out.push('App err: ' + e.message); }

    return out;
  });
  appInfo.forEach(r => console.log('  ' + r));

  // 2) data-ndid로 위젯 찾기
  console.log('\n=== 2) ndid → 위젯 인스턴스 ===');
  const ndidInfo = await page.evaluate(() => {
    const out = [];

    // 메인 그리드의 ndid
    const grids = [...document.querySelectorAll('.cl-grid')];
    const mainGrid = grids[2]; // 집행내역 목록 그리드
    if (!mainGrid) { out.push('main grid not found'); return out; }
    const ndid = mainGrid.dataset.ndid;
    out.push('main grid ndid: ' + ndid);

    // 방법 1: cpr에서 ndid로 컨트롤 찾기
    try {
      // getControl, findControl, lookup 등
      for (const ns of [cpr, cpr.core, cpr.controls, cpr.ufc]) {
        if (!ns) continue;
        const fns = Object.keys(ns).filter(k => typeof ns[k] === 'function');
        const findFns = fns.filter(k =>
          k.toLowerCase().includes('find') ||
          k.toLowerCase().includes('get') ||
          k.toLowerCase().includes('lookup') ||
          k.toLowerCase().includes('byid')
        );
        if (findFns.length > 0) {
          out.push(`${ns === cpr ? 'cpr' : ns === cpr.core ? 'core' : ns === cpr.controls ? 'controls' : 'ufc'} find fns: ${findFns.join(', ')}`);
        }
      }
    } catch(e) { out.push('find fn err: ' + e.message); }

    // 방법 2: DOM 요소에서 __cpr__ 또는 유사 속성
    try {
      const allKeys = [];
      for (const key in mainGrid) {
        if (!key.startsWith('on') && !['innerHTML', 'outerHTML', 'textContent', 'innerText',
            'style', 'className', 'classList', 'children', 'childNodes', 'parentNode',
            'parentElement', 'firstChild', 'lastChild', 'nextSibling', 'previousSibling'].includes(key)) {
          // 비표준 키만
          const desc = typeof mainGrid[key];
          if (desc === 'object' || desc === 'function') {
            allKeys.push(key + ':' + desc);
          }
        }
      }
      out.push('grid non-standard obj/fn keys: ' + allKeys.slice(0, 20).join(', '));
    } catch(e) {}

    // 방법 3: Symbol 속성
    try {
      const symbols = Object.getOwnPropertySymbols(mainGrid);
      out.push('grid symbols: ' + symbols.length);
      for (const s of symbols) {
        const val = mainGrid[s];
        out.push('  ' + s.toString() + ': ' + typeof val);
        if (typeof val === 'object' && val !== null) {
          out.push('    keys: ' + Object.keys(val).slice(0, 10).join(', '));
        }
      }
    } catch(e) { out.push('symbol err: ' + e.message); }

    // 방법 4: __proto__ 체인에서 cpr 관련
    try {
      let proto = Object.getPrototypeOf(mainGrid);
      let depth = 0;
      while (proto && depth < 5) {
        const name = proto.constructor?.name;
        if (name && name !== 'HTMLDivElement' && name !== 'HTMLElement' && name !== 'Element' && name !== 'Node' && name !== 'EventTarget') {
          out.push('proto chain[' + depth + ']: ' + name);
        }
        proto = Object.getPrototypeOf(proto);
        depth++;
      }
    } catch(e) {}

    return out;
  });
  ndidInfo.forEach(r => console.log('  ' + r));

  // 3) pushNewApp 탐색 (window에 있었음)
  console.log('\n=== 3) window 글로벌 앱 관련 ===');
  const globalInfo = await page.evaluate(() => {
    const out = [];

    // pushNewApp
    if (typeof pushNewApp === 'function') {
      out.push('pushNewApp: ' + pushNewApp.toString().substring(0, 200));
    }

    // AppUtil
    if (typeof AppUtil !== 'undefined') {
      out.push('AppUtil type: ' + typeof AppUtil);
      if (typeof AppUtil === 'object') {
        out.push('AppUtil keys: ' + Object.keys(AppUtil).join(', '));
      }
    }

    // cpr.core.Platform 인스턴스
    try {
      // Platform이 싱글턴인지 확인
      const p = new cpr.core.Platform();
      out.push('Platform instance: ' + typeof p);
      out.push('Platform instance keys: ' + Object.keys(p).slice(0, 20).join(', '));
    } catch(e) {
      out.push('Platform new err: ' + e.message);
    }

    // cpr.core.App 인스턴스 찾기
    try {
      // App.prototype에서 getAppInstance 같은 것
      const appReadable = Object.getOwnPropertyNames(cpr.core.App.prototype).filter(m => !m.startsWith('µ'));
      out.push('App readable methods: ' + appReadable.join(', '));

      // 앱 이름 찾기 (lss.do 관련)
      // 글로벌에서 app 변수
      const possibleApps = Object.keys(window).filter(k => {
        try {
          const v = window[k];
          return v && typeof v === 'object' && v.constructor &&
                 (v.constructor.name || '').includes('App');
        } catch(e) { return false; }
      });
      out.push('possible app vars: ' + possibleApps.join(', '));
    } catch(e) { out.push('App search err: ' + e.message); }

    return out;
  });
  globalInfo.forEach(r => console.log('  ' + r));

  // 4) Grid 프로토타입의 모든 메서드 (난독화 포함)
  console.log('\n=== 4) Grid 전체 메서드 ===');
  const gridMethods = await page.evaluate(() => {
    const proto = cpr.controls.Grid.prototype;
    const methods = Object.getOwnPropertyNames(proto).filter(m => m !== 'constructor');
    return methods;
  });
  console.log('  Grid methods (' + gridMethods.length + '):');
  console.log('  ' + gridMethods.join(', '));

  // 5) Grid.prototype.focus 분석
  console.log('\n=== 5) Grid.focus 코드 ===');
  const focusCode = await page.evaluate(() => {
    return cpr.controls.Grid.prototype.focus.toString().substring(0, 500);
  });
  console.log('  ' + focusCode);

  // 6) 부모 클래스 체인
  console.log('\n=== 6) Grid 상속 체인 ===');
  const inheritance = await page.evaluate(() => {
    const out = [];
    let proto = cpr.controls.Grid.prototype;
    let depth = 0;
    while (proto && depth < 10) {
      const name = proto.constructor?.name || '(anonymous)';
      const methods = Object.getOwnPropertyNames(proto).filter(m => !m.startsWith('µ') && m !== 'constructor');
      out.push(`[${depth}] ${name}: ${methods.join(', ')}`);
      proto = Object.getPrototypeOf(proto);
      depth++;
    }
    return out;
  });
  inheritance.forEach(r => console.log('  ' + r));

  await b.close();
})().catch(e => console.error('ERROR:', e.message));
