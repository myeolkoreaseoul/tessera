/**
 * 집행내역 목록에서 순번 1 (첫 번째 건)으로 이동
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
    const t = tabs.find(t => (t.innerText || '').includes('집행내역 목록조회'));
    if (t) t.click();
  });
  await sleep(2000);

  // 2) 그리드에서 순번 정렬 확인하고 첫 번째 데이터 행 찾기
  // 그리드 셀 중 "1"이나 "47차" 텍스트가 있는 행 클릭
  const result = await page.evaluate(() => {
    // 그리드 셀 중 데이터 셀들 찾기 (높이 > 0, 헤더 아닌 것)
    const cells = [...document.querySelectorAll('[class*="cl-grid-cell"]')]
      .filter(el => {
        const r = el.getBoundingClientRect();
        return r.height > 0 && r.height < 50; // 데이터 행 높이
      });

    // 셀 텍스트와 위치 분석
    const cellInfo = cells.slice(0, 50).map(el => ({
      text: (el.innerText || '').trim().substring(0, 40),
      y: Math.round(el.getBoundingClientRect().y),
      x: Math.round(el.getBoundingClientRect().x),
    }));

    // y좌표별 그룹핑 (같은 행의 셀들)
    const rows = {};
    cellInfo.forEach(c => {
      const key = Math.round(c.y / 5) * 5; // 5px 단위로 그룹
      if (!rows[key]) rows[key] = [];
      rows[key].push(c.text);
    });

    // 첫 번째 순번("1"이 있는 행) 또는 "47차" 텍스트가 있는 행
    const yKeys = Object.keys(rows).map(Number).sort((a, b) => a - b);
    let targetY = null;
    for (const y of yKeys) {
      const rowTexts = rows[y];
      if (rowTexts.some(t => t === '1' || t.includes('47차'))) {
        targetY = y;
        break;
      }
    }

    // 없으면 헤더 아래 첫 번째 행
    if (!targetY && yKeys.length > 1) {
      // 헤더 건너뛰기 (보통 첫 1-2 행이 헤더)
      targetY = yKeys.find(y => rows[y].some(t => /^\d+$/.test(t)));
    }

    if (targetY) {
      // 해당 y좌표의 셀 클릭
      const targetCell = cells.find(el => {
        const r = el.getBoundingClientRect();
        return Math.abs(Math.round(r.y / 5) * 5 - targetY) < 3 &&
          (el.innerText || '').trim().length > 5;
      });
      if (targetCell) {
        targetCell.click();
        return { clicked: true, row: rows[targetY], y: targetY };
      }
    }

    return { clicked: false, rows: Object.fromEntries(yKeys.slice(0, 5).map(y => [y, rows[y]])) };
  });

  console.log('그리드 결과:', JSON.stringify(result));
  await sleep(2000);

  // 3) 의견등록 탭 클릭
  console.log('의견등록 탭 클릭...');
  await page.evaluate(() => {
    const tabs = [...document.querySelectorAll('.cl-tabfolder-item')];
    const t = tabs.find(t => (t.innerText || '').includes('의견등록'));
    if (t) t.click();
  });
  await sleep(2000);

  // 4) 현재 건 확인
  const info = await page.evaluate(() => {
    const text = document.body.innerText;
    const m = text.match(/집행목적\(용도\)\n(.+)/);
    return (m?.[1] || '').trim();
  });
  console.log('현재 건:', info);

  await b.close();
})().catch(e => console.error('ERROR:', e.message));
