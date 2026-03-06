/**
 * 보탬e cl-* 프레임워크 페이지네이션 API 탐색
 * node debug-botem2.js
 */
const { chromium } = require('playwright');

(async () => {
  const b = await chromium.connectOverCDP('http://localhost:9445', { timeout: 10000 })
    .catch(e => { console.error('CDP 연결 실패:', e.message); process.exit(1); });
  const page = b.contexts()[0].pages().find(pg => pg.url().includes('lss.do'));
  if (!page) { console.error('lss.do 탭 없음'); await b.close(); process.exit(1); }

  const info = await page.evaluate(() => {
    const result = {};

    // 1. cl-pageindexer 요소와 부모 스타일 체인
    const pager = document.querySelector('[class*=cl-pageindexer]');
    if (pager) {
      const pagerStyle = window.getComputedStyle(pager);
      result.pagerDisplay = pagerStyle.display;
      result.pagerVisibility = pagerStyle.visibility;
      result.pagerOverflow = pagerStyle.overflow;
      result.pagerRect = JSON.stringify(pager.getBoundingClientRect());

      // 부모 4단계 체인
      const parents = [];
      let p = pager.parentElement;
      for (let i = 0; i < 5 && p; i++, p = p.parentElement) {
        const s = window.getComputedStyle(p);
        const r = p.getBoundingClientRect();
        parents.push({
          cls: (p.className || '').substring(0, 60),
          display: s.display,
          overflow: s.overflow,
          overflowY: s.overflowY,
          h: Math.round(r.height),
          w: Math.round(r.width),
        });
      }
      result.parents = parents;

      // cl-pageindexer-next 내부 프로퍼티 탐색
      const nextBtn = document.querySelector('[class*=cl-pageindexer-next]');
      if (nextBtn) {
        const keys = Object.getOwnPropertyNames(nextBtn).filter(k => !['nodeName','nodeType'].includes(k));
        result.nextBtnProps = keys.slice(0, 20);
        // cl-component 내부 접근 시도
        if (nextBtn._component) result.nextBtnComponent = Object.keys(nextBtn._component).slice(0, 20);
        if (nextBtn.__vue__) result.nextBtnVue = Object.keys(nextBtn.__vue__).slice(0, 20);
      }
    }

    // 2. window에서 cl-* 관련 객체 탐색
    const clObjs = [];
    for (const k of Object.keys(window)) {
      try {
        const v = window[k];
        if (v && typeof v === 'object' && !Array.isArray(v)) {
          const vStr = v.constructor ? v.constructor.name : '';
          if (vStr.includes('Cl') || vStr.includes('cl') || k.includes('cl') || k.includes('Cl')) {
            const methods = Object.getOwnPropertyNames(Object.getPrototypeOf(v) || {})
              .filter(m => typeof v[m] === 'function').slice(0, 10);
            if (methods.length > 0) clObjs.push({ key: k, constructor: vStr, methods });
          }
        }
      } catch(e) {}
    }
    result.clObjs = clObjs.slice(0, 10);

    // 3. 그리드 컨테이너 내 스크롤 가능 요소 탐색
    const scrollables = [...document.querySelectorAll('div')].filter(d => {
      const s = window.getComputedStyle(d);
      const r = d.getBoundingClientRect();
      return (s.overflowY === 'scroll' || s.overflowY === 'auto' || s.overflow === 'scroll' || s.overflow === 'auto')
        && r.height > 50 && r.width > 100;
    }).map(d => {
      const r = d.getBoundingClientRect();
      return {
        cls: (d.className || '').substring(0, 60),
        h: Math.round(r.height),
        w: Math.round(r.width),
        scrollH: d.scrollHeight,
        scrollTop: d.scrollTop,
      };
    });
    result.scrollables = scrollables.slice(0, 10);

    // 4. cl-grid-body 찾기
    const gridBody = document.querySelector('[class*=cl-grid-body]');
    if (gridBody) {
      const r = gridBody.getBoundingClientRect();
      const s = window.getComputedStyle(gridBody);
      result.gridBody = {
        cls: (gridBody.className || '').substring(0, 60),
        h: Math.round(r.height),
        w: Math.round(r.width),
        scrollH: gridBody.scrollHeight,
        scrollTop: gridBody.scrollTop,
        overflowY: s.overflowY,
      };
    }

    // 5. 그리드 행 수 (렌더된 것만)
    const dateCells = [...document.querySelectorAll('div')].filter(d => {
      if (d.childElementCount > 0) return false;
      return /^\d{4}-\d{2}-\d{2}$/.test((d.innerText || '').trim());
    });
    result.renderedDateCells = dateCells.length;
    result.sampleDates = dateCells.slice(0, 3).map(d => d.innerText.trim() + ' y=' + Math.round(d.getBoundingClientRect().y));

    // 6. cl-* framework 전역 함수 탐색
    const clFns = Object.keys(window).filter(k => {
      try { return typeof window[k] === 'function' && (k.startsWith('cl') || k.startsWith('Cl')); }
      catch(e) { return false; }
    });
    result.clFns = clFns.slice(0, 20);

    // 7. 총 건수 텍스트
    const totalMatch = document.body.innerText.match(/총\s*(\d+)\s*건/);
    result.totalText = totalMatch ? totalMatch[0] : 'not found';

    return result;
  });

  console.log('=== pager 스타일 ===');
  console.log('display:', info.pagerDisplay, 'visibility:', info.pagerVisibility);
  console.log('rect:', info.pagerRect);
  console.log('\n부모 체인:');
  (info.parents || []).forEach((p, i) => console.log(` [${i}]`, JSON.stringify(p)));

  console.log('\n=== 스크롤 가능 요소 ===');
  (info.scrollables || []).forEach(s => console.log(' ', JSON.stringify(s)));

  console.log('\n=== 그리드 바디 ===');
  console.log(JSON.stringify(info.gridBody));

  console.log('\n렌더된 날짜 셀:', info.renderedDateCells);
  console.log('샘플:', info.sampleDates);

  console.log('\n=== cl-* window 객체 ===');
  (info.clObjs || []).forEach(o => console.log(' ', JSON.stringify(o)));

  console.log('\ncl-* 전역 함수:', info.clFns);
  console.log('\n총건수:', info.totalText);

  await b.close();
})().catch(e => console.error('ERROR:', e.message));
