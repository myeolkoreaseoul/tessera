import { chromium } from 'playwright';
async function main() {
  const browser = await chromium.connectOverCDP('http://localhost:9444');
  const ctx = browser.contexts()[0];
  const page = ctx.pages().find(p => p.url().includes('gosims'));
  if (!page) { console.log('페이지 없음'); await browser.close(); return; }
  console.log('URL:', page.url().substring(0, 100));

  // 그리드 확인
  const gridInfo = await page.evaluate(() => {
    const grid = (window as any).DD001002QGridObj;
    if (!grid) return 'grid not found';
    const rows = grid.getDataRows();
    const first = rows[0] ? grid.getRowValue(rows[0]) : null;
    return {
      rowCount: rows.length,
      firstRow: first ? { atchmnflId: first.atchmnflId, excutPrposCn: first.excutPrposCn?.substring(0,30) } : null,
    };
  });
  console.log('그리드:', JSON.stringify(gridInfo, null, 2));

  // 첫 번째 행 팝업 시도
  const atchId = await page.evaluate(() => {
    const grid = (window as any).DD001002QGridObj;
    const rows = grid.getDataRows();
    return grid.getRowValue(rows[0]).atchmnflId;
  });
  console.log('atchmnflId:', atchId);

  if (atchId) {
    console.log('팝업 열기 시도...');
    const popupPromise = ctx.waitForEvent('page', { timeout: 15000 });
    await page.evaluate((id: string) => {
      window.open(`/exe/db/db003/getDB003002SView.do?atchmnflId=${id}`, 'popupDB003002S', 'width=700,height=500');
    }, atchId);
    const popup = await popupPromise.catch(() => null);
    if (popup) {
      console.log('팝업 열림:', popup.url());
      await popup.waitForLoadState('domcontentloaded').catch(() => {});
      await popup.waitForTimeout(2000);
      console.log('최종 URL:', popup.url());
      const hasFn = await popup.evaluate(() => typeof (window as any).f_downloadDB003002S === 'function').catch(() => false);
      console.log('다운로드 함수:', hasFn);
      await popup.close().catch(() => {});
    } else {
      console.log('팝업 안 열림');
      // 혹시 새 페이지 체크
      for (const p of ctx.pages()) {
        console.log('  page:', p.url().substring(0, 100));
      }
    }
  }

  // 페이지네이션 확인
  const pageInfo = await page.evaluate(() => {
    const paginationEl = document.querySelector('.paging, .pagination, [class*="page"]');
    const totalText = document.body.innerText.match(/Total\s*[:@]\s*(\d+)/i);
    const pageButtons = document.querySelectorAll('a[onclick*="goPage"], a[onclick*="page"], .page_num a');
    return {
      hasPagination: !!paginationEl,
      paginationClass: paginationEl?.className,
      totalMatch: totalText ? totalText[1] : null,
      pageButtonCount: pageButtons.length,
    };
  });
  console.log('페이지네이션:', JSON.stringify(pageInfo, null, 2));

  await browser.close();
}
main().catch(console.error);
