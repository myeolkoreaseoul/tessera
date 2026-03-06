const { chromium } = require('playwright');
const sleep = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  const b = await chromium.connectOverCDP('http://100.87.3.123:9445', { timeout: 10000 });
  const page = b.contexts()[0].pages().find(p => p.url().includes('lss.do'));
  if (!page) { console.error('no page'); process.exit(1); }

  // 스크롤 다운
  await page.evaluate(() => {
    const c = document.querySelector('.cl-layout.cl-scrollbar.cl-customscrollbar.cl-with-vscrollbar');
    if (c) c.scrollTop = c.scrollHeight;
  });
  await sleep(400);

  // 1. textarea 상세
  const taDetail = await page.evaluate(() => {
    return [...document.querySelectorAll('textarea')].filter(el =>
      el.getBoundingClientRect().width > 100
    ).map(el => ({
      value: el.value.substring(0, 100),
      innerText: (el.innerText || '').substring(0, 100),
      textContent: (el.textContent || '').substring(0, 100),
      placeholder: el.placeholder,
      name: el.name, id: el.id,
      readOnly: el.readOnly, disabled: el.disabled,
      parentCls: el.parentElement ? el.parentElement.className.substring(0, 80) : '',
      x: Math.round(el.getBoundingClientRect().x),
      y: Math.round(el.getBoundingClientRect().y),
      w: Math.round(el.getBoundingClientRect().width),
      h: Math.round(el.getBoundingClientRect().height),
    }));
  });
  console.log('textarea 상세:', JSON.stringify(taDetail, null, 2));

  // 2. "검증검토의견" 라벨 주변
  const opinionArea = await page.evaluate(() => {
    const lbl = [...document.querySelectorAll('.cl-text')].find(el =>
      (el.innerText || '').trim() === '검증검토의견' && el.getBoundingClientRect().width > 0);
    if (!lbl) return { found: false };
    const lr = lbl.getBoundingClientRect();
    // 라벨과 같은 y 또는 바로 아래의 모든 요소
    const nearby = [...document.querySelectorAll('*')].filter(el => {
      const r = el.getBoundingClientRect();
      return r.y >= lr.y - 5 && r.y < lr.y + 120 && r.x > lr.x + lr.width - 30 &&
        r.width > 50 && el.childElementCount <= 1;
    }).map(el => ({
      tag: el.tagName,
      cls: (el.className || '').substring(0, 60),
      text: (el.innerText || '').substring(0, 100),
      val: (el.value || '').substring(0, 100),
      x: Math.round(el.getBoundingClientRect().x),
      y: Math.round(el.getBoundingClientRect().y),
      w: Math.round(el.getBoundingClientRect().width),
      h: Math.round(el.getBoundingClientRect().height),
    }));
    return { found: true, labelY: Math.round(lr.y), elements: nearby };
  });
  console.log('\n검증검토의견 영역:', JSON.stringify(opinionArea, null, 2));

  // 3. 커스텀 텍스트 컨트롤
  const custom = await page.evaluate(() => {
    return [...document.querySelectorAll('[class*="cl-textarea"], [class*="cl-textbox"]')].filter(el =>
      el.getBoundingClientRect().width > 100
    ).map(el => ({
      cls: (el.className || '').substring(0, 80),
      text: (el.innerText || '').substring(0, 100),
      x: Math.round(el.getBoundingClientRect().x),
      y: Math.round(el.getBoundingClientRect().y),
      w: Math.round(el.getBoundingClientRect().width),
      h: Math.round(el.getBoundingClientRect().height)
    }));
  });
  console.log('\n커스텀 컨트롤:', JSON.stringify(custom, null, 2));

  // 4. y=600~900 가시 영역에서 5자 이상 텍스트 가진 leaf 노드
  const visText = await page.evaluate(() => {
    return [...document.querySelectorAll('*')].filter(el => {
      const r = el.getBoundingClientRect();
      const t = (el.innerText || el.value || '').trim();
      return r.y > 600 && r.y < 900 && r.width > 80 &&
        t.length > 5 && el.childElementCount === 0;
    }).map(el => ({
      tag: el.tagName,
      cls: (el.className || '').substring(0, 50),
      text: (el.innerText || el.value || '').substring(0, 100),
      x: Math.round(el.getBoundingClientRect().x),
      y: Math.round(el.getBoundingClientRect().y)
    }));
  });
  console.log('\ny>600 텍스트:', JSON.stringify(visText, null, 2));

  await b.close();
})().catch(e => console.error(e.message));
