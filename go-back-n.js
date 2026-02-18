/**
 * "이전 집행정보 보기" N번 클릭해서 뒤로 이동
 * Usage: node go-back-n.js --count=54
 */
const { chromium } = require('playwright');
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
const COUNT = parseInt((process.argv.find(a => a.startsWith('--count=')) || '--count=10').split('=')[1]);

(async () => {
  const b = await chromium.connectOverCDP('http://localhost:9445', { timeout: 10000 });
  const page = b.contexts()[0].pages().find(p => p.url().includes('lss.do'));
  if (!page) { console.error('lss.do 탭 없음'); process.exit(1); }

  for (let i = 0; i < COUNT; i++) {
    const moved = await page.evaluate(() => {
      const btns = [...document.querySelectorAll('*')].filter(el =>
        (el.innerText || '').trim() === '이전 집행정보 보기' &&
        el.getBoundingClientRect().width > 0 && el.childElementCount === 0
      );
      if (btns.length > 0) { btns[0].click(); return true; }
      return false;
    });
    if (!moved) { console.log(`${i}번째에서 멈춤 (첫 번째 건)`); break; }
    if ((i + 1) % 10 === 0) process.stdout.write(`${i + 1}..`);
    await sleep(1000);
  }

  console.log('\n이동 완료');
  await sleep(500);

  const info = await page.evaluate(() => {
    const text = document.body.innerText;
    const m = text.match(/집행목적\(용도\)\n(.+)/);
    return (m?.[1] || '').trim();
  });
  console.log('현재 건:', info);

  await b.close();
})().catch(e => console.error('ERROR:', e.message));
