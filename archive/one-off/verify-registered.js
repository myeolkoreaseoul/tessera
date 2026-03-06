const { chromium } = require('playwright');
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

(async () => {
  const b = await chromium.connectOverCDP('http://localhost:9445', { timeout: 10000 });
  const page = b.contexts()[0].pages().find(p => p.url().includes('lss.do'));
  if (!page) { console.error('no page'); process.exit(1); }

  // 의견등록 탭 확인
  const tab = await page.evaluate(() => {
    const sel = document.querySelector('.cl-tabfolder-item.cl-selected');
    return (sel?.innerText || '').trim();
  });
  if (!tab.includes('의견등록')) {
    await page.evaluate(() => {
      const tabs = [...document.querySelectorAll('.cl-tabfolder-item')];
      const t = tabs.find(t => (t.innerText || '').includes('의견등록'));
      if (t) t.click();
    });
    await sleep(2000);
  }

  // 현재 건 정보 (입력된 상태 읽기)
  const info = await page.evaluate(() => {
    const text = document.body.innerText;
    const purpose = text.match(/집행목적\(용도\)\n(.+)/)?.[1]?.trim() || '';
    
    // 검토진행상태 현재 값
    const layouts = [...document.querySelectorAll('.cl-layout')].filter(el => {
      const t = (el.innerText || '');
      return t.includes('검토진행상태') && t.includes('검증검토의견');
    });
    let comboValue = '';
    let opinionValue = '';
    if (layouts.length > 0) {
      const cv = layouts[layouts.length - 1].querySelector('.cl-combobox:not(.cl-disabled) .cl-combobox-displaytext');
      comboValue = (cv?.innerText || '').trim();
      const ta = layouts[layouts.length - 1].querySelector('textarea.cl-text');
      opinionValue = ta ? ta.value : '';
    }
    
    return { purpose: purpose.substring(0, 60), status: comboValue, opinion: opinionValue.substring(0, 80) };
  });
  
  console.log('현재 건:', JSON.stringify(info, null, 2));
  
  // 이전 건 4개 확인 (뒤로 가면서)
  for (let i = 0; i < 4; i++) {
    // 이전 건으로
    const moved = await page.evaluate(() => {
      const btns = [...document.querySelectorAll('*')].filter(el => {
        const t = (el.innerText||'').trim();
        const r = el.getBoundingClientRect();
        return t === '이전 집행정보 보기' && r.width > 0 && el.childElementCount === 0;
      });
      if (btns.length > 0) { btns[0].click(); return true; }
      return false;
    });
    if (!moved) { console.log('이전 건 없음'); break; }
    await sleep(1500);
    
    const prevInfo = await page.evaluate(() => {
      const text = document.body.innerText;
      const purpose = text.match(/집행목적\(용도\)\n(.+)/)?.[1]?.trim() || '';
      const layouts = [...document.querySelectorAll('.cl-layout')].filter(el => {
        const t = (el.innerText || '');
        return t.includes('검토진행상태') && t.includes('검증검토의견');
      });
      let comboValue = '';
      let opinionValue = '';
      if (layouts.length > 0) {
        const cv = layouts[layouts.length - 1].querySelector('.cl-combobox:not(.cl-disabled) .cl-combobox-displaytext');
        comboValue = (cv?.innerText || '').trim();
        const ta = layouts[layouts.length - 1].querySelector('textarea.cl-text');
        opinionValue = ta ? ta.value : '';
      }
      return { purpose: purpose.substring(0, 60), status: comboValue, opinion: opinionValue.substring(0, 80) };
    });
    console.log(`이전 건[${i+1}]:`, JSON.stringify(prevInfo, null, 2));
  }
  
  await b.close();
})().catch(e => console.error('ERROR:', e.message));
