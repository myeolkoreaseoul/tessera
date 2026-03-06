const { chromium } = require('playwright');
(async () => {
  const b = await chromium.connectOverCDP('http://localhost:9445', { timeout: 10000 });
  const page = b.contexts()[0].pages().find(p => p.url().includes('lss.do'));
  if (!page) { console.error('no page'); process.exit(1); }

  const info = await page.evaluate(() => {
    const selected = document.querySelector('.cl-tabfolder-item.cl-selected');
    const tabs = [...document.querySelectorAll('.cl-tabfolder-item')].map(t => t.innerText.trim());
    const purpose = document.body.innerText.match(/집행목적\(용도\)\n(.+)/);

    // textarea 상태
    const tas = [...document.querySelectorAll('textarea.cl-text')];
    const taInfo = tas.map(ta => ({
      disabled: ta.closest('.cl-disabled') !== null,
      visible: ta.getBoundingClientRect().height > 0,
      rpa: ta.getAttribute('data-rpa-ta'),
      h: Math.round(ta.getBoundingClientRect().height),
      w: Math.round(ta.getBoundingClientRect().width),
    }));

    // 콤보박스 상태
    const combos = [...document.querySelectorAll('.cl-combobox:not(.cl-disabled)')];
    const comboInfo = combos.map(c => ({
      text: (c.innerText || '').trim().substring(0, 30),
      h: Math.round(c.getBoundingClientRect().height),
    }));

    // 검토진행상태 현재 값
    const layouts = [...document.querySelectorAll('.cl-layout')].filter(el => {
      const t = (el.innerText || '');
      return t.includes('검토진행상태') && t.includes('검증검토의견');
    });
    let comboValue = '';
    if (layouts.length > 0) {
      const cv = layouts[layouts.length - 1].querySelector('.cl-combobox:not(.cl-disabled) .cl-combobox-displaytext');
      comboValue = (cv?.innerText || '').trim();
    }

    return {
      selectedTab: (selected?.innerText || '').trim(),
      tabs,
      purpose: purpose?.[1]?.trim().substring(0, 80) || '',
      textareas: taInfo,
      activeComboCount: combos.length,
      comboSamples: comboInfo.slice(0, 5),
      reviewStatus: comboValue,
    };
  });

  console.log(JSON.stringify(info, null, 2));
  await b.close();
})().catch(e => console.error('ERROR:', e.message));
