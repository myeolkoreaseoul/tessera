/**
 * 현재 목록 그리드 상태 확인
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
  await page.evaluate(() => {
    document.querySelectorAll('.popupMask.on .fn.ok').forEach(b => b.click());
  });
  await new Promise(r => setTimeout(r, 500));

  console.log('URL:', page.url());

  // 상세 페이지면 복귀
  if (page.url().includes('DD001003S')) {
    await page.evaluate(() => f_prevPage()).catch(() => {});
    await new Promise(r => setTimeout(r, 3000));
    await page.evaluate(() => {
      document.querySelectorAll('.popupMask.on .fn.ok').forEach(b => b.click());
    });
  }

  // 그리드 상태
  const state = await page.evaluate(() => {
    const grid = DD001002QGridObj;
    const rows = grid.getDataRows();
    const data = rows.map((r, i) => {
      const rv = grid.getRowValue(r);
      return {
        idx: i,
        purpose: rv.excutPrposCn,
        amount: rv.excutAmount || rv.excutSumAmount,
        status: rv.exmntPrgstNm || rv.exmntPrgstCode || '',
      };
    });
    return { rowCount: rows.length, data };
  });

  console.log(`그리드 행수: ${state.rowCount}`);
  state.data.forEach(d => {
    console.log(`  [${d.idx}] ${d.purpose} | ${d.amount}원 | 상태: ${d.status}`);
  });

  // 페이징 상태
  const paging = await page.evaluate(() => {
    const nav = document.getElementById('DD001002Q_sbGridPaging');
    return nav ? nav.innerHTML : 'not found';
  });
  console.log('\n페이징:', paging);

  // 검토진행상태 필터
  const filter = await page.evaluate(() => {
    const sel = document.querySelector('#DD001002Q_exmntPrgstCode, [name="exmntPrgstCode"]');
    if (sel) return { id: sel.id, value: sel.value, text: sel.options?.[sel.selectedIndex]?.text || '' };
    // hidden field도 확인
    const hid = document.getElementById('DD001002Q_pExmntPrgst');
    if (hid) return { id: hid.id, value: hid.value };
    return 'not found';
  });
  console.log('\n검토상태 필터:', JSON.stringify(filter));

  // 총건수
  const totalCnt = await page.evaluate(() => {
    const el = document.getElementById('DD001002Q_nTotalCnt');
    return el ? el.value || el.textContent : 'not found';
  });
  console.log('총건수:', totalCnt);
}
main().catch(console.error);
