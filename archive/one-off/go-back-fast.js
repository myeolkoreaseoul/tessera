/**
 * "이전 집행정보 보기" 빠르게 반복 (500ms 간격)
 * 첫 번째 건까지 자동 이동
 */
const { chromium } = require('playwright');
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

(async () => {
  const b = await chromium.connectOverCDP('http://localhost:9445', { timeout: 10000 });
  const page = b.contexts()[0].pages().find(p => p.url().includes('lss.do'));
  if (!page) { console.error('lss.do 탭 없음'); process.exit(1); }

  let count = 0;
  const maxSteps = 700;

  for (let i = 0; i < maxSteps; i++) {
    const moved = await page.evaluate(() => {
      const btns = [...document.querySelectorAll('*')].filter(el =>
        (el.innerText || '').trim() === '이전 집행정보 보기' &&
        el.getBoundingClientRect().width > 0 && el.childElementCount === 0
      );
      if (btns.length > 0) { btns[0].click(); return true; }
      return false;
    });
    if (!moved) {
      console.log(`\n${count}번째에서 멈춤 (첫 번째 건 도달)`);
      break;
    }
    count++;
    if (count % 50 === 0) process.stdout.write(`${count}..`);
    await sleep(500);
  }

  await sleep(500);
  const info = await page.evaluate(() => {
    const text = document.body.innerText;
    const m = text.match(/집행목적\(용도\)\n(.+)/);
    return (m?.[1] || '').trim();
  });
  console.log(`\n현재 건: ${info}`);
  console.log(`총 ${count}번 이동`);

  await b.close();
})().catch(e => console.error('ERROR:', e.message));
