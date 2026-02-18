const { chromium } = require('playwright');
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
(async () => {
  const b = await chromium.connectOverCDP('http://localhost:9445', { timeout: 10000 });
  const page = b.contexts()[0].pages().find(p => p.url().includes('lss.do'));
  if (!page) { process.exit(1); }
  
  // 의견등록 탭
  await page.evaluate(() => {
    const tabs = [...document.querySelectorAll('.cl-tabfolder-item')];
    const t = tabs.find(t => (t.innerText || '').includes('의견등록'));
    if (t) t.click();
  });
  await sleep(2000);
  
  await page.screenshot({ path: '/tmp/botem-verify.png', fullPage: false });
  console.log('screenshot: /tmp/botem-verify.png');
  
  // 더 자세한 정보 - 모든 콤보박스와 textarea 내용
  const detail = await page.evaluate(() => {
    const text = document.body.innerText;
    const purpose = text.match(/집행목적\(용도\)\n(.+)/)?.[1]?.trim() || '';
    
    // 모든 콤보박스의 display text
    const allCombos = [...document.querySelectorAll('.cl-combobox')];
    const comboTexts = allCombos.map(c => ({
      disabled: c.classList.contains('cl-disabled'),
      text: (c.querySelector('.cl-combobox-displaytext')?.innerText || '').trim(),
      rect: { h: Math.round(c.getBoundingClientRect().height), y: Math.round(c.getBoundingClientRect().y) }
    })).filter(c => c.rect.h > 0);
    
    // 모든 textarea 내용
    const allTA = [...document.querySelectorAll('textarea')];
    const taTexts = allTA.map(ta => ({
      disabled: ta.closest('.cl-disabled') !== null,
      value: ta.value.substring(0, 100),
      rect: { h: Math.round(ta.getBoundingClientRect().height), y: Math.round(ta.getBoundingClientRect().y) }
    })).filter(t => t.rect.h > 0);
    
    // "검토진행상태" 라벨 근처 텍스트
    const statusArea = text.match(/검토진행상태[\s\S]{0,200}/)?.[0]?.substring(0, 200) || '';
    
    return { purpose: purpose.substring(0, 60), combos: comboTexts, textareas: taTexts, statusArea };
  });
  
  console.log(JSON.stringify(detail, null, 2));
  await b.close();
})().catch(e => console.error('ERROR:', e.message));
