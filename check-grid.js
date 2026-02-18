const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.connectOverCDP('http://localhost:9444');
  const context = browser.contexts()[0];
  // 팝업 닫기
  for (const p of context.pages()) {
    if (p.url().includes('getDB003002SView')) await p.close().catch(() => {});
  }
  await new Promise(r => setTimeout(r, 500));
  const page = context.pages().find(p => p.url().includes('dd001'));
  if (!page) { console.log('dd001 페이지 없음'); return; }
  console.log('URL:', page.url());

  // SBGrid 인스턴스 찾기
  const info = await page.evaluate(() => {
    const gridKeys = Object.keys(window).filter(k => {
      try {
        const obj = window[k];
        return obj && typeof obj === 'object' && (typeof obj.getRowCount === 'function' || typeof obj.getValue === 'function' || typeof obj.getRowData === 'function');
      } catch { return false; }
    });
    // DD로 시작하는 변수들
    const ddKeys = Object.keys(window).filter(k => k.startsWith('DD') || k.startsWith('dd'));
    // SBGrid 전역 확인
    let sbGridInfo = null;
    if (window.SBGrid) {
      sbGridInfo = Object.keys(window.SBGrid).filter(k => typeof window.SBGrid[k] === 'function').slice(0, 20);
    }
    // datagrid 등
    const allObjs = Object.keys(window).filter(k => {
      try {
        const obj = window[k];
        return obj && typeof obj === 'object' && !Array.isArray(obj) &&
          Object.keys(obj).length > 5 && Object.keys(obj).length < 200 &&
          (typeof obj.getRowCount === 'function' || typeof obj.getRow === 'function' || typeof obj.getData === 'function');
      } catch { return false; }
    });
    return { gridKeys, ddKeys, sbGridInfo, allObjs };
  });
  console.log(JSON.stringify(info, null, 2));

  // SBGrid.getGridAll 시도
  const grids = await page.evaluate(() => {
    if (window.SBGrid && typeof SBGrid.getGridAll === 'function') {
      return SBGrid.getGridAll();
    }
    return null;
  });
  console.log('SBGrid.getGridAll:', grids);

  // createSBDataGrid로 만들어진 그리드 ID 찾기
  const gridIds = await page.evaluate(() => {
    // SBGrid는 보통 div id로 찾음
    const divs = document.querySelectorAll('[id*="grid"], [id*="Grid"], [id*="GRID"]');
    return Array.from(divs).map(d => d.id).slice(0, 10);
  });
  console.log('Grid divs:', gridIds);
})();
