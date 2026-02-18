const { sleep, connectBrowser, findEnaraPage, dismissModals } = require('../lib/utils');

(async () => {
  const { context } = await connectBrowser();
  const page = await findEnaraPage(context);
  console.log('URL:', page.url());

  // Find all IBSheet grid objects
  const grids = await page.evaluate(() => {
    const found = [];
    for (const key of Object.keys(window)) {
      if (key.includes('Grid') || key.includes('grid') || key.includes('Sheet')) {
        try {
          const obj = window[key];
          if (obj && typeof obj.getDataRows === 'function') {
            found.push({ name: key, rows: obj.getDataRows().length });
          }
        } catch(e) {}
      }
    }
    return found;
  });
  console.log('Grid objects:', JSON.stringify(grids));

  // Check all buttons
  const btns = await page.evaluate(() => {
    return [...document.querySelectorAll('button')].filter(b => b.offsetWidth > 0)
      .map(b => ({ id: b.id, text: b.textContent.trim().substring(0, 30) }));
  });
  console.log('Buttons:', JSON.stringify(btns.slice(0, 20)));

  // Check radio buttons
  const radios = await page.evaluate(() => {
    return [...document.querySelectorAll('input[type=radio]')].map(r => ({
      id: r.id, name: r.name, checked: r.checked, value: r.value
    }));
  });
  console.log('Radios:', JSON.stringify(radios));

  process.exit(0);
})();
