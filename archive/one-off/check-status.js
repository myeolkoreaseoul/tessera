/**
 * 현재 열린 건의 검토진행상태 + 의견 확인 (저장 안 함)
 * 그리고 저장 버튼 클릭 후 뜨는 팝업 캡처만 함 (팝업 닫지 않음)
 */
const { chromium } = require('playwright');
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

(async () => {
  const b = await chromium.connectOverCDP('http://localhost:9445', { timeout: 10000 });
  const page = b.contexts()[0].pages().find(p => p.url().includes('lss.do'));
  if (!page) { console.error('lss.do 탭 없음'); process.exit(1); }

  // 현재 건 정보 + 검토상태 + 의견
  const info = await page.evaluate(() => {
    const text = document.body.innerText;
    const purposeM = text.match(/집행목적\(용도\)\n(.+)/);

    // 검토진행상태 콤보박스 현재 값
    const layouts = [...document.querySelectorAll('.cl-layout')].filter(el => {
      const t = (el.innerText || '');
      return t.includes('검토진행상태') && t.includes('검증검토의견');
    });
    let comboValue = '';
    let textareaValue = '';
    if (layouts.length > 0) {
      const layout = layouts[layouts.length - 1];
      const combo = layout.querySelector('.cl-combobox:not(.cl-disabled)');
      if (combo) {
        const textEl = combo.querySelector('.cl-text:not(.cl-placeholder)');
        comboValue = (textEl?.innerText || '').trim();
      }
      const ta = layout.querySelector('textarea.cl-text');
      if (ta) textareaValue = ta.value;
    }

    // 전체 텍스트에서 검토진행상태 부분
    const statusSection = text.substring(
      Math.max(0, text.indexOf('검토진행상태') - 50),
      Math.min(text.length, text.indexOf('검토진행상태') + 200)
    );

    return {
      purpose: (purposeM?.[1] || '').trim().substring(0, 60),
      comboValue,
      textareaValue: textareaValue.substring(0, 100),
      statusSection: statusSection.replace(/\n/g, ' | '),
    };
  });

  console.log('현재 건:', info.purpose);
  console.log('콤보박스 값:', JSON.stringify(info.comboValue));
  console.log('텍스트에어리어:', JSON.stringify(info.textareaValue));
  console.log('상태 섹션:', info.statusSection);

  await b.close();
})().catch(e => console.error('ERROR:', e.message));
