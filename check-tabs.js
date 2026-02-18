process.on('unhandledRejection', () => {});
const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.connectOverCDP('http://localhost:9444');
  const ctx = browser.contexts()[0];
  const pages = ctx.pages();
  console.log('열린 탭 ' + pages.length + '개:');
  for (let i = 0; i < pages.length; i++) {
    const u = pages[i].url();
    const title = await pages[i].title().catch(() => '?');
    console.log('  [' + i + '] ' + title.substring(0, 40) + ' | ' + u.substring(0, 80));
  }
})();
