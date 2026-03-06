/**
 * 목록 탭으로 이동 → 그리드에서 1번 행 클릭 → 의견등록 탭
 */
const { chromium } = require('playwright');
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

(async () => {
  const b = await chromium.connectOverCDP('http://localhost:9445', { timeout: 10000 });
  const page = b.contexts()[0].pages().find(p => p.url().includes('lss.do'));
  if (!page) { console.error('lss.do 탭 없음'); process.exit(1); }

  // 1) 집행내역 목록조회 탭 클릭
  console.log('1) 목록 탭 클릭...');
  await page.evaluate(() => {
    const tabs = [...document.querySelectorAll('.cl-tabfolder-item')];
    const t = tabs.find(t => (t.innerText || '').includes('집행내역 목록'));
    if (t) t.click();
  });
  await sleep(3000);

  // 스크린샷
  await page.screenshot({ path: '/tmp/botem-nav1.png' });

  // 2) 집행내역 목록 그리드 분석
  console.log('2) 그리드 분석...');
  const gridInfo = await page.evaluate(() => {
    // "집행내역 목록" 아래의 그리드 영역 찾기
    const text = document.body.innerText;
    const hasGrid = text.includes('집행내역 목록 총');

    // 모든 셀 중 "47차" 또는 순번 관련 찾기
    const allDivs = [...document.querySelectorAll('div')];

    // 먼저 그리드 영역을 찾자: "집행내역 목록 총 685 건" 텍스트 아래
    const gridLabel = allDivs.find(el =>
      (el.innerText || '').includes('집행내역 목록 총') && el.childElementCount < 5
    );
    const gridLabelY = gridLabel ? gridLabel.getBoundingClientRect().y : 400;

    // gridLabelY 아래의 데이터 셀들
    const dataCells = allDivs.filter(el => {
      if (el.childElementCount > 0) return false;
      const t = (el.innerText || '').trim();
      const r = el.getBoundingClientRect();
      return t.length > 0 && r.height > 10 && r.height < 40 && r.y > gridLabelY + 30;
    }).map(el => {
      const r = el.getBoundingClientRect();
      return {
        text: (el.innerText || '').trim().substring(0, 50),
        x: Math.round(r.x + r.width / 2),
        y: Math.round(r.y + r.height / 2),
        w: Math.round(r.width),
        h: Math.round(r.height),
      };
    }).slice(0, 30);

    return { hasGrid, gridLabelY: Math.round(gridLabelY), cells: dataCells };
  });

  console.log('그리드 라벨 Y:', gridInfo.gridLabelY);
  console.log('데이터 셀:', gridInfo.cells.length);
  gridInfo.cells.forEach(c =>
    console.log(`  (${c.x},${c.y}) w=${c.w} "${c.text}"`)
  );

  // 3) "검토완료" 또는 "47차" 텍스트가 있는 셀의 같은 행 클릭
  const targetCell = gridInfo.cells.find(c =>
    c.text.includes('47차') || c.text.includes('수도요금')
  );
  // 또는 "검토완료" 링크 (그리드 첫 행의 진행상태)
  const statusCell = gridInfo.cells.find(c => c.text === '검토완료');

  const cellToClick = targetCell || statusCell;
  if (cellToClick) {
    console.log(`\n3) Playwright 클릭: "${cellToClick.text}" at (${cellToClick.x}, ${cellToClick.y})`);
    await page.mouse.click(cellToClick.x, cellToClick.y);
    await sleep(1500);
    await page.mouse.dblclick(cellToClick.x, cellToClick.y);
    await sleep(2000);
  } else {
    // 첫 번째 데이터 행 클릭 (y가 가장 작은 데이터 행)
    const headerCells = gridInfo.cells.filter(c =>
      ['순번', '집행실행일자', '집행방식', '집행목적', '검증검토'].some(kw => c.text.includes(kw))
    );
    const headerY = headerCells.length > 0 ? headerCells[0].y : gridInfo.gridLabelY + 60;

    const dataRows = gridInfo.cells.filter(c => c.y > headerY + 10);
    if (dataRows.length > 0) {
      console.log(`\n3) 첫 데이터 행 클릭: "${dataRows[0].text}" at (${dataRows[0].x}, ${dataRows[0].y})`);
      await page.mouse.click(dataRows[0].x, dataRows[0].y);
      await sleep(1000);
      await page.mouse.dblclick(dataRows[0].x, dataRows[0].y);
      await sleep(2000);
    } else {
      console.log('데이터 행을 찾지 못했습니다');
    }
  }

  // 4) 의견등록 탭
  console.log('4) 의견등록 탭...');
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
  console.log(info.includes('47차') ? '✓ 1번 건!' : '✗ 1번 아님 - ' + info.substring(0, 40));

  await page.screenshot({ path: '/tmp/botem-result.png' });
  await b.close();
})().catch(e => console.error('ERROR:', e.message));
