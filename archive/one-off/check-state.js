const { chromium } = require('playwright');
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

(async () => {
  const b = await chromium.connectOverCDP('http://100.87.3.123:9445', { timeout: 10000 });
  const page = b.contexts()[0].pages().find(p => p.url().includes('lss.do'));
  if (!page) { console.error('lss.do 탭 없음'); process.exit(1); }
  console.log('보탬e 연결 OK');

  await page.screenshot({ path: '/tmp/botem-state.png', fullPage: false });
  console.log('스크린샷: /tmp/botem-state.png');

  const texts = await page.evaluate(() => {
    return [...document.querySelectorAll('.cl-text')].filter(el => {
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.y >= 0 && r.y < 800;
    }).map(el => ({
      text: (el.innerText || '').trim().substring(0, 50),
      x: Math.round(el.getBoundingClientRect().x),
      y: Math.round(el.getBoundingClientRect().y),
      w: Math.round(el.getBoundingClientRect().width)
    })).filter(t => t.text.length > 0).sort((a, b) => a.y - b.y || a.x - b.x).slice(0, 40);
  });

  console.log('\n=== 주요 텍스트 (y 순서) ===');
  texts.forEach(t => console.log(`  (${t.x},${t.y}) w=${t.w} "${t.text}"`));

  await b.close();
})().catch(e => console.error('ERROR:', e.message));
