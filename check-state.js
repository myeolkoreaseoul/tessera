// 현재 보탬e 상태 확인 + 스크린샷
const { chromium } = require('playwright');
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

(async () => {
  const b = await chromium.connectOverCDP('http://100.87.3.123:9445', { timeout: 10000 });
  const ctx = b.contexts()[0];
  const page = ctx.pages().find(p => p.url().includes('lss.do'));
  if (!page) { console.error('lss.do 탭 없음'); process.exit(1); }

  // 팝업이 있으면 닫기 (확인 버튼)
  await page.evaluate(() => {
    const okBtns = [...document.querySelectorAll('*')].filter(el => {
      const t = (el.innerText || '').trim();
      const r = el.getBoundingClientRect();
      return (t === '확인' || t === 'OK') && r.width > 0 && r.width < 200 && el.childElementCount === 0;
    });
    if (okBtns.length > 0) okBtns[0].click();
  });
  await sleep(500);

  // 닫기 버튼
  await page.evaluate(() => {
    const closeBtns = [...document.querySelectorAll('*')].filter(el => {
      const t = (el.innerText || '').trim();
      const r = el.getBoundingClientRect();
      return t === '닫기' && r.width > 0 && el.childElementCount === 0;
    });
    if (closeBtns.length > 0) closeBtns[0].click();
  });
  await sleep(500);

  await page.screenshot({ path: '/tmp/botem-clean.png' });

  const text = await page.evaluate(() => document.body.innerText.substring(0, 2000));
  console.log('=== 페이지 텍스트 ===');
  console.log(text);

  // 파일 링크
  const fileLinks = await page.evaluate(() => {
    const exts = ['.pdf', '.jpg', '.jpeg', '.png', '.hwp', '.xlsx', '.xls', '.docx', '.zip'];
    return [...document.querySelectorAll('*')]
      .filter(el => {
        if (el.childElementCount > 0) return false;
        const t = (el.innerText || '').trim();
        return t.length > 3 && exts.some(ext => t.toLowerCase().endsWith(ext));
      })
      .map(el => ({
        text: (el.innerText || '').trim(),
        cursor: getComputedStyle(el).cursor,
        tag: el.tagName,
        onclick: (el.getAttribute('onclick') || '').substring(0, 200),
        cls: el.className.substring(0, 100),
      }));
  });

  console.log('\n=== 파일 링크 ===');
  fileLinks.forEach(f => console.log(JSON.stringify(f)));

  // 주요 버튼
  const buttons = await page.evaluate(() => {
    return [...document.querySelectorAll('*')].filter(el => {
      const t = (el.innerText || '').trim();
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 15 && el.childElementCount === 0 &&
        (t.includes('다운로드') || t.includes('이전') || t.includes('다음') || t.includes('목록') || t.includes('저장') || t.includes('첨부'));
    }).map(el => ({
      text: (el.innerText || '').trim().substring(0, 50),
      tag: el.tagName,
      onclick: (el.getAttribute('onclick') || '').substring(0, 200),
    }));
  });

  console.log('\n=== 주요 버튼 ===');
  buttons.forEach(btn => console.log(JSON.stringify(btn)));

  await b.close();
})().catch(e => console.error('ERROR:', e.message));
