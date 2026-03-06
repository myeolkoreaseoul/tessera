const { chromium } = require('playwright');
(async () => {
  const b = await chromium.connectOverCDP('http://localhost:9445', { timeout: 10000 });
  const page = b.contexts()[0].pages().find(p => p.url().includes('lss.do'));
  if (!page) { console.error('lss.do 탭 없음'); process.exit(1); }

  // 팝업/에러 다이얼로그 확인
  const dialogs = await page.evaluate(() => {
    return [...document.querySelectorAll('.cl-dialog')]
      .filter(el => el.getBoundingClientRect().width > 0)
      .map(el => (el.innerText || '').trim().substring(0, 200));
  });
  if (dialogs.length > 0) {
    console.log('열린 팝업:');
    dialogs.forEach(d => console.log('  ' + d));
  } else {
    console.log('열린 팝업: 없음');
  }

  // 현재 탭
  const tab = await page.evaluate(() => {
    const s = document.querySelector('.cl-tabfolder-item.cl-selected');
    return (s?.innerText || '').trim();
  });
  console.log('현재 탭:', tab);

  // 현재 건
  const info = await page.evaluate(() => {
    const text = document.body.innerText;
    const m = text.match(/집행목적\(용도\)\n(.+)/);
    return (m?.[1] || '').trim().substring(0, 80);
  });
  console.log('현재 건:', info);

  // 세션 타이머
  const timer = await page.evaluate(() => {
    const text = document.body.innerText;
    const m = text.match(/(\d{2}:\d{2})\s*[🔄⟳]?/);
    return m?.[1] || '(타이머 못찾음)';
  });
  console.log('세션 타이머:', timer);

  // 에러 메시지 있는지
  const errorText = await page.evaluate(() => {
    const text = document.body.innerText;
    if (text.includes('세션이 만료')) return '세션 만료';
    if (text.includes('로그인')) return '로그인 필요';
    if (text.includes('오류')) return '오류 발생';
    return '';
  });
  if (errorText) console.log('에러:', errorText);

  await page.screenshot({ path: '/tmp/botem-check.png' });
  console.log('스크린샷: /tmp/botem-check.png');
  await b.close();
})().catch(e => console.error('ERROR:', e.message));
