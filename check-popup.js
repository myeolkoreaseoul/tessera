/**
 * 보탬e 저장 후 팝업 확인 스크립트
 * - 현재 화면 상태 + 팝업/다이얼로그 캡처
 * - 저장 버튼 클릭 후 나타나는 팝업 캡처
 */
const { chromium } = require('playwright');
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

(async () => {
  const b = await chromium.connectOverCDP('http://localhost:9445', { timeout: 10000 });
  const page = b.contexts()[0].pages().find(p => p.url().includes('lss.do'));
  if (!page) { console.error('lss.do 탭 없음'); process.exit(1); }

  // 1) 현재 건 정보
  const currentState = await page.evaluate(() => {
    const text = document.body.innerText;
    const purposeM = text.match(/집행목적\(용도\)\n(.+)/);
    const statusM = text.match(/검토진행상태\n(.+)/);
    return {
      purpose: (purposeM?.[1] || '').trim().substring(0, 60),
      status: (statusM?.[1] || '').trim(),
    };
  });
  console.log('현재 건:', currentState.purpose);
  console.log('검토상태:', currentState.status);

  // 2) 현재 화면 팝업 확인
  const popups = await page.evaluate(() => {
    const all = [...document.querySelectorAll('*')].filter(el => {
      const cls = el.className || '';
      const r = el.getBoundingClientRect();
      return r.width > 50 && r.height > 30 && (
        cls.includes('dialog') || cls.includes('Dialog') ||
        cls.includes('messagebox') || cls.includes('MessageBox') ||
        cls.includes('confirm') || cls.includes('Confirm') ||
        cls.includes('alert') || cls.includes('Alert') ||
        cls.includes('modal') || cls.includes('Modal') ||
        cls.includes('cl-popup') || cls.includes('cl-window')
      );
    });
    return all.map(el => ({
      class: el.className.substring(0, 120),
      text: (el.innerText || '').substring(0, 500),
      w: Math.round(el.getBoundingClientRect().width),
      h: Math.round(el.getBoundingClientRect().height),
    }));
  });
  console.log('\n=== 현재 팝업 ===');
  if (popups.length === 0) console.log('  (없음)');
  popups.forEach(p => {
    console.log(`  [${p.w}x${p.h}] class="${p.class}"`);
    console.log(`  text: "${p.text.substring(0, 200)}"`);
  });

  // 3) 저장 버튼 클릭해서 팝업 캡처 (보완요청 상태에서 저장 시 뜨는 팝업)
  console.log('\n--- 저장 버튼 클릭 ---');
  const saved = await page.evaluate(() => {
    const saveBtns = [...document.querySelectorAll('div,button')].filter(el => {
      const t = (el.innerText || '').trim();
      const r = el.getBoundingClientRect();
      return t === '저장' && r.width > 0 && el.childElementCount === 0;
    });
    if (saveBtns.length > 0) {
      saveBtns[0].click();
      return true;
    }
    return false;
  });
  console.log('저장 클릭:', saved);
  await sleep(2000);

  // 4) 저장 후 나타난 팝업 캡처
  const afterPopups = await page.evaluate(() => {
    // 넓은 범위로 팝업 찾기
    const all = [...document.querySelectorAll('*')].filter(el => {
      const cls = (el.className || '').toString();
      const r = el.getBoundingClientRect();
      const style = getComputedStyle(el);
      // z-index 높은 요소 또는 팝업 클래스
      return r.width > 50 && r.height > 30 && (
        cls.includes('dialog') || cls.includes('Dialog') ||
        cls.includes('messagebox') || cls.includes('MessageBox') ||
        cls.includes('confirm') || cls.includes('Confirm') ||
        cls.includes('alert') || cls.includes('Alert') ||
        cls.includes('modal') || cls.includes('Modal') ||
        cls.includes('cl-popup') || cls.includes('cl-window') ||
        (parseInt(style.zIndex) > 100 && r.width < 800)
      );
    });

    // 확인/예/아니오 버튼도 캡처
    const btns = [...document.querySelectorAll('*')].filter(el => {
      const t = (el.innerText || '').trim();
      const r = el.getBoundingClientRect();
      return r.width > 0 && el.childElementCount === 0 &&
        (t === '확인' || t === '예' || t === '아니오' || t === '취소' || t === 'OK');
    }).map(el => ({
      text: (el.innerText || '').trim(),
      class: el.className.substring(0, 80),
      x: Math.round(el.getBoundingClientRect().x),
      y: Math.round(el.getBoundingClientRect().y),
    }));

    return {
      popups: all.map(el => ({
        class: el.className.toString().substring(0, 120),
        text: (el.innerText || '').substring(0, 500),
        w: Math.round(el.getBoundingClientRect().width),
        h: Math.round(el.getBoundingClientRect().height),
        zIndex: getComputedStyle(el).zIndex,
      })),
      buttons: btns,
    };
  });

  console.log('\n=== 저장 후 팝업 ===');
  if (afterPopups.popups.length === 0) console.log('  (없음)');
  afterPopups.popups.forEach(p => {
    console.log(`  [${p.w}x${p.h} z:${p.zIndex}] class="${p.class}"`);
    console.log(`  text: "${p.text.substring(0, 300)}"`);
    console.log();
  });

  console.log('=== 확인/취소 버튼 ===');
  afterPopups.buttons.forEach(btn => {
    console.log(`  "${btn.text}" at (${btn.x}, ${btn.y}) class="${btn.class}"`);
  });

  // 5) 팝업 버튼 누르지 않고 종료 (사용자가 직접 확인)
  await b.close();
})().catch(e => console.error('ERROR:', e.message));
