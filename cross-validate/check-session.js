const { sleep, connectBrowser, findEnaraPage, dismissModals, waitForGrid } = require('../lib/utils');

(async () => {
  const { context } = await connectBrowser();
  const pages = context.pages();
  console.log('Open pages:', pages.length);
  for (const p of pages) {
    console.log(' -', p.url().substring(0, 80));
  }

  const page = await findEnaraPage(context);
  if (!page) { console.log('e나라도움 페이지 없음'); process.exit(1); }
  console.log('\ne나라도움 URL:', page.url());

  // Check if logged in
  const loginState = await page.evaluate(() => {
    // Check for login elements
    const loginBtn = document.querySelector('#loginBtn, .login-btn, input[type="password"]');
    // Check for user info
    const userInfo = document.querySelector('.user-info, .userNm, #userNm');
    // Check for any error/session expired messages
    const alerts = [...document.querySelectorAll('.alert, .error, .popupMask.on')].map(e => e.textContent.trim().substring(0, 100));
    // Check the main content
    const body = document.body.innerText.substring(0, 500);
    return {
      hasLoginBtn: !!loginBtn,
      hasUserInfo: !!userInfo,
      alerts,
      bodySnippet: body.substring(0, 300),
    };
  }).catch(e => ({ error: e.message }));

  console.log('Login state:', JSON.stringify(loginState, null, 2));

  // Try navigating to 과제목록 first
  console.log('\n과제목록(DD001005Q)으로 이동 시도...');
  await page.goto('https://gvs.gosims.go.kr/exe/dd/dd001/getDD001005QView.do', {
    waitUntil: 'domcontentloaded',
    timeout: 30000
  }).catch(e => console.log('Navigate error:', e.message));
  await sleep(5000);
  await dismissModals(page);

  console.log('과제목록 URL:', page.url());
  const afterNav = await page.evaluate(() => {
    return document.body.innerText.substring(0, 300);
  }).catch(() => 'EVAL FAILED');
  console.log('Body:', afterNav.substring(0, 200));

  process.exit(0);
})();
