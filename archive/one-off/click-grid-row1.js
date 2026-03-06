/**
 * 집행내역 목록조회 탭 → 그리드에서 순번 1번 행을 Playwright 네이티브 클릭
 * (evaluate 클릭은 cl-grid 이벤트가 안 됨 → Playwright click() 사용)
 */
const { chromium } = require('playwright');
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

(async () => {
  const b = await chromium.connectOverCDP('http://localhost:9445', { timeout: 10000 });
  const page = b.contexts()[0].pages().find(p => p.url().includes('lss.do'));
  if (!page) { console.error('lss.do 탭 없음'); process.exit(1); }

  // 1) 집행내역 목록조회 탭 클릭
  console.log('집행내역 목록조회 탭 클릭...');
  await page.evaluate(() => {
    const tabs = [...document.querySelectorAll('.cl-tabfolder-item')];
    const t = tabs.find(t => (t.innerText || '').includes('집행내역 목록'));
    if (t) t.click();
  });
  await sleep(2000);

  // 스크린샷으로 확인
  await page.screenshot({ path: '/tmp/botem-grid.png' });
  console.log('스크린샷: /tmp/botem-grid.png');

  // 2) 그리드에서 순번 "1" 셀 위치 찾기
  const cellInfo = await page.evaluate(() => {
    const allDivs = [...document.querySelectorAll('div')];
    // 순번 1인 셀 찾기 (높이 20-40px, 너비 30-80px, 텍스트 "1")
    const candidates = allDivs.filter(el => {
      if (el.childElementCount > 0) return false;
      const t = (el.innerText || '').trim();
      const r = el.getBoundingClientRect();
      return t === '1' && r.height > 15 && r.height < 45 && r.width > 20 && r.width < 100 &&
        r.y > 400; // 상단 헤더 영역 아래
    });

    if (candidates.length === 0) return null;

    // 가장 적합한 것 (그리드 영역 내)
    const cell = candidates[0];
    const r = cell.getBoundingClientRect();
    return {
      x: Math.round(r.x + r.width / 2),
      y: Math.round(r.y + r.height / 2),
      text: cell.innerText.trim(),
      cls: cell.className,
      parentCls: cell.parentElement?.className?.substring(0, 50) || '',
    };
  });

  console.log('순번 1 셀:', JSON.stringify(cellInfo));

  if (!cellInfo) {
    console.log('순번 1 셀을 찾지 못했습니다. 그리드 스크롤 시도...');
    // 그리드 body를 맨 위로 스크롤
    await page.evaluate(() => {
      document.querySelectorAll('[class*="cl-grid-body"]').forEach(el => {
        el.scrollTop = 0;
      });
    });
    await sleep(1000);
    await page.screenshot({ path: '/tmp/botem-grid2.png' });
    console.log('스크롤 후 스크린샷: /tmp/botem-grid2.png');
    await b.close();
    return;
  }

  // 3) Playwright 네이티브 클릭 (좌표 기반) — evaluate가 아닌 실제 마우스 클릭
  console.log(`Playwright 클릭: (${cellInfo.x}, ${cellInfo.y})`);
  await page.mouse.click(cellInfo.x, cellInfo.y);
  await sleep(1000);

  // 더블클릭도 시도 (그리드에서 행 선택은 더블클릭일 수 있음)
  console.log('더블클릭 시도...');
  await page.mouse.dblclick(cellInfo.x, cellInfo.y);
  await sleep(2000);

  // 4) 의견등록 탭으로 이동
  console.log('의견등록 탭 클릭...');
  await page.evaluate(() => {
    const tabs = [...document.querySelectorAll('.cl-tabfolder-item')];
    const t = tabs.find(t => (t.innerText || '').includes('의견등록'));
    if (t) t.click();
  });
  await sleep(2000);

  // 5) 현재 건 확인
  const info = await page.evaluate(() => {
    const text = document.body.innerText;
    const m = text.match(/집행목적\(용도\)\n(.+)/);
    return (m?.[1] || '').trim();
  });
  console.log('현재 건:', info);

  const isFirst = info.includes('47차') && info.includes('수도요금');
  console.log(isFirst ? '✓ 1번 건 도달!' : '✗ 1번 아님');

  await page.screenshot({ path: '/tmp/botem-item1.png' });
  await b.close();
})().catch(e => console.error('ERROR:', e.message));
