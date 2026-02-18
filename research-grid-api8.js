/**
 * cpr Platform 싱글턴 찾기 + EmbeddedApp에서 로드된 앱 접근
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

  // 1) mainApp에서 embeddedapp 컨트롤 직접 접근 (getAllRecursiveChildren이 아닌 다른 방법)
  console.log('=== 1) mainApp 직접 탐색 ===');
  const mainAppDeep = await page.evaluate(() => {
    const out = [];
    const app = AppUtil.getMainApp();

    // mainApp의 모든 자체 키 (난독화 포함)
    const appKeys = Object.keys(app);
    out.push('mainApp keys: ' + appKeys.join(', '));

    // 앱 인스턴스의 _scopeImpl
    if (app._scopeImpl) {
      const scopeKeys = Object.keys(app._scopeImpl);
      out.push('app._scopeImpl keys: ' + scopeKeys.join(', '));

      for (const k of scopeKeys) {
        const v = app._scopeImpl[k];
        if (v instanceof Map) {
          out.push(`  ${k} (Map): size=${v.size}`);
          let i = 0;
          for (const [mk, mv] of v) {
            if (i >= 10) { out.push('  ...'); break; }
            const desc = mv ? `type=${mv.type || '?'} name="${mv.name || ''}" id="${mv.id || ''}"` : 'null';
            out.push(`    "${String(mk).substring(0,40)}": ${desc}`);
            i++;
          }
        } else if (typeof v === 'object' && v !== null) {
          const vKeys = Object.keys(v);
          out.push(`  ${k}: ${vKeys.length} keys`);
          for (const vk of vKeys) {
            const vv = v[vk];
            if (vv instanceof Map) {
              out.push(`    ${vk} (Map): size=${vv.size}`);
              let i = 0;
              for (const [mk, mv] of vv) {
                if (i >= 5) { out.push('    ...'); break; }
                const desc = mv ? `type=${mv.type || '?'} name="${mv.name || ''}"` : 'null';
                out.push(`      "${String(mk).substring(0,40)}": ${desc}`);
                i++;
              }
            }
          }
        }
      }
    }

    return out;
  });
  mainAppDeep.forEach(r => console.log('  ' + r));

  // 2) EmbeddedApp 컨트롤의 난독화 메서드/속성으로 로드된 앱 찾기
  console.log('\n=== 2) EmbeddedApp 컨트롤 내부 ===');
  const embDeep = await page.evaluate(() => {
    const out = [];
    const app = AppUtil.getMainApp();

    // cpr.controls에서 EmbeddedApp 클래스 찾기
    const embClass = Object.keys(cpr.controls).filter(k =>
      k.toLowerCase().includes('embed') || k.toLowerCase().includes('Embed')
    );
    out.push('embed controls: ' + embClass.join(', '));

    // EmbeddedApp 프로토타입
    if (cpr.controls.EmbeddedApp) {
      const proto = cpr.controls.EmbeddedApp.prototype;
      const allMethods = Object.getOwnPropertyNames(proto).filter(m => m !== 'constructor');
      const readable = allMethods.filter(m => !m.startsWith('µ'));
      out.push('EmbeddedApp readable: ' + readable.join(', '));
      out.push('EmbeddedApp all: ' + allMethods.slice(0, 30).join(', '));
    }

    return out;
  });
  embDeep.forEach(r => console.log('  ' + r));

  // 3) 다른 접근: App 클래스의 getInstances로 모든 앱 찾기
  console.log('\n=== 3) App.getInstances ===');
  const allApps = await page.evaluate(() => {
    const out = [];

    // cpr.core.App의 정적 메서드 또는 인스턴스 메서드
    // App 생성자를 직접 호출해서 목록 가져오기
    try {
      // 메인 앱의 app 속성
      const mainAppInstance = AppUtil.getMainApp();
      const appObj = mainAppInstance.app;
      out.push('mainApp.app: ' + typeof appObj);
      if (appObj) {
        out.push('  app.id: ' + (appObj.id || ''));
        out.push('  app.title: ' + (appObj.title || ''));

        // getInstances
        if (typeof appObj.getInstances === 'function') {
          const instances = appObj.getInstances();
          out.push('  instances: ' + (instances ? instances.length : 'null'));
          if (instances) {
            for (let i = 0; i < instances.length; i++) {
              out.push(`    inst[${i}]: id="${instances[i].id}" uuid="${instances[i].uuid}" state=${instances[i].state}`);
            }
          }
        }

        // 앱 내부 키
        const appKeys = Object.keys(appObj);
        out.push('  app keys: ' + appKeys.join(', '));

        // _scopeImpl
        if (appObj._scopeImpl) {
          const scopeKeys = Object.keys(appObj._scopeImpl);
          out.push('  app._scopeImpl keys: ' + scopeKeys.join(', '));
          for (const k of scopeKeys) {
            const v = appObj._scopeImpl[k];
            if (v instanceof Map) {
              out.push(`    ${k} (Map): size=${v.size}`);
            }
          }
        }
      }
    } catch(e) { out.push('app err: ' + e.message); }

    return out;
  });
  allApps.forEach(r => console.log('  ' + r));

  // 4) 핵심: AppInstance의 _scopeImpl에서 그리드 찾기
  console.log('\n=== 4) AppInstance _scopeImpl 깊이 탐색 ===');
  const scopeDeep = await page.evaluate(() => {
    const out = [];
    const mainAppInstance = AppUtil.getMainApp();

    // _scopeImpl의 모든 맵을 재귀적으로 탐색
    function exploreScopeImpl(scope, prefix, depth) {
      if (depth > 3) return;
      for (const k of Object.keys(scope)) {
        const v = scope[k];
        if (v instanceof Map) {
          out.push(`${prefix}.${k} (Map): size=${v.size}`);
          let i = 0;
          for (const [mk, mv] of v) {
            if (i >= 8) { out.push(`${prefix}.${k}: ...${v.size - 8} more`); break; }
            if (mv && typeof mv === 'object') {
              const t = mv.type || mv.constructor?.name || typeof mv;
              const n = mv.name || mv.id || '';
              out.push(`  [${mk}] → ${t} "${n}"`);
              // grid 타입이면 상세 정보
              if (t === 'grid' || (n && n.toLowerCase().includes('grid'))) {
                out.push(`    *** GRID FOUND! ***`);
                out.push(`    uuid: ${mv.uuid}`);
                if (mv.getRowCount) out.push(`    rows: ${mv.getRowCount()}`);
              }
            }
            i++;
          }
        } else if (typeof v === 'object' && v !== null && !Array.isArray(v)) {
          exploreScopeImpl(v, `${prefix}.${k}`, depth + 1);
        }
      }
    }

    exploreScopeImpl(mainAppInstance._scopeImpl, 'appInst._scopeImpl', 0);

    // 앱의 난독화 키도 탐색
    for (const k of Object.keys(mainAppInstance)) {
      const v = mainAppInstance[k];
      if (v instanceof Map && v.size > 0) {
        out.push(`\nappInst.${k} (Map): size=${v.size}`);
        let i = 0;
        for (const [mk, mv] of v) {
          if (i >= 5) break;
          const desc = mv ? `${mv.type || typeof mv} "${mv.name || ''}"` : 'null';
          out.push(`  [${mk}] → ${desc}`);
          i++;
        }
      }
    }

    return out;
  });
  scopeDeep.forEach(r => console.log('  ' + r));

  await b.close();
})().catch(e => console.error('ERROR:', e.message));
