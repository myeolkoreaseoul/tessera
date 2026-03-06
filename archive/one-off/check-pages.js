const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.connectOverCDP('http://localhost:9444');
  const context = browser.contexts()[0];
  console.log('Pages:', context.pages().length);
  for (const p of context.pages()) {
    const url = p.url();
    console.log(' ', url.substring(0, 100), '| gosims:', url.includes('gosims'), '| dd001:', url.includes('dd001'));
  }
  const page = context.pages().find(p => p.url().includes('dd001'));
  if (page) {
    const cnt = await page.evaluate(() => {
      const d = window.DD001002QGridData;
      return d ? d.length : 'DD001002QGridData is null/undefined';
    });
    console.log('GridData count:', cnt);
  } else {
    console.log('dd001 page not found');
  }
})();
