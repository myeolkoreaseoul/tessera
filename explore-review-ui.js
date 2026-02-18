/**
 * e나라도움 세부내역검토 UI 탐색
 * - 그리드에서 행 클릭 → 상세보기 팝업/화면 구조 파악
 */
const { chromium } = require('playwright');

process.on('unhandledRejection', (err) => {
  if (err && err.message && err.message.includes('No dialog is showing')) return;
  console.error('Unhandled:', err.message);
});

async function main() {
  const browser = await chromium.connectOverCDP('http://localhost:9444');
  const context = browser.contexts()[0];

  // 팝업 정리
  for (const p of context.pages()) {
    if (p.url().includes('getDB003002SView')) await p.close().catch(() => {});
  }
  await new Promise(r => setTimeout(r, 500));

  const page = context.pages().find(p => p.url().includes('dd001'));
  if (!page) { console.log('dd001 페이지 없음'); return; }
  console.log('페이지:', page.url().substring(0, 80));

  // 1. 현재 페이지에 검토 관련 버튼/기능 확인
  const buttons = await page.evaluate(() => {
    const btns = document.querySelectorAll('button, a.btn, input[type="button"]');
    return Array.from(btns).map(b => ({
      text: (b.textContent || b.value || '').trim().substring(0, 30),
      id: b.id,
      onclick: (b.getAttribute('onclick') || '').substring(0, 80),
      class: b.className.substring(0, 50),
    })).filter(b => b.text || b.onclick);
  });
  console.log('\n=== 버튼 목록 ===');
  buttons.forEach(b => console.log(`  [${b.text}] id=${b.id} onclick=${b.onclick}`));

  // 2. 검토 관련 함수 확인
  const reviewFns = await page.evaluate(() => {
    return Object.keys(window).filter(k => {
      const lower = k.toLowerCase();
      return (lower.includes('review') || lower.includes('exmnt') || lower.includes('vrify') ||
              lower.includes('nrcgn') || lower.includes('save') || lower.includes('compl') ||
              k.includes('DD001') || lower.includes('detail'));
    }).sort();
  });
  console.log('\n=== 검토 관련 함수 ===');
  reviewFns.forEach(f => console.log('  ' + f));

  // 3. 그리드 행 클릭 이벤트 확인
  const gridEvents = await page.evaluate(() => {
    const grid = window.DD001002QGridObj;
    if (!grid) return 'grid not found';
    // 이벤트 핸들러 확인
    const handlers = {};
    for (const key of Object.keys(grid)) {
      if (typeof grid[key] === 'function' && (key.includes('click') || key.includes('Click') || key.includes('select') || key.includes('Select') || key.includes('dbl') || key.includes('Dbl'))) {
        handlers[key] = grid[key].toString().substring(0, 100);
      }
    }
    return handlers;
  });
  console.log('\n=== 그리드 이벤트 ===');
  console.log(JSON.stringify(gridEvents, null, 2));

  // 4. DD001002Q 관련 전역 함수들
  const ddFns = await page.evaluate(() => {
    return Object.keys(window).filter(k => k.includes('DD001002') || k.includes('dd001002')).sort();
  });
  console.log('\n=== DD001002 관련 ===');
  ddFns.forEach(f => console.log('  ' + f + ': ' + typeof window[f]));

  // 5. 프레임/iframe 확인
  const frames = await page.evaluate(() => {
    const iframes = document.querySelectorAll('iframe');
    return Array.from(iframes).map(f => ({ id: f.id, src: (f.src || '').substring(0, 80), name: f.name }));
  });
  console.log('\n=== iframe ===');
  frames.forEach(f => console.log('  ' + JSON.stringify(f)));
}

main().catch(console.error);
