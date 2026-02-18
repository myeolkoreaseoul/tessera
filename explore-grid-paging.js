/**
 * 목록 그리드 페이지네이션 구조 확인
 */
const { chromium } = require('playwright');
process.on('unhandledRejection', (err) => {
  if (err && err.message && err.message.includes('No dialog is showing')) return;
});
async function main() {
  const browser = await chromium.connectOverCDP('http://localhost:9444');
  const context = browser.contexts()[0];
  let page = context.pages().find(p => p.url().includes('dd001'));
  if (!page) { console.log('페이지 없음'); return; }
  page.on('dialog', async d => { try { await d.accept(); } catch {} });

  // 목록 페이지인지 확인
  const url = page.url();
  console.log('URL:', url);
  if (url.includes('DD001003S')) {
    console.log('상세 페이지임 → 목록으로 돌아가기');
    await page.evaluate(() => f_prevPage());
    await new Promise(r => setTimeout(r, 3000));
  }

  // 1. DD001002QGridData 총 건수
  const dataCount = await page.evaluate(() => {
    return typeof DD001002QGridData !== 'undefined' ? DD001002QGridData.length : 'not found';
  });
  console.log('DD001002QGridData.length:', dataCount);

  // 2. getDataRows() 건수
  const rowCount = await page.evaluate(() => {
    return DD001002QGridObj.getDataRows().length;
  });
  console.log('getDataRows().length:', rowCount);

  // 3. 페이지네이션 UI 확인
  const pagingInfo = await page.evaluate(() => {
    // 페이징 관련 요소
    const pagingBtns = document.querySelectorAll('[id*="paging"], [id*="Paging"], [class*="paging"], [class*="Paging"]');
    const result = [];
    pagingBtns.forEach(el => result.push({ tag: el.tagName, id: el.id, class: el.className.substring(0, 50), text: el.textContent.trim().substring(0, 20) }));

    // SBGrid 페이지 관련
    const grid = DD001002QGridObj;
    const pageInfo = {};
    const methods = ['getPage', 'getPageCount', 'getPageSize', 'getTotalRowCount', 'getRowCount'];
    for (const m of methods) {
      if (typeof grid[m] === 'function') {
        try { pageInfo[m] = grid[m](); } catch (e) { pageInfo[m] = 'error: ' + e.message; }
      }
    }

    // IBSheet 페이지 설정
    pageInfo.PageCount = grid.PageCount;
    pageInfo.PageSize = grid.PageSize;
    pageInfo.CurPage = grid.CurPage;
    pageInfo.TotalCount = grid.TotalCount;

    return { pagingElements: result, pageInfo };
  });
  console.log('\n페이징 UI:', JSON.stringify(pagingInfo.pagingElements, null, 2));
  console.log('\n그리드 페이지 정보:', JSON.stringify(pagingInfo.pageInfo, null, 2));

  // 4. 그리드 행 크기/스크롤 설정
  const scrollInfo = await page.evaluate(() => {
    const grid = DD001002QGridObj;
    return {
      RowCount: grid.RowCount,
      MaxRowCount: grid.MaxRowCount,
      PageSize: grid.PageSize,
      Cfg: grid.Cfg ? { PageLength: grid.Cfg.PageLength, MaxPages: grid.Cfg.MaxPages } : null,
    };
  });
  console.log('\n스크롤/행 설정:', JSON.stringify(scrollInfo, null, 2));

  // 5. DD001002QGridData로 직접 selectRow 가능한지 확인
  const directSelect = await page.evaluate(() => {
    const grid = DD001002QGridObj;
    const allRows = grid.getDataRows();
    // 마지막 행 정보
    const lastIdx = allRows.length - 1;
    const lastRow = allRows[lastIdx];
    const lastVal = grid.getRowValue(lastRow);
    return {
      totalVisibleRows: allRows.length,
      lastRowPurpose: lastVal.excutPrposCn,
      lastRowAmount: lastVal.excutAmount || lastVal.excutSumAmount,
    };
  });
  console.log('\n마지막 표시 행:', JSON.stringify(directSelect, null, 2));

  // 6. 페이지 넘기기 방법 탐색
  const pageFns = await page.evaluate(() => {
    const result = {};
    const names = ['f_pageNext', 'f_pagePrev', 'f_movePage', 'f_goPage',
      'f_retrieveDD001002Q', 'f_retrieve', 'f_search'];
    for (const n of names) {
      if (typeof window[n] === 'function') result[n] = window[n].toString().substring(0, 300);
    }

    // 페이지 관련 버튼/셀렉트
    const pageSelect = document.querySelector('#DD001002Q_pageSel, [id*="pageSize"], [id*="PageSize"]');
    if (pageSelect) result.pageSelect = { id: pageSelect.id, value: pageSelect.value };

    return result;
  });
  console.log('\n페이지 함수:', JSON.stringify(pageFns, null, 2));
}
main().catch(console.error);
