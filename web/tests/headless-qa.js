const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const results = [];
  let pass = 0, fail = 0;

  function check(name, ok, detail) {
    if (ok) { pass++; results.push('PASS ' + name); }
    else { fail++; results.push('FAIL ' + name + (detail ? ': ' + detail : '')); }
  }

  // Test 1: ezbaro page loads
  await page.goto('http://localhost:3500/ezbaro/');
  const title = await page.textContent('h1');
  check('ezbaro 페이지 로드', title && title.includes('이지바로'));

  // Test 2: Upload area exists
  const uploadArea = await page.$('input[type=file]');
  check('엑셀 업로드 영역 존재', !!uploadArea);

  // Test 3: No task list before upload
  const tasksBefore = await page.$$('table');
  check('업로드 전 테이블 없음', tasksBefore.length === 0);

  // Test 4: Back button exists
  const backBtn = await page.$('button');
  check('뒤로가기 버튼 존재', !!backBtn);

  // Test 5: Navigate to home and back
  await page.goto('http://localhost:3500/');
  const homeTitle = await page.textContent('h1');
  check('홈 페이지 로드', homeTitle && homeTitle.includes('tessera'));

  // Test 6: Navigation to ezbaro link (may be rendered by React hydration)
  await page.waitForTimeout(1000); // wait for hydration
  const ezLink = await page.$('a[href*="ezbaro"]');
  check('이지바로 네비게이션 링크', !!ezLink);

  // Test 7: Navigate directly to ezbaro
  await page.goto('http://localhost:3500/ezbaro/');
  await page.waitForSelector('h1', { timeout: 5000 });
  const ezTitle = await page.textContent('h1');
  check('이지바로 페이지 직접 네비게이션', ezTitle && ezTitle.includes('이지바로'));

  // Test 8: Check upload prompt text
  const pageContent = await page.textContent('body');
  check('엑셀 업로드 문구 표시', pageContent.includes('엑셀') || pageContent.includes('업로드'));

  // Test 9: Check API - tasks (should 404 without upload)
  const tasksResp = await page.request.get('http://localhost:3500/api/ezbaro/tasks');
  check('GET /api/ezbaro/tasks 응답', tasksResp.status() === 404 || tasksResp.status() === 200);

  // Test 10: Check API - batch-status
  const batchResp = await page.request.get('http://localhost:3500/api/ezbaro/batch-status');
  check('GET /api/ezbaro/batch-status 응답', batchResp.status() === 200);

  // Test 11: Results page
  await page.goto('http://localhost:3500/results/');
  const resultsBody = await page.textContent('body');
  check('결과 페이지 로드', resultsBody && resultsBody.length > 50);

  // Test 12: Launch page
  await page.goto('http://localhost:3500/launch/');
  const launchBody = await page.textContent('body');
  check('출격 페이지 로드', launchBody && launchBody.length > 50);

  await browser.close();

  console.log('\n=== Headless Test Results ===');
  results.forEach(r => console.log(r));
  console.log('\n' + pass + ' passed, ' + fail + ' failed, ' + (pass+fail) + ' total');

  if (fail > 0) process.exit(1);
})().catch(e => { console.error('Test error:', e.message); process.exit(1); });
