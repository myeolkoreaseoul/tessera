/**
 * 페이지 구조 분석 - 조회 건수 설정, 페이지네이션, 그리드 행 수
 */
import { chromium } from 'playwright';
async function main() {
  const browser = await chromium.connectOverCDP('http://localhost:9444');
  const ctx = browser.contexts()[0];
  const page = ctx.pages().find(p => p.url().includes('gosims'));
  if (!page) { console.log('페이지 없음'); await browser.close(); return; }
  console.log('URL:', page.url().substring(0, 100));

  // 1. 그리드 행 수
  const gridCount = await page.evaluate(() => {
    const grid = (window as any).DD001002QGridObj;
    return grid ? grid.getDataRows().length : 0;
  });
  console.log('그리드 행:', gridCount);

  // 2. 모든 select 요소 (조회 건수 변경용)
  const selects = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('select')).map(sel => ({
      id: sel.id, name: sel.name,
      options: Array.from(sel.options).map(o => ({ value: o.value, text: o.text, selected: o.selected })),
      parentText: sel.parentElement?.textContent?.trim().substring(0, 50),
    }));
  });
  console.log('\nSelect 요소:');
  for (const s of selects) {
    console.log(`  ${s.id || s.name}: ${s.options.map(o => `${o.value}(${o.text})${o.selected ? '*' : ''}`).join(', ')}`);
    if (s.parentText) console.log(`    부모: ${s.parentText}`);
  }

  // 3. 페이지네이션 영역
  const paging = await page.evaluate(() => {
    const candidates = document.querySelectorAll('.page, .paging, [class*="page"], [class*="paging"]');
    return Array.from(candidates).map(el => ({
      tag: el.tagName, class: el.className,
      text: el.textContent?.trim().substring(0, 100),
      childLinks: el.querySelectorAll('a').length,
    }));
  });
  console.log('\n페이지네이션:');
  for (const p of paging) {
    console.log(`  <${p.tag} class="${p.class}"> links=${p.childLinks} text="${p.text}"`);
  }

  // 4. Total 텍스트
  const totalText = await page.evaluate(() => {
    const text = document.body.innerText;
    const m1 = text.match(/Total\s*[:@]?\s*(\d+)/i);
    const m2 = text.match(/(\d+)\s*건/);
    return { total: m1?.[0], 건: m2?.[0] };
  });
  console.log('\nTotal:', totalText);

  // 5. 페이지 관련 전역 함수
  const fns = await page.evaluate(() => {
    return Object.keys(window).filter(k =>
      typeof (window as any)[k] === 'function' &&
      (k.includes('page') || k.includes('Page') || k.includes('search') || k.includes('Search') || k.includes('f_select') || k.includes('f_search'))
    );
  });
  console.log('\n페이지/검색 함수:', fns);

  await browser.close();
}
main().catch(console.error);
