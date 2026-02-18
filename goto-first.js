/**
 * 집행내역 목록에서 첫 번째 건 클릭 → 의견등록 탭으로 이동
 */
const { chromium } = require('playwright');
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

(async () => {
  const b = await chromium.connectOverCDP('http://localhost:9445', { timeout: 10000 });
  const page = b.contexts()[0].pages().find(p => p.url().includes('lss.do'));
  if (!page) { console.error('lss.do 탭 없음'); process.exit(1); }

  // 1) 집행내역 목록조회 탭 클릭
  console.log('목록 탭 클릭...');
  await page.evaluate(() => {
    const tabs = [...document.querySelectorAll('.cl-tabfolder-item')];
    const listTab = tabs.find(t => (t.innerText || '').includes('집행내역 목록조회'));
    if (listTab) listTab.click();
  });
  await sleep(2000);

  // 2) 그리드에서 첫 번째 데이터 행 클릭
  console.log('첫 번째 행 클릭...');
  const clicked = await page.evaluate(() => {
    // IBSheet/cl-grid 첫 번째 데이터 행
    const rows = [...document.querySelectorAll('[class*="cl-grid-row"]:not([class*="header"])')].filter(el => {
      const r = el.getBoundingClientRect();
      return r.height > 0 && r.y > 100; // 헤더 아래
    });
    if (rows.length > 0) {
      rows[0].click();
      return (rows[0].innerText || '').substring(0, 80);
    }
    // fallback: 그리드 셀 직접 클릭
    const cells = [...document.querySelectorAll('[class*="cl-grid-cell"]')].filter(el => {
      const t = (el.innerText || '').trim();
      return t.length > 5 && el.getBoundingClientRect().height > 0;
    });
    if (cells.length > 1) {
      cells[1].click(); // 두 번째 셀 (첫 번째는 체크박스일 수 있음)
      return (cells[1].innerText || '').trim();
    }
    return null;
  });
  console.log('클릭:', clicked?.substring(0, 60));
  await sleep(2000);

  // 3) 의견등록 탭 클릭
  console.log('의견등록 탭 클릭...');
  await page.evaluate(() => {
    const tabs = [...document.querySelectorAll('.cl-tabfolder-item')];
    const reviewTab = tabs.find(t => (t.innerText || '').includes('의견등록'));
    if (reviewTab) reviewTab.click();
  });
  await sleep(2000);

  // 4) 현재 건 확인
  const info = await page.evaluate(() => {
    const text = document.body.innerText;
    const m = text.match(/집행목적\(용도\)\n(.+)/);
    return (m?.[1] || '').trim().substring(0, 60);
  });
  console.log('현재 건:', info);

  await page.screenshot({ path: '/tmp/botem-first.png' });
  await b.close();
})().catch(e => console.error('ERROR:', e.message));
