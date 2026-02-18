/**
 * 이전 건으로 이동해서 실제 저장됐는지 확인
 */
const { chromium } = require('playwright');
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

(async () => {
  const b = await chromium.connectOverCDP('http://localhost:9445', { timeout: 10000 });
  const page = b.contexts()[0].pages().find(p => p.url().includes('lss.do'));
  if (!page) { console.error('lss.do 탭 없음'); process.exit(1); }

  // 이전 건으로 이동
  console.log('이전 건으로 이동...');
  await page.evaluate(() => {
    const btns = [...document.querySelectorAll('*')].filter(el =>
      (el.innerText || '').trim() === '이전 집행정보 보기' && el.getBoundingClientRect().width > 0 && el.childElementCount === 0
    );
    if (btns.length > 0) btns[0].click();
  });
  await sleep(2000);

  // 현재 건 정보 확인
  const info = await page.evaluate(() => {
    const text = document.body.innerText;
    const purposeM = text.match(/집행목적\(용도\)\n(.+)/);

    const layouts = [...document.querySelectorAll('.cl-layout')].filter(el =>
      (el.innerText || '').includes('검토진행상태') && (el.innerText || '').includes('검증검토의견')
    );
    let comboValue = '';
    let textareaValue = '';
    let reviewDate = '';
    if (layouts.length > 0) {
      const layout = layouts[layouts.length - 1];
      const combo = layout.querySelector('.cl-combobox');
      const textEl = combo?.querySelector('.cl-text');
      comboValue = (textEl?.innerText || '').trim();
      const ta = layout.querySelector('textarea.cl-text');
      if (ta) textareaValue = ta.value;
      // 검토일자
      const dateInputs = [...layout.querySelectorAll('input')];
      reviewDate = dateInputs.map(i => i.value).filter(Boolean).join(', ');
    }

    return {
      purpose: (purposeM?.[1] || '').trim().substring(0, 60),
      comboValue,
      textareaValue: textareaValue.substring(0, 100),
      reviewDate,
    };
  });

  console.log('건:', info.purpose);
  console.log('검토진행상태:', JSON.stringify(info.comboValue));
  console.log('검증검토의견:', JSON.stringify(info.textareaValue));
  console.log('검토일자:', info.reviewDate);

  await b.close();
})().catch(e => console.error('ERROR:', e.message));
