/**
 * 검토진행상태 콤보박스 옵션 확인
 * textarea 입력 + 저장 버튼 테스트 (실제 저장 안 함)
 */
const { chromium } = require('playwright');
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

(async () => {
  const b = await chromium.connectOverCDP('http://localhost:9445', { timeout: 10000 });
  const page = b.contexts()[0].pages().find(p => p.url().includes('lss.do'));
  if (!page) { console.error('lss.do 탭 없음'); process.exit(1); }

  // 검토진행상태 콤보박스 클릭해서 옵션 목록 확인
  const comboResult = await page.evaluate(() => {
    // "검토진행상태" 레이블 찾기
    const labels = [...document.querySelectorAll('div')].filter(el =>
      (el.innerText || '').trim() === '검토진행상태' && el.childElementCount === 0
    );
    console.log('검토진행상태 레이블 수:', labels.length);

    // 콤보박스 uuid로 찾기
    const combo = document.querySelector('#uuid-ff080215-bc5c-b208-cb86-90f50f7353a0, [id*="ff080215"]');
    if (!combo) return { error: '콤보박스 없음' };

    const r = combo.getBoundingClientRect();
    return {
      found: true,
      class: combo.className,
      id: combo.id,
      text: (combo.innerText || '').trim(),
      visible: r.width > 0 && r.height > 0,
      rect: { x: r.x, y: r.y, w: r.width, h: r.height },
      disabled: combo.classList.contains('cl-disabled'),
    };
  });
  console.log('검토진행상태 콤보박스:', JSON.stringify(comboResult, null, 2));

  // 현재 페이지에서 검토 관련 섹션의 전체 구조 분석
  const reviewSection = await page.evaluate(() => {
    // "검증검토의견" 섹션 찾기
    const sections = [...document.querySelectorAll('div.cl-layout, div.cl-control')].filter(el => {
      const t = (el.innerText || '').trim();
      return t.includes('검토진행상태') && t.includes('검증검토의견');
    });

    if (sections.length === 0) return { error: '섹션 없음' };

    const section = sections[0];
    // 섹션 내 모든 직접 자식 cl-control 분석
    const controls = [...section.querySelectorAll('.cl-control')].map(ctrl => {
      const inputs = [...ctrl.querySelectorAll('input, textarea, select')];
      const texts = [...ctrl.querySelectorAll('.cl-text')].map(t => (t.innerText||'').trim()).filter(Boolean);
      const hasCombo = ctrl.classList.contains('cl-combobox');
      const hasTextarea = ctrl.classList.contains('cl-textarea');
      return {
        class: ctrl.className.substring(0, 100),
        id: ctrl.id,
        texts,
        hasCombo,
        hasTextarea,
        inputCount: inputs.length,
        disabled: ctrl.classList.contains('cl-disabled'),
        // 콤보박스인 경우 내부 값
        comboValue: hasCombo ? (ctrl.querySelector('.cl-text:not(.cl-placeholder)') || {innerText:''}).innerText.trim() : null,
      };
    });

    return { controlCount: controls.length, controls: controls.slice(0, 10) };
  });
  console.log('\n=== 검토 섹션 컨트롤 ===');
  console.log(JSON.stringify(reviewSection, null, 2));

  // 콤보박스 버튼 클릭해서 드롭다운 열기
  console.log('\n콤보박스 버튼 클릭...');
  const dropdownResult = await page.evaluate(() => {
    // 검토진행상태 레이블 바로 옆의 콤보박스 버튼 클릭
    const allComboBtns = [...document.querySelectorAll('.cl-combobox-button')];
    console.log('콤보 버튼 수:', allComboBtns.length);

    // 검토진행상태 섹션에서 콤보박스 버튼 찾기
    const layouts = [...document.querySelectorAll('.cl-layout')].filter(el =>
      (el.innerText||'').includes('검토진행상태')
    );

    if (layouts.length > 0) {
      const layout = layouts[layouts.length - 1]; // 마지막 매칭 (검토 섹션)
      const comboBtn = layout.querySelector('.cl-combobox-button');
      const comboCtrl = layout.querySelector('.cl-combobox');
      if (comboBtn) {
        comboBtn.click();
        return {
          clicked: true,
          ctrlClass: comboCtrl?.className.substring(0, 80),
          ctrlDisabled: comboCtrl?.classList.contains('cl-disabled'),
        };
      }
    }
    return { clicked: false };
  });
  console.log('드롭다운 클릭:', JSON.stringify(dropdownResult));
  await sleep(1000);

  // 드롭다운 열린 후 옵션 확인
  const options = await page.evaluate(() => {
    // cl-list-item, cl-item 등 리스트 아이템 찾기
    const listItems = [...document.querySelectorAll('[class*="cl-list-item"],[class*="cl-popup"] [class*="cl-item"],[class*="cl-dropdown"] div')]
      .filter(el => el.getBoundingClientRect().height > 0)
      .map(el => ({
        tag: el.tagName,
        text: (el.innerText||'').trim(),
        class: el.className.substring(0, 60),
        visible: el.getBoundingClientRect().height > 0,
      }))
      .filter(el => el.text.length > 0 && el.text.length < 30);

    return listItems.slice(0, 20);
  });
  console.log('\n드롭다운 옵션:', JSON.stringify(options, null, 2));

  // "다음 집행정보 보기" 버튼 찾기
  const nextBtn = await page.evaluate(() => {
    const btns = [...document.querySelectorAll('div,button,a')].filter(el => {
      const t = (el.innerText||'').trim();
      return t === '다음 집행정보 보기' || t === '이전 집행정보 보기';
    });
    return btns.map(b => ({
      text: b.innerText.trim(),
      class: b.className.substring(0, 60),
      visible: b.getBoundingClientRect().width > 0,
    }));
  });
  console.log('\n이전/다음 버튼:', JSON.stringify(nextBtn, null, 2));

  await b.close();
})().catch(e => console.error('ERROR:', e.message));
