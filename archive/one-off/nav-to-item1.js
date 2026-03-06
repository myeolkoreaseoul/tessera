/**
 * 첨부파일 팝업 닫기 → 목록 탭 → 첫번째 순번 클릭 → 의견등록 탭
 */
const { chromium } = require('playwright');
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

(async () => {
  const b = await chromium.connectOverCDP('http://localhost:9445', { timeout: 10000 });
  const page = b.contexts()[0].pages().find(p => p.url().includes('lss.do'));
  if (!page) { console.error('lss.do 탭 없음'); process.exit(1); }

  // 1) 열려있는 팝업 모두 닫기
  console.log('팝업 닫기...');
  await page.evaluate(() => {
    const dialogs = [...document.querySelectorAll('.cl-dialog')]
      .filter(el => el.getBoundingClientRect().width > 100);
    for (const d of dialogs) {
      const btn = [...d.querySelectorAll('*')]
        .find(el => ['닫기', '×', 'X'].includes((el.innerText || '').trim()) && el.childElementCount === 0);
      if (btn) btn.click();
    }
  });
  await sleep(1000);

  // 2) 집행내역 목록조회 탭 클릭
  console.log('집행내역 목록조회 탭...');
  await page.evaluate(() => {
    const tabs = [...document.querySelectorAll('.cl-tabfolder-item')];
    const t = tabs.find(t => (t.innerText || '').includes('집행내역 목록'));
    if (t) t.click();
  });
  await sleep(2000);

  // 3) 그리드에서 첫 행의 셀 찾기 - cl-grid body 영역에서 "1" 텍스트
  console.log('그리드 첫 행 찾기...');

  // 그리드 DOM 분석 (cl-grid 내부)
  const gridAnalysis = await page.evaluate(() => {
    // body 영역의 모든 div 중 숫자만 있는 셀 찾기 (순번 열)
    const allEls = [...document.querySelectorAll('div')];
    const numberCells = allEls.filter(el => {
      if (el.childElementCount > 0) return false;
      const t = (el.innerText || '').trim();
      const r = el.getBoundingClientRect();
      return /^\d+$/.test(t) && r.height > 10 && r.height < 40 && r.width > 20 && r.width < 80;
    }).map(el => ({
      text: (el.innerText || '').trim(),
      y: Math.round(el.getBoundingClientRect().y),
      x: Math.round(el.getBoundingClientRect().x),
      cls: el.className.substring(0, 50),
    }));

    // 순번 "1"인 셀
    const cell1 = numberCells.find(c => c.text === '1');

    // 모든 순번 셀들 (처음 10개)
    return {
      numbers: numberCells.slice(0, 15),
      cell1,
    };
  });
  console.log('순번 셀들:', JSON.stringify(gridAnalysis.numbers?.slice(0, 10)));
  console.log('순번 1:', JSON.stringify(gridAnalysis.cell1));

  // 순번 "1" 셀 근처의 같은 행 클릭
  if (gridAnalysis.cell1) {
    const targetY = gridAnalysis.cell1.y;
    console.log(`순번 1 행 클릭 (y=${targetY})...`);

    await page.evaluate((y) => {
      // 순번 1과 같은 y좌표의 셀 중 텍스트가 긴 것 클릭 (집행목적 등)
      const cells = [...document.querySelectorAll('div')].filter(el => {
        if (el.childElementCount > 0) return false;
        const r = el.getBoundingClientRect();
        const t = (el.innerText || '').trim();
        return Math.abs(r.y - y) < 5 && r.height > 10 && t.length > 5;
      });
      if (cells.length > 0) {
        cells[0].click();
        return true;
      }
      // fallback: 순번 1 셀 자체 클릭
      const numCell = [...document.querySelectorAll('div')].find(el => {
        if (el.childElementCount > 0) return false;
        return (el.innerText || '').trim() === '1' &&
          Math.abs(el.getBoundingClientRect().y - y) < 5;
      });
      if (numCell) numCell.click();
    }, targetY);
    await sleep(2000);
  } else {
    console.log('순번 1을 찾지 못함 — 스크롤 필요할 수 있음');
    // 그리드를 맨 위로 스크롤
    await page.evaluate(() => {
      const grids = [...document.querySelectorAll('[class*="cl-grid-body"]')];
      grids.forEach(g => g.scrollTop = 0);
    });
    await sleep(1000);
  }

  // 4) 의견등록 탭
  console.log('의견등록 탭...');
  await page.evaluate(() => {
    const tabs = [...document.querySelectorAll('.cl-tabfolder-item')];
    const t = tabs.find(t => (t.innerText || '').includes('의견등록'));
    if (t) t.click();
  });
  await sleep(2000);

  // 5) 확인
  const info = await page.evaluate(() => {
    const text = document.body.innerText;
    const m = text.match(/집행목적\(용도\)\n(.+)/);
    return (m?.[1] || '').trim();
  });
  console.log('현재 건:', info);

  const isFirst = info.includes('47차') && info.includes('수도요금');
  console.log(isFirst ? '✓ 첫 번째 건 도달' : '✗ 첫 번째 건 아님');

  await b.close();
})().catch(e => console.error('ERROR:', e.message));
