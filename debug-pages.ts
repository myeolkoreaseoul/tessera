import { chromium } from 'playwright';
async function main() {
  const browser = await chromium.connectOverCDP('http://localhost:9444');
  console.log('contexts:', browser.contexts().length);
  for (const ctx of browser.contexts()) {
    console.log('pages:', ctx.pages().length);
    for (const p of ctx.pages()) {
      const url = p.url();
      console.log(`  url: ${url}`);
      console.log(`  includes DD001002Q: ${url.includes('getDD001002QView')}`);
      console.log(`  includes DD001: ${url.includes('DD001')}`);
      console.log(`  includes gosims: ${url.includes('gosims')}`);
    }
  }
  await browser.close();
}
main().catch(console.error);
