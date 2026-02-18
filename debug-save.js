/**
 * 저장 과정 단계별 디버깅
 * 1) 콤보박스 선택 확인
 * 2) textarea 입력 확인
 * 3) 저장 클릭 후 팝업 캡처
 */
const { chromium } = require('playwright');
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

(async () => {
  const b = await chromium.connectOverCDP('http://localhost:9445', { timeout: 10000 });
  const page = b.contexts()[0].pages().find(p => p.url().includes('lss.do'));
  if (!page) { console.error('lss.do 탭 없음'); process.exit(1); }

  console.log('=== STEP 1: 콤보박스 열기 ===');

  // 콤보박스 버튼 클릭
  await page.evaluate(() => {
    const layouts = [...document.querySelectorAll('.cl-layout')].filter(el => {
      const t = (el.innerText || '');
      return t.includes('검토진행상태') && t.includes('검증검토의견');
    });
    for (const layout of layouts.reverse()) {
      const comboBtn = layout.querySelector('.cl-combobox:not(.cl-disabled) .cl-combobox-button');
      if (comboBtn) { comboBtn.click(); return 'clicked'; }
    }
    return 'not found';
  });
  await sleep(1000);

  // 드롭다운 옵션 캡처
  const options = await page.evaluate(() => {
    const popups = [...document.querySelectorAll('.cl-combobox-list.cl-popup, [class*="cl-popup"]')]
      .filter(el => el.getBoundingClientRect().height > 0);

    const items = [];
    for (const popup of popups) {
      const children = [...popup.querySelectorAll('*')].filter(el => {
        const t = (el.innerText || '').trim();
        return t.length > 0 && t.length < 20 && el.childElementCount === 0 && el.getBoundingClientRect().height > 0;
      });
      children.forEach(el => items.push({
        text: (el.innerText || '').trim(),
        class: el.className.substring(0, 60),
        tag: el.tagName,
      }));
    }
    return { popupCount: popups.length, items };
  });
  console.log('팝업:', options.popupCount, '옵션:', options.items.map(i => `"${i.text}"`).join(', '));

  console.log('\n=== STEP 2: "보완요청" 선택 ===');
  const selected = await page.evaluate(() => {
    const popups = [...document.querySelectorAll('.cl-combobox-list.cl-popup, [class*="cl-popup"]')]
      .filter(el => el.getBoundingClientRect().height > 0);
    for (const popup of popups) {
      const items = [...popup.querySelectorAll('*')].filter(el =>
        (el.innerText || '').trim() === '보완요청' && el.childElementCount === 0 && el.getBoundingClientRect().height > 0
      );
      if (items.length > 0) {
        items[0].click();
        return 'clicked 보완요청';
      }
    }
    return 'not found';
  });
  console.log('선택 결과:', selected);
  await sleep(500);

  // 선택 후 콤보 값 확인
  const afterCombo = await page.evaluate(() => {
    const layouts = [...document.querySelectorAll('.cl-layout')].filter(el =>
      (el.innerText || '').includes('검토진행상태') && (el.innerText || '').includes('검증검토의견')
    );
    if (layouts.length > 0) {
      const layout = layouts[layouts.length - 1];
      const combo = layout.querySelector('.cl-combobox:not(.cl-disabled)');
      const textEl = combo?.querySelector('.cl-text:not(.cl-placeholder)');
      return (textEl?.innerText || '').trim();
    }
    return 'N/A';
  });
  console.log('콤보 현재 값:', JSON.stringify(afterCombo));

  console.log('\n=== STEP 3: textarea 입력 ===');
  const taResult = await page.evaluate(() => {
    const textareas = [...document.querySelectorAll('textarea.cl-text')];
    const activeTA = textareas.find(ta => !ta.closest('.cl-disabled'));
    if (activeTA) {
      activeTA.focus();
      activeTA.value = '테스트 의견입니다';
      activeTA.dispatchEvent(new Event('input', { bubbles: true }));
      activeTA.dispatchEvent(new Event('change', { bubbles: true }));
      return { set: true, value: activeTA.value };
    }
    return { set: false };
  });
  console.log('textarea 결과:', JSON.stringify(taResult));
  await sleep(300);

  console.log('\n=== STEP 4: 저장 클릭 ===');
  const saveResult = await page.evaluate(() => {
    const saveBtns = [...document.querySelectorAll('div,button')].filter(el => {
      const t = (el.innerText || '').trim();
      const r = el.getBoundingClientRect();
      return t === '저장' && r.width > 0 && el.childElementCount === 0;
    });
    if (saveBtns.length > 0) {
      saveBtns[0].click();
      return { clicked: true, class: saveBtns[0].className, tag: saveBtns[0].tagName };
    }
    return { clicked: false };
  });
  console.log('저장 클릭:', JSON.stringify(saveResult));

  // 팝업 대기
  await sleep(3000);

  console.log('\n=== STEP 5: 팝업 캡처 ===');
  const popupCapture = await page.evaluate(() => {
    // 모든 보이는 요소 중 z-index 높거나 팝업 클래스인 것
    const result = [];
    const all = document.querySelectorAll('*');
    for (const el of all) {
      const cls = (el.className || '').toString();
      const r = el.getBoundingClientRect();
      const z = getComputedStyle(el).zIndex;

      if (r.width < 30 || r.height < 20) continue;

      const isPopup = cls.includes('dialog') || cls.includes('Dialog') ||
        cls.includes('messagebox') || cls.includes('MessageBox') ||
        cls.includes('confirm') || cls.includes('Confirm') ||
        cls.includes('cl-window') || cls.includes('cl-popup') ||
        (parseInt(z) > 500 && r.width < 700 && r.height < 500);

      if (isPopup) {
        result.push({
          tag: el.tagName,
          class: cls.substring(0, 120),
          text: (el.innerText || '').substring(0, 400),
          w: Math.round(r.width),
          h: Math.round(r.height),
          z,
        });
      }
    }

    // 확인/예/아니오 버튼
    const btns = [...document.querySelectorAll('*')].filter(el => {
      const t = (el.innerText || '').trim();
      const r = el.getBoundingClientRect();
      return r.width > 0 && el.childElementCount === 0 &&
        ['확인', '예', '아니오', '취소', 'OK', 'Yes', 'No'].includes(t);
    }).map(el => ({
      text: (el.innerText || '').trim(),
      class: el.className.substring(0, 80),
    }));

    return { popups: result, buttons: btns };
  });

  console.log('팝업 수:', popupCapture.popups.length);
  popupCapture.popups.forEach(p => {
    console.log(`\n  [${p.w}x${p.h} z:${p.z}] ${p.class}`);
    console.log(`  text: "${p.text.substring(0, 300)}"`);
  });
  console.log('\n버튼:', popupCapture.buttons.map(b => `"${b.text}" [${b.class.substring(0,40)}]`).join(', '));

  // 스크린샷
  await page.screenshot({ path: '/tmp/botem-save-popup.png', fullPage: false });
  console.log('\n스크린샷: /tmp/botem-save-popup.png');

  await b.close();
})().catch(e => console.error('ERROR:', e.message));
