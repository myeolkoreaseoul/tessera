/**
 * 그리드에서 "47차_창업스테이션" 텍스트가 있는 셀을 Playwright 네이티브 클릭
 */
const { chromium } = require('playwright');
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

(async () => {
  const b = await chromium.connectOverCDP('http://localhost:9445', { timeout: 10000 });
  const page = b.contexts()[0].pages().find(p => p.url().includes('lss.do'));
  if (!page) { console.error('lss.do 탭 없음'); process.exit(1); }

  // 집행내역 목록조회 탭이 활성화되어 있다고 가정
  // 그리드에서 순번 1행의 집행목적 셀 찾기
  const cells = await page.evaluate(() => {
    const allDivs = [...document.querySelectorAll('div')];
    return allDivs.filter(el => {
      const t = (el.innerText || '').trim();
      const r = el.getBoundingClientRect();
      return t.includes('47차') && t.includes('수도요금') &&
        r.height > 0 && r.height < 50 && r.y > 400;
    }).map(el => {
      const r = el.getBoundingClientRect();
      return {
        text: (el.innerText || '').trim().substring(0, 60),
        x: Math.round(r.x + r.width / 2),
        y: Math.round(r.y + r.height / 2),
        tag: el.tagName,
        cls: el.className.substring(0, 40),
        childCount: el.childElementCount,
      };
    });
  });

  console.log('후보 셀:', cells.length);
  cells.forEach(c => console.log(`  ${c.text} at (${c.x},${c.y}) cls:${c.cls} children:${c.childCount}`));

  // 가장 하위(leaf) 셀 클릭
  const leaf = cells.find(c => c.childCount === 0) || cells[0];
  if (leaf) {
    console.log(`\n클릭: "${leaf.text}" at (${leaf.x}, ${leaf.y})`);
    await page.mouse.click(leaf.x, leaf.y);
    await sleep(1500);

    // 더블클릭
    console.log('더블클릭...');
    await page.mouse.dblclick(leaf.x, leaf.y);
    await sleep(2000);
  }

  // 의견등록 탭으로
  console.log('의견등록 탭...');
  await page.evaluate(() => {
    const tabs = [...document.querySelectorAll('.cl-tabfolder-item')];
    const t = tabs.find(t => (t.innerText || '').includes('의견등록'));
    if (t) t.click();
  });
  await sleep(2000);

  const info = await page.evaluate(() => {
    const text = document.body.innerText;
    const m = text.match(/집행목적\(용도\)\n(.+)/);
    return (m?.[1] || '').trim();
  });
  console.log('현재 건:', info);
  console.log(info.includes('47차') ? '✓ 1번!' : '✗ 1번 아님');

  await b.close();
})().catch(e => console.error('ERROR:', e.message));
