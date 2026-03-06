const { chromium } = require('playwright');
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

(async () => {
  const b = await chromium.connectOverCDP('http://100.87.3.123:9445', { timeout: 10000 });
  const page = b.contexts()[0].pages().find(p => p.url().includes('lss.do'));
  if (!page) { console.error('lss.do 탭 없음'); process.exit(1); }

  const info = await page.evaluate(() => {
    const text = document.body.innerText;
    const m = text.match(/집행목적\(용도\)\n(.+)/);
    return (m && m[1]) ? m[1].trim() : '';
  });
  console.log('현재 건:', info);

  const ids = await page.evaluate(() => {
    const combos = [...document.querySelectorAll('[class*="cl-combobox"]')].map(el => ({
      id: el.id, value: el.querySelector('input')?.value || '',
    }));
    const textareas = [...document.querySelectorAll('[class*="cl-textarea"]')].map(el => ({
      id: el.id, value: (el.querySelector('textarea')?.value || '').substring(0, 50),
    }));
    return { combos, textareas };
  });
  console.log('combobox:', JSON.stringify(ids.combos));
  console.log('textarea:', JSON.stringify(ids.textareas));

  await page.screenshot({ path: '/tmp/botem-ids-check.png' });
  await b.close();
})().catch(e => console.error('ERROR:', e.message));
