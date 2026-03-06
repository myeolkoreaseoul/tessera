const { chromium } = require('playwright');
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

(async () => {
  const b = await chromium.connectOverCDP('http://localhost:9445', { timeout: 10000 });
  const page = b.contexts()[0].pages().find(p => p.url().includes('lss.do'));
  if (!page) { console.error('no page'); process.exit(1); }

  // 의견등록 탭 클릭
  await page.evaluate(() => {
    const tabs = [...document.querySelectorAll('.cl-tabfolder-item')];
    const t = tabs.find(t => (t.innerText || '').includes('의견등록'));
    if (t) t.click();
  });
  await sleep(2000);

  // 현재 건 정보
  const info = await page.evaluate(() => {
    const text = document.body.innerText;
    const purposeM = text.match(/집행목적\(용도\)\n(.+)/);
    const selected = document.querySelector('.cl-tabfolder-item.cl-selected');
    
    // textarea 상태
    const tas = [...document.querySelectorAll('textarea.cl-text')];
    const activeTA = tas.filter(ta => !ta.closest('.cl-disabled'));
    
    // 검토진행상태 콤보 값
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
      tab: (selected?.innerText || '').trim(),
      purpose: purposeM?.[1]?.trim().substring(0, 80) || '',
      activeTextareas: activeTA.length,
      taVisible: activeTA.map(ta => ta.getBoundingClientRect().height > 0),
      reviewStatus: comboValue,
    };
  });
  
  console.log(JSON.stringify(info, null, 2));
  await b.close();
})().catch(e => console.error('ERROR:', e.message));
