/**
 * 그리드의 "검토완료"/"미검토" 상태 링크를 클릭해서 해당 건 열기
 * + cpr 프레임워크 API 탐색
 */
const { chromium } = require('playwright');
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

(async () => {
  const b = await chromium.connectOverCDP('http://localhost:9445', { timeout: 10000 });
  const page = b.contexts()[0].pages().find(p => p.url().includes('lss.do'));
  if (!page) { console.error('lss.do 탭 없음'); process.exit(1); }

  // 목록 탭 확인
  await page.evaluate(() => {
    const tabs = [...document.querySelectorAll('.cl-tabfolder-item')];
    const t = tabs.find(t => (t.innerText || '').includes('집행내역 목록'));
    if (t) t.click();
  });
  await sleep(2000);

  // cpr 프레임워크 탐색
  const cprInfo = await page.evaluate(() => {
    const out = [];
    try {
      out.push('cpr keys: ' + Object.keys(cpr).join(', '));

      // cpr.core, cpr.controls 등
      for (const k of Object.keys(cpr)) {
        const v = cpr[k];
        if (typeof v === 'object' && v !== null) {
          out.push(`cpr.${k}: [${Object.keys(v).slice(0,10).join(', ')}]`);
        } else if (typeof v === 'function') {
          out.push(`cpr.${k}: function`);
        }
      }
    } catch(e) { out.push('cpr err: ' + e.message); }

    return out;
  });
  cprInfo.forEach(r => console.log(r));

  // 그리드 첫 행의 "검토완료" 셀 좌표 (y=537 기준)
  // 이전 분석: (1029, 537) = "검토완료"
  console.log('\n"검토완료" 링크 Playwright 클릭 (1029, 537)...');
  await page.mouse.click(1029, 537);
  await sleep(2000);

  // 현재 건 확인
  let info = await page.evaluate(() => {
    const text = document.body.innerText;
    const m = text.match(/집행목적\(용도\)\n(.+)/);
    return (m?.[1] || '').trim();
  });

  // 혹시 의견등록 탭으로 자동 이동했는지 확인
  const tab = await page.evaluate(() => {
    const selected = document.querySelector('.cl-tabfolder-item.cl-selected');
    return (selected?.innerText || '').trim();
  });
  console.log('현재 탭:', tab);

  if (tab.includes('의견등록')) {
    console.log('의견등록 탭으로 이동됨!');
    console.log('현재 건:', info);
    console.log(info.includes('47차') ? '✓ 1번!' : '✗');
  } else {
    // 의견등록 탭으로 수동 이동
    console.log('수동으로 의견등록 탭 이동...');
    await page.evaluate(() => {
      const tabs = [...document.querySelectorAll('.cl-tabfolder-item')];
      const t = tabs.find(t => (t.innerText || '').includes('의견등록'));
      if (t) t.click();
    });
    await sleep(2000);

    info = await page.evaluate(() => {
      const text = document.body.innerText;
      const m = text.match(/집행목적\(용도\)\n(.+)/);
      return (m?.[1] || '').trim();
    });
    console.log('현재 건:', info);
    console.log(info.includes('47차') ? '✓ 1번!' : '✗');
  }

  await page.screenshot({ path: '/tmp/botem-status-click.png' });
  await b.close();
})().catch(e => console.error('ERROR:', e.message));
