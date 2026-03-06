/**
 * 목록 그리드 재조회 + R25/R31 찾기
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

  // 1. 현재 페이지 상태
  console.log('URL:', page.url());

  // 2. 조회 관련 함수/버튼 확인
  const queryInfo = await page.evaluate(() => {
    const result = {};
    // 조회 버튼
    const btns = document.querySelectorAll('button, input[type="button"]');
    btns.forEach(b => {
      const text = (b.textContent || b.value || '').trim();
      if (text.includes('조회') || text.includes('검색')) {
        result[text] = { id: b.id, onclick: b.getAttribute('onclick') || '' };
      }
    });
    // f_retrieve 함수
    const fns = ['f_retrieve', 'f_retrieveListBsnsExcutDetl', 'f_search',
      'f_retrieveDD001002Q', 'f_inquire'];
    for (const fn of fns) {
      if (typeof window[fn] === 'function') result[fn] = 'exists';
    }
    // 검색 조건 필드
    const fields = {};
    const ids = ['DD001002Q_excutPrposCn', 'DD001002Q_bcncCmpnyNm',
      'DD001002Q_exmntPrgstCode', 'DD001002Q_excutAmountFrom', 'DD001002Q_excutAmountTo'];
    for (const id of ids) {
      const el = document.getElementById(id);
      if (el) fields[id] = el.value;
    }
    result.fields = fields;
    return result;
  });
  console.log('\n조회 정보:', JSON.stringify(queryInfo, null, 2));

  // 3. 조회 실행 (f_retrieveListBsnsExcutDetl(1) 호출)
  console.log('\n조회 실행...');
  await page.evaluate(() => {
    if (typeof f_retrieveListBsnsExcutDetl === 'function') {
      f_retrieveListBsnsExcutDetl(1);
    }
  });
  await new Promise(r => setTimeout(r, 3000));
  await page.evaluate(() => {
    document.querySelectorAll('.popupMask.on .fn.ok').forEach(b => b.click());
  });
  await new Promise(r => setTimeout(r, 500));

  // 결과 확인
  const rows = await page.evaluate(() => {
    if (typeof DD001002QGridObj === 'undefined') return [];
    const grid = DD001002QGridObj;
    const dataRows = grid.getDataRows();
    return dataRows.map((r, i) => {
      const rv = grid.getRowValue(r);
      return {
        idx: i,
        purpose: rv.excutPrposCn,
        amount: rv.excutAmount || rv.excutSumAmount,
        status: rv.exmntPrgstNm || rv.exmntPrgstCode || '',
      };
    });
  });
  console.log(`\n조회 결과: ${rows.length}행`);
  rows.forEach(d => {
    console.log(`  [${d.idx}] ${d.purpose} | ${d.amount}원 | ${d.status}`);
  });

  // 페이징
  const paging = await page.evaluate(() => {
    const nav = document.getElementById('DD001002Q_sbGridPaging');
    return nav ? nav.textContent.trim() : 'not found';
  });
  console.log('\n페이징:', paging);
}
main().catch(console.error);
