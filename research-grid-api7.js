/**
 * Platform 내부 레지스트리에서 직접 그리드 찾기
 * + cpr.rpa 서비스 탐색
 * + 임베디드 앱 내부 앱 인스턴스 접근
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

  // 1) Platform 내부 맵에서 직접 UUID로 검색
  console.log('=== 1) Platform 내부 레지스트리 탐색 ===');
  const registrySearch = await page.evaluate(() => {
    const out = [];
    const platform = new cpr.core.Platform();
    const scope = platform._scopeImpl;

    // scope의 내부 맵 탐색
    for (const k of Object.keys(scope)) {
      const v = scope[k];
      if (v && typeof v === 'object') {
        // µvn, µdn 안의 내용
        for (const sk of Object.keys(v)) {
          const sv = v[sk];
          if (sv instanceof Map) {
            out.push(`scope.${k}.${sk} (Map): size=${sv.size}`);
            let count = 0;
            for (const [mk, mv] of sv) {
              if (count >= 3) { out.push('  ...'); break; }
              out.push(`  "${String(mk).substring(0,40)}": ${typeof mv} ${mv?.constructor?.name || ''}`);
              if (typeof mv === 'object' && mv !== null) {
                const mvKeys = Object.keys(mv).slice(0, 5);
                out.push(`    keys: ${mvKeys.join(', ')}`);
              }
              count++;
            }
          } else if (typeof sv === 'object' && sv !== null) {
            const svKeys = Object.keys(sv);
            out.push(`scope.${k}.${sk}: ${svKeys.length} keys`);
            // UUID 키가 있는지?
            const uuidKeys = svKeys.filter(k => k.includes('uuid'));
            if (uuidKeys.length > 0) {
              out.push(`  uuid keys: ${uuidKeys.slice(0, 3).join(', ')}`);
            }
          }
        }
      }
    }

    return out;
  });
  registrySearch.forEach(r => console.log('  ' + r));

  // 2) cpr.rpa.getRPAService() 탐색
  console.log('\n=== 2) RPA 서비스 ===');
  const rpaInfo = await page.evaluate(() => {
    const out = [];
    try {
      const svc = cpr.rpa.getRPAService();
      if (!svc) { out.push('no rpa service'); return out; }

      out.push('rpa service type: ' + typeof svc);

      // 모든 메서드 (프로토타입 체인)
      let proto = Object.getPrototypeOf(svc);
      const allMethods = [];
      while (proto && proto.constructor.name !== 'Object') {
        const methods = Object.getOwnPropertyNames(proto)
          .filter(m => !m.startsWith('µ') && m !== 'constructor');
        allMethods.push(...methods);
        proto = Object.getPrototypeOf(proto);
      }
      const unique = [...new Set(allMethods)];
      out.push('rpa methods: ' + unique.join(', '));

      // 속성
      const ownKeys = Object.keys(svc);
      out.push('rpa own keys: ' + ownKeys.join(', '));

    } catch(e) { out.push('rpa err: ' + e.message); }
    return out;
  });
  rpaInfo.forEach(r => console.log('  ' + r));

  // 3) Platform.lookupByPredication 시도
  console.log('\n=== 3) lookupByPredication ===');
  const predicSearch = await page.evaluate(() => {
    const out = [];
    const platform = new cpr.core.Platform();

    try {
      // 타입이 grid인 것 찾기
      const result = platform.lookupByPredication(ctrl => ctrl.type === 'grid');
      out.push('predication(type=grid): ' + (result ? 'found: ' + result.uuid : 'null'));
    } catch(e) { out.push('predication err: ' + e.message); }

    try {
      // 모든 것 찾기
      const allResult = platform.lookupByPredication(ctrl => true);
      out.push('predication(all): ' + (allResult ? typeof allResult + ' ' + (allResult.type || '') : 'null'));
    } catch(e) { out.push('predication all err: ' + e.message); }

    return out;
  });
  predicSearch.forEach(r => console.log('  ' + r));

  // 4) 핵심: embeddedapp 컨트롤의 내부 _appInstance 접근
  console.log('\n=== 4) embeddedapp 내부 속성 ===');
  const embInternals = await page.evaluate(() => {
    const out = [];
    const app = AppUtil.getMainApp();

    // embeddedapp ndid: uuid-9c398b79-7e30-0df5-778e-505861b1abbf
    const embNdid = 'uuid-9c398b79-7e30-0df5-778e-505861b1abbf';

    // mainApp에서 lookupByUUID
    const embCtrl = app.lookupByUUID(embNdid);
    out.push('mainApp.lookupByUUID(emb): ' + (embCtrl ? 'FOUND' : 'null'));

    if (embCtrl) {
      // 내부 속성 탐색
      const keys = Object.keys(embCtrl);
      out.push('embCtrl keys: ' + keys.join(', '));

      // getAppInstance
      const embApp = embCtrl.getAppInstance();
      out.push('embCtrl.getAppInstance: ' + (embApp ? embApp.id : 'null'));

      // 숨겨진 속성
      for (const k of keys) {
        const v = embCtrl[k];
        if (v && typeof v === 'object' && v.constructor && v.constructor.name !== 'Object') {
          out.push(`  ${k}: ${v.constructor.name}`);
        }
      }
    } else {
      // 다른 방법으로 찾기
      // platform 레지스트리
      const platform = new cpr.core.Platform();
      try {
        const ctrl = platform.lookupByUUID(embNdid);
        out.push('platform.lookupByUUID(emb): ' + (ctrl ? 'FOUND type=' + ctrl.type : 'null'));
      } catch(e) {}

      // 직접 DOM에서 embeddedapp 찾아서 cpr 속성 확인
      const embEl = document.querySelector(`[data-ndid="${embNdid}"]`);
      if (embEl) {
        out.push('embEl found, exploring internal...');

        // embEl의 모든 비표준 속성
        for (const k in embEl) {
          if (k.startsWith('_') || k.startsWith('µ')) {
            out.push(`  embEl.${k}: ${typeof embEl[k]}`);
          }
        }

        // Symbol 속성
        const symbols = Object.getOwnPropertySymbols(embEl);
        out.push('embEl symbols: ' + symbols.length);
      }
    }

    return out;
  });
  embInternals.forEach(r => console.log('  ' + r));

  // 5) 완전히 다른 접근: cleopatra.js의 앱 레지스트리 직접 접근
  console.log('\n=== 5) 글로벌 앱 레지스트리 ===');
  const globalRegistry = await page.evaluate(() => {
    const out = [];

    // Platform 싱글턴의 모든 내부 속성
    const platform = new cpr.core.Platform();
    const allKeys = Object.keys(platform);
    out.push('platform keys: ' + allKeys.join(', '));

    for (const k of allKeys) {
      const v = platform[k];
      if (v && typeof v === 'object') {
        if (v instanceof Map) {
          out.push(`${k} (Map): size=${v.size}`);
          let i = 0;
          for (const [mk, mv] of v) {
            if (i >= 5) break;
            const desc = mv ? (mv.id || mv.uuid || mv.type || typeof mv) : 'null';
            out.push(`  "${String(mk).substring(0,50)}": ${desc}`);
            i++;
          }
        } else if (Array.isArray(v)) {
          out.push(`${k} (Array): length=${v.length}`);
          for (let i = 0; i < Math.min(3, v.length); i++) {
            const item = v[i];
            const desc = item ? (item.id || item.uuid || item.type || typeof item) : 'null';
            out.push(`  [${i}]: ${desc}`);
          }
        } else {
          const vk = Object.keys(v);
          out.push(`${k}: ${vk.length} keys (${vk.slice(0, 3).join(', ')})`);
        }
      }
    }

    return out;
  });
  globalRegistry.forEach(r => console.log('  ' + r));

  // 6) 최후 시도: Platform의 난독화 메서드 중 앱 관련
  console.log('\n=== 6) Platform 난독화 키 탐색 ===');
  const platformObfuscated = await page.evaluate(() => {
    const out = [];
    const platform = new cpr.core.Platform();

    // µMw, µxe, µTw, µDw
    for (const k of Object.keys(platform)) {
      const v = platform[k];
      if (v && typeof v === 'object' && !(v instanceof Map) && !Array.isArray(v)) {
        const vKeys = Object.keys(v);
        out.push(`\nplatform.${k}: ${vKeys.length} keys`);

        for (const vk of vKeys) {
          const vv = v[vk];
          if (vv instanceof Map) {
            out.push(`  ${vk} (Map): size=${vv.size}`);
            let i = 0;
            for (const [mk, mv] of vv) {
              if (i >= 3) break;
              out.push(`    key type: ${typeof mk}, val: ${mv?.id || mv?.uuid || mv?.type || typeof mv}`);
              if (mv && typeof mv === 'object') {
                const mvKeys = Object.getOwnPropertyNames(mv).filter(m => !m.startsWith('µ')).slice(0, 10);
                out.push(`    readable: ${mvKeys.join(', ')}`);
              }
              i++;
            }
          } else if (Array.isArray(vv)) {
            out.push(`  ${vk} (Array): length=${vv.length}`);
          } else if (typeof vv === 'object' && vv !== null) {
            out.push(`  ${vk}: keys=${Object.keys(vv).slice(0, 5).join(', ')}`);
          }
        }
      }
    }

    return out;
  });
  platformObfuscated.forEach(r => console.log('  ' + r));

  await b.close();
})().catch(e => console.error('ERROR:', e.message));
