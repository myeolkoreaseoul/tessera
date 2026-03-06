/**
 * Playwright 직접 클릭으로 콤보박스 옵션 확인
 */
const { chromium } = require('playwright');
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

(async () => {
  const b = await chromium.connectOverCDP('http://localhost:9445', { timeout: 10000 });
  const page = b.contexts()[0].pages().find(p => p.url().includes('lss.do'));
  if (!page) { console.error('lss.do 탭 없음'); process.exit(1); }

  // 검증검토 의견등록 탭이 활성화되어 있는지 확인
  const currentTab = await page.evaluate(() => {
    const selected = document.querySelector('.cl-tabfolder-item.cl-selected');
    return (selected?.innerText || '').trim();
  });
  console.log('현재 탭:', currentTab);

  // 현재 건 정보 확인
  const currentInfo = await page.evaluate(() => {
    const text = document.body.innerText;
    const purposeMatch = text.match(/집행목적\(용도\)\n(.+)/);
    const statusMatch = text.match(/검토진행상태\n(.+)/);
    return {
      purpose: purposeMatch?.[1]?.trim().substring(0, 60),
      reviewStatus: statusMatch?.[1]?.trim(),
    };
  });
  console.log('현재 건:', JSON.stringify(currentInfo));

  // 검토진행상태 콤보박스를 Playwright로 직접 클릭
  // scrollIntoView 후 클릭
  await page.evaluate(() => {
    const combo = document.querySelector('#uuid-ff080215-bc5c-b208-cb86-90f50f7353a0');
    if (combo) combo.scrollIntoView({ block: 'center' });
  });
  await sleep(500);

  // 콤보박스 버튼 클릭
  const comboBtn = await page.$('#uuid-ff080215-bc5c-b208-cb86-90f50f7353a0 .cl-combobox-button');
  if (comboBtn) {
    await comboBtn.click();
    console.log('콤보박스 버튼 클릭 (Playwright)');
  } else {
    // UUID로 콤보박스 전체 클릭
    const combo = await page.$('#uuid-ff080215-bc5c-b208-cb86-90f50f7353a0');
    if (combo) {
      await combo.click();
      console.log('콤보박스 전체 클릭');
    } else {
      console.log('콤보박스 없음 - 검토 섹션의 콤보박스 버튼 클릭 시도');
      // 검토 섹션에서 콤보박스 버튼 찾기
      await page.evaluate(() => {
        const layouts = [...document.querySelectorAll('.cl-layout')].filter(el =>
          (el.innerText||'').includes('검토진행상태') && (el.innerText||'').includes('검증검토의견')
        );
        if (layouts.length > 0) {
          const btn = layouts[0].querySelector('.cl-combobox-button');
          if (btn) btn.click();
        }
      });
    }
  }
  await sleep(1000);

  // 드롭다운 옵션 캡처
  const options = await page.evaluate(() => {
    // 새로 생긴 cl-list, cl-popup, cl-dropdown 요소 찾기
    const popups = [...document.querySelectorAll('[class*="cl-popup"],[class*="cl-dropdown-list"],[class*="cl-list"]')]
      .filter(el => el.getBoundingClientRect().height > 0);

    const allVisible = [...document.querySelectorAll('*')].filter(el => {
      const r = el.getBoundingClientRect();
      return r.width > 5 && r.height > 5 && r.y > 0 && el.childElementCount === 0;
    });

    // 화면에 새로 나타난 짧은 텍스트 요소들 (드롭다운 옵션 후보)
    const shortTexts = allVisible
      .map(el => ({ tag: el.tagName, text: (el.innerText||'').trim(), class: el.className.substring(0,60) }))
      .filter(el => el.text.length > 0 && el.text.length < 20);

    return {
      popupCount: popups.length,
      popups: popups.map(p => ({ class: p.className.substring(0,60), text: (p.innerText||'').substring(0,100) })),
      shortTexts: shortTexts.slice(0, 30),
    };
  });
  console.log('\n드롭다운 열린 후 팝업:', JSON.stringify(options.popups, null, 2));
  console.log('\n짧은 텍스트 요소:', options.shortTexts.map(t => `"${t.text}" [${t.tag}:${t.class.substring(0,40)}]`).join('\n  '));

  // Escape로 드롭다운 닫기
  await page.keyboard.press('Escape');

  await b.close();
})().catch(e => console.error('ERROR:', e.message));
