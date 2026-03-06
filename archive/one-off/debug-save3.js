/**
 * register-review-botem.js와 동일한 흐름으로 1건 저장 + 스크린샷
 */
const { chromium } = require('playwright');
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

(async () => {
  const b = await chromium.connectOverCDP('http://localhost:9445', { timeout: 10000 });
  const page = b.contexts()[0].pages().find(p => p.url().includes('lss.do'));
  if (!page) { console.error('lss.do 탭 없음'); process.exit(1); }

  const opinion = '보완요청: ① 공과금 영수증(납부확인서) ② 카드영수증/세금계산서/계좌이체확인증 ③ 입주기업 창업활동 공간 확인';

  // STEP 1: 콤보 스크롤 + 클릭
  console.log('STEP 1: 콤보 버튼 클릭');
  await page.evaluate(() => {
    const layouts = [...document.querySelectorAll('.cl-layout')].filter(el => {
      const t = (el.innerText || '');
      return t.includes('검토진행상태') && t.includes('검증검토의견');
    });
    for (const layout of layouts.reverse()) {
      const combo = layout.querySelector('.cl-combobox:not(.cl-disabled)');
      if (combo) combo.scrollIntoView({ block: 'center' });
    }
  });
  await sleep(300);
  await page.evaluate(() => {
    const layouts = [...document.querySelectorAll('.cl-layout')].filter(el => {
      const t = (el.innerText || '');
      return t.includes('검토진행상태') && t.includes('검증검토의견');
    });
    for (const layout of layouts.reverse()) {
      const comboBtn = layout.querySelector('.cl-combobox:not(.cl-disabled) .cl-combobox-button');
      if (comboBtn) { comboBtn.click(); return; }
    }
  });
  await sleep(700);
  await page.screenshot({ path: '/tmp/ds3-step1-combo-open.png' });

  // STEP 2: 보완요청 선택
  console.log('STEP 2: 보완요청 선택');
  const selected = await page.evaluate(() => {
    const popups = [...document.querySelectorAll('.cl-combobox-list.cl-popup')]
      .filter(el => el.getBoundingClientRect().height > 0);
    for (const popup of popups) {
      const items = [...popup.querySelectorAll('*')].filter(el =>
        (el.innerText || '').trim() === '보완요청' && el.childElementCount === 0 && el.getBoundingClientRect().height > 0
      );
      if (items.length > 0) { items[0].click(); return true; }
    }
    return false;
  });
  console.log('  선택:', selected);
  await sleep(500);
  await page.screenshot({ path: '/tmp/ds3-step2-combo-selected.png' });

  // STEP 3: textarea Playwright type
  console.log('STEP 3: textarea 입력');
  await page.evaluate(() => {
    const textareas = [...document.querySelectorAll('textarea.cl-text')];
    const activeTA = textareas.find(ta => !ta.closest('.cl-disabled'));
    if (activeTA) activeTA.setAttribute('data-rpa-ta', 'opinion');
  });
  await sleep(200);
  const ta = await page.$('[data-rpa-ta="opinion"]');
  if (ta) {
    await ta.click();
    await sleep(100);
    await page.keyboard.press('Control+a');
    await sleep(50);
    await page.keyboard.press('Delete');
    await sleep(50);
    await ta.type(opinion, { delay: 5 });
    await sleep(200);
    // Tab으로 포커스 이동 (cl-* 프레임워크 값 커밋)
    await page.keyboard.press('Tab');
    await sleep(300);
  }
  await page.screenshot({ path: '/tmp/ds3-step3-textarea.png' });

  // STEP 4: 저장
  console.log('STEP 4: 저장 클릭');
  const saved = await page.evaluate(() => {
    const saveBtns = [...document.querySelectorAll('div,button')].filter(el => {
      const t = (el.innerText || '').trim();
      const r = el.getBoundingClientRect();
      return t === '저장' && r.width > 0 && el.childElementCount === 0;
    });
    if (saveBtns.length > 0) { saveBtns[0].click(); return true; }
    return false;
  });
  console.log('  저장:', saved);
  await sleep(3000);
  await page.screenshot({ path: '/tmp/ds3-step4-after-save.png' });

  // STEP 5: 팝업 확인
  const popup = await page.evaluate(() => {
    const dialogs = [...document.querySelectorAll('.cl-dialog, [class*="cl-window"]')]
      .filter(el => el.getBoundingClientRect().width > 0);
    return dialogs.map(d => ({
      class: d.className.substring(0, 100),
      text: (d.innerText || '').trim().substring(0, 300),
    }));
  });
  console.log('STEP 5: 팝업');
  popup.forEach(p => console.log(`  "${p.text}" [${p.class}]`));
  if (popup.length === 0) console.log('  (팝업 없음 → 저장 성공!)');

  await b.close();
})().catch(e => console.error('ERROR:', e.message));
