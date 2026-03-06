const { chromium } = require('playwright');
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
(async () => {
  const b = await chromium.connectOverCDP('http://localhost:9445', {timeout:10000});
  const p = b.contexts()[0].pages().find(pg => pg.url().includes('lss.do'));

  const info = await p.evaluate(() => {
    // window에서 gotoPage/nextPage 메서드 가진 객체 찾기
    const windowGrids = Object.keys(window).filter(k => {
      try {
        const v = window[k];
        return v && typeof v === 'object' && (
          typeof v.gotoPage === 'function' ||
          typeof v.setPageSize === 'function' ||
          typeof v.nextPage === 'function' ||
          typeof v.goPage === 'function' ||
          typeof v.movePage === 'function'
        );
      } catch(e) { return false; }
    });

    // cl-pageindexer 자식 클릭 가능 요소
    const pagerEl = document.querySelector('[class*=cl-pageindexer]');
    const allChildren = pagerEl ? [...pagerEl.querySelectorAll('*')].map(el => ({
      tag: el.tagName,
      cls: (el.className || '').substring(0,50),
      text: (el.innerText || '').trim().substring(0,10),
      x: Math.round(el.getBoundingClientRect().x),
      y: Math.round(el.getBoundingClientRect().y),
      w: Math.round(el.getBoundingClientRect().width),
    })).slice(0, 30) : [];

    // innerHTML로 pager 구조 파악
    const pagerHtml = pagerEl ? pagerEl.outerHTML.substring(0, 800) : 'not found';

    // 그리드 컨테이너 크기
    const gridBody = document.querySelector('[class*=cl-grid-body], [class*=cl-grid]');
    const gridRect = gridBody ? gridBody.getBoundingClientRect() : null;

    return { windowGrids, allChildren, pagerHtml, gridRect };
  });

  console.log('window 그리드 객체:', info.windowGrids);
  console.log('\npager HTML:', info.pagerHtml.substring(0, 300));
  console.log('\npager 자식들:');
  info.allChildren.forEach(el => console.log(' ', JSON.stringify(el)));
  console.log('\n그리드 rect:', info.gridRect);

  await b.close();
})().catch(e => console.error('ERROR:', e.message));
