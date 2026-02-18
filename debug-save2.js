/**
 * 디버그 2: Playwright 네이티브 type()으로 textarea 입력
 * 1) 팝업 닫기 (확인 클릭)
 * 2) textarea 비우기 → Playwright type()으로 입력
 * 3) 저장 → 팝업 확인
 */
const { chromium } = require('playwright');
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

(async () => {
  const b = await chromium.connectOverCDP('http://localhost:9445', { timeout: 10000 });
  const page = b.contexts()[0].pages().find(p => p.url().includes('lss.do'));
  if (!page) { console.error('lss.do 탭 없음'); process.exit(1); }

  // 1) 현재 팝업 닫기
  console.log('=== 팝업 닫기 ===');
  await page.evaluate(() => {
    const btns = [...document.querySelectorAll('.cl-dialog button, .cl-dialog .cl-text')].filter(el =>
      (el.innerText || '').trim() === '확인' && el.getBoundingClientRect().width > 0
    );
    if (btns.length > 0) btns[0].click();
  });
  await sleep(500);

  // 2) 현재 콤보 값 확인
  const comboVal = await page.evaluate(() => {
    const layouts = [...document.querySelectorAll('.cl-layout')].filter(el =>
      (el.innerText || '').includes('검토진행상태') && (el.innerText || '').includes('검증검토의견')
    );
    if (layouts.length > 0) {
      const combo = layouts[layouts.length - 1].querySelector('.cl-combobox:not(.cl-disabled)');
      const textEl = combo?.querySelector('.cl-text:not(.cl-placeholder)');
      return (textEl?.innerText || '').trim();
    }
    return '';
  });
  console.log('콤보 현재 값:', JSON.stringify(comboVal));

  // 이미 보완요청이면 콤보 선택 건너뜀
  if (!comboVal.includes('보완요청')) {
    console.log('콤보 재선택 필요');
    // 콤보박스 클릭
    await page.evaluate(() => {
      const layouts = [...document.querySelectorAll('.cl-layout')].filter(el =>
        (el.innerText || '').includes('검토진행상태') && (el.innerText || '').includes('검증검토의견')
      );
      for (const layout of layouts.reverse()) {
        const btn = layout.querySelector('.cl-combobox:not(.cl-disabled) .cl-combobox-button');
        if (btn) { btn.click(); return; }
      }
    });
    await sleep(700);
    await page.evaluate(() => {
      const popups = [...document.querySelectorAll('.cl-combobox-list.cl-popup')]
        .filter(el => el.getBoundingClientRect().height > 0);
      for (const popup of popups) {
        const items = [...popup.querySelectorAll('*')].filter(el =>
          (el.innerText || '').trim() === '보완요청' && el.childElementCount === 0
        );
        if (items.length > 0) { items[0].click(); return; }
      }
    });
    await sleep(500);
  }

  // 3) textarea: Playwright 네이티브 방식으로 입력
  console.log('\n=== textarea Playwright type ===');

  // textarea 찾기
  const taSelector = await page.evaluate(() => {
    const textareas = [...document.querySelectorAll('textarea.cl-text')];
    const activeTA = textareas.find(ta => !ta.closest('.cl-disabled'));
    if (activeTA) {
      // 고유 셀렉터 생성
      activeTA.setAttribute('data-debug-ta', 'review-opinion');
      return '[data-debug-ta="review-opinion"]';
    }
    return null;
  });
  console.log('textarea 셀렉터:', taSelector);

  if (taSelector) {
    const ta = await page.$(taSelector);
    if (ta) {
      // 기존 내용 전부 선택 후 삭제
      await ta.click();
      await sleep(200);
      await page.keyboard.press('Control+a');
      await sleep(100);
      await page.keyboard.press('Delete');
      await sleep(100);
      // Playwright type으로 입력
      await ta.type('테스트 의견 - Playwright type', { delay: 10 });
      await sleep(300);

      // 값 확인
      const val = await page.evaluate(() => {
        const ta = document.querySelector('[data-debug-ta="review-opinion"]');
        return ta ? ta.value : 'NOT FOUND';
      });
      console.log('입력된 값:', JSON.stringify(val));
    }
  }

  // 4) 저장
  console.log('\n=== 저장 ===');
  await page.evaluate(() => {
    const btns = [...document.querySelectorAll('div,button')].filter(el => {
      const t = (el.innerText || '').trim();
      return t === '저장' && el.getBoundingClientRect().width > 0 && el.childElementCount === 0;
    });
    if (btns.length > 0) btns[0].click();
  });
  await sleep(3000);

  // 5) 팝업 캡처
  const popup = await page.evaluate(() => {
    const dialogs = [...document.querySelectorAll('.cl-dialog')].filter(el =>
      el.getBoundingClientRect().width > 0
    );
    return dialogs.map(d => ({
      class: d.className.substring(0, 100),
      text: (d.innerText || '').trim(),
    }));
  });
  console.log('\n=== 팝업 ===');
  popup.forEach(p => console.log(`  "${p.text}" [${p.class}]`));

  await page.screenshot({ path: '/tmp/botem-save2.png' });
  console.log('\n스크린샷: /tmp/botem-save2.png');

  await b.close();
})().catch(e => console.error('ERROR:', e.message));
