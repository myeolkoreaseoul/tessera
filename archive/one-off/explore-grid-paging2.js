/**
 * 페이징 상세 탐색 + 페이지 크기 변경 방법
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

  // 1. 페이징 NAV 내부 구조
  const pagingNav = await page.evaluate(() => {
    const nav = document.getElementById('DD001002Q_sbGridPaging');
    if (!nav) return 'not found';
    return {
      innerHTML: nav.innerHTML,
      children: Array.from(nav.children).map(c => ({
        tag: c.tagName, text: c.textContent.trim(), class: c.className,
        onclick: c.getAttribute('onclick') || '', href: c.getAttribute('href') || '',
      })),
    };
  });
  console.log('=== 페이징 NAV ===');
  console.log(JSON.stringify(pagingNav, null, 2));

  // 2. 페이지 크기 셀렉트 옵션
  const pageSizeOpts = await page.evaluate(() => {
    const sel = document.getElementById('DD001002Q_nPageSize');
    if (!sel) return 'not found';
    return {
      value: sel.value,
      options: Array.from(sel.options).map(o => o.value + ':' + o.text),
      onchange: sel.getAttribute('onchange') || '',
    };
  });
  console.log('\n=== 페이지 크기 ===');
  console.log(JSON.stringify(pageSizeOpts, null, 2));

  // 3. 검색/조회 관련 함수 (페이지 크기 변경 시 호출될 함수)
  const searchFns = await page.evaluate(() => {
    const result = {};
    const names = ['f_retrieve', 'f_retrieveDD001002Q', 'f_search', 'f_searchDD001002Q',
      'f_sbGridPaging', 'f_pagingCallback', 'f_goPage'];
    for (const n of names) {
      if (typeof window[n] === 'function') result[n] = window[n].toString().substring(0, 500);
    }
    return result;
  });
  console.log('\n=== 조회 함수 ===');
  for (const [k, v] of Object.entries(searchFns)) {
    console.log(`\n--- ${k} ---`);
    console.log(v);
  }

  // 4. 현재 페이지 관련 hidden fields
  const hiddenFields = await page.evaluate(() => {
    const fields = {};
    const ids = ['DD001002Q_nPageNo', 'DD001002Q_nPageSize', 'DD001002Q_nTotalCnt',
      'DD001002Q_pageNo', 'DD001002Q_pageSize'];
    for (const id of ids) {
      const el = document.getElementById(id);
      if (el) fields[id] = { tag: el.tagName, value: el.value };
    }
    return fields;
  });
  console.log('\n=== 히든 필드 ===');
  console.log(JSON.stringify(hiddenFields, null, 2));
}
main().catch(console.error);
