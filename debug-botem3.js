/**
 * 보탬e 페이지네이션 고정 + cl-* 내부 API 탐색
 * node debug-botem3.js
 */
const { chromium } = require('playwright');
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

(async () => {
  const b = await chromium.connectOverCDP('http://localhost:9445', { timeout: 10000 })
    .catch(e => { console.error('CDP 연결 실패:', e.message); process.exit(1); });
  const page = b.contexts()[0].pages().find(pg => pg.url().includes('lss.do'));
  if (!page) { console.error('lss.do 탭 없음'); await b.close(); process.exit(1); }

  console.log('=== Phase 1: 뷰포트 크기 조정 시도 ===');
  await page.setViewportSize({ width: 1718, height: 1200 });
  await sleep(1500);

  const afterResize = await page.evaluate(() => {
    const pager = document.querySelector('[class*=cl-pageindexer]');
    const nextBtn = document.querySelector('[class*=cl-pageindexer-next]');
    if (!pager) return { error: 'pager not found' };
    return {
      pagerRect: JSON.stringify(pager.getBoundingClientRect()),
      nextBtnRect: nextBtn ? JSON.stringify(nextBtn.getBoundingClientRect()) : 'null',
      nextDisabled: nextBtn ? nextBtn.classList.contains('cl-disabled') : null,
    };
  });
  console.log('뷰포트 조정 후:', afterResize);

  console.log('\n=== Phase 2: cl-* 내부 컴포넌트 탐색 ===');
  const componentInfo = await page.evaluate(() => {
    const result = {};

    // 그리드 행의 날짜 셀 찾기
    const dateCell = [...document.querySelectorAll('div')].find(d => {
      if (d.childElementCount > 0) return false;
      return /^\d{4}-\d{2}-\d{2}$/.test((d.innerText || '').trim());
    });

    if (dateCell) {
      // 상위 컴포넌트 탐색
      let el = dateCell;
      for (let i = 0; i < 20; i++) {
        el = el.parentElement;
        if (!el) break;
        if (el.__vue__) { result.vueFound = { depth: i, keys: Object.keys(el.__vue__).slice(0, 20) }; break; }
        if (el._component) { result.componentFound = { depth: i, keys: Object.keys(el._component).slice(0, 20) }; break; }
        if (el.__reactFiber || el.__reactInternalFiber) { result.reactFound = { depth: i }; break; }
      }
    }

    // cl-pageindexer 직접 탐색
    const pager = document.querySelector('[class*=cl-pageindexer]');
    if (pager) {
      let el = pager;
      for (let i = 0; i < 10; i++) {
        if (el.__vue__) { result.pagerVue = { depth: i, $data: JSON.stringify(el.__vue__.$data).substring(0, 200) }; break; }
        if (el._clComponent) { result.pagerClComp = Object.keys(el._clComponent).slice(0, 20); break; }
        el = el.parentElement;
        if (!el) break;
      }
    }

    // window.__cl 또는 비슷한 전역
    const clGlobals = ['__cl', 'cl', 'CL', 'clApp', 'CLApp', 'clGrid', 'clFramework'];
    result.clGlobals = {};
    for (const k of clGlobals) {
      if (window[k]) result.clGlobals[k] = typeof window[k] === 'object' ? Object.keys(window[k]).slice(0, 10) : typeof window[k];
    }

    // cl-pageindexer-next 이벤트 리스너 탐색 (Chrome DevTools Protocol)
    const nextBtn = document.querySelector('[class*=cl-pageindexer-next]');
    if (nextBtn) {
      const listeners = [];
      // onclick이나 data-action 속성 탐색
      for (const attr of nextBtn.attributes) {
        listeners.push(`${attr.name}="${attr.value.substring(0,50)}"`);
      }
      result.nextBtnAttrs = listeners;
      // 클래스 목록
      result.nextBtnClasses = [...nextBtn.classList];
    }

    // 페이저 부모 중 cl-disabled가 아닌 것 클릭 시도
    // 모든 cl-* 클래스를 가진 요소 중 next/다음 관련
    const allCls = [...document.querySelectorAll('[class*=cl-next], [class*=cl-last], [class*=next-page]')];
    result.nextCandidates = allCls.map(el => ({
      cls: (el.className || '').substring(0, 60),
      disabled: el.classList.contains('cl-disabled'),
      w: Math.round(el.getBoundingClientRect().width),
      y: Math.round(el.getBoundingClientRect().y),
    }));

    return result;
  });
  console.log('컴포넌트 정보:', JSON.stringify(componentInfo, null, 2));

  console.log('\n=== Phase 3: 강제 클릭 시도 ===');
  const clickResult = await page.evaluate(() => {
    // 방법 1: cl-disabled 제거 후 클릭
    const nextBtn = document.querySelector('[class*=cl-pageindexer-next]');
    if (!nextBtn) return 'nextBtn not found';

    // disabled 클래스 제거
    nextBtn.classList.remove('cl-disabled');

    // 부모들의 overflow/height 강제 설정
    let parent = nextBtn.parentElement;
    while (parent) {
      const s = window.getComputedStyle(parent);
      if (s.overflow === 'hidden') {
        parent.style.overflow = 'visible';
      }
      if (Math.round(parent.getBoundingClientRect().height) === 0) {
        parent.style.minHeight = '40px';
      }
      parent = parent.parentElement;
      if (parent === document.body) break;
    }

    // 직접 클릭
    nextBtn.click();
    return { clicked: true, classes: [...nextBtn.classList] };
  });
  console.log('클릭 결과:', clickResult);

  await sleep(2000);

  // 클릭 후 변화 확인
  const afterClick = await page.evaluate(() => {
    const dateCells = [...document.querySelectorAll('div')].filter(d => {
      if (d.childElementCount > 0) return false;
      return /^\d{4}-\d{2}-\d{2}$/.test((d.innerText || '').trim());
    });
    const pageIdx = document.querySelector('[class*=cl-pageindexer-index-area]');
    return {
      dateCellCount: dateCells.length,
      firstDate: dateCells[0]?.innerText.trim(),
      pageIndex: pageIdx?.innerText.trim(),
      totalText: document.body.innerText.match(/총\s*\d+\s*건/)?.[0],
    };
  });
  console.log('\n클릭 후 상태:', afterClick);

  await b.close();
})().catch(e => console.error('ERROR:', e.message));
