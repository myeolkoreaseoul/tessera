/**
 * 보탬e 검증검토 의견등록 화면 상세 분석
 * - textarea 부모 맥락 파악
 * - 상태 선택 UI (적정/보완요청 등) 확인
 * - 저장 버튼 위치 확인
 */
const { chromium } = require('playwright');
const fs = require('fs');
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

(async () => {
  const b = await chromium.connectOverCDP('http://localhost:9445', { timeout: 10000 });
  const page = b.contexts()[0].pages().find(p => p.url().includes('lss.do'));
  if (!page) { console.error('lss.do 탭 없음'); process.exit(1); }

  // "검증검토 의견등록(민간회계사)" 탭 클릭
  const tabResult = await page.evaluate(() => {
    const tabs = [...document.querySelectorAll('div')].filter(el => {
      const t = (el.innerText || '').trim();
      return t === '검증검토 의견등록(민간회계사)' && el.getBoundingClientRect().width > 0;
    });
    if (tabs.length > 0) {
      tabs[0].click();
      return `탭 클릭: "${tabs[0].innerText.trim()}"`;
    }
    return '탭 없음';
  });
  console.log('탭 클릭:', tabResult);
  await sleep(2000);

  // 의견등록 화면 전체 분석
  const ui = await page.evaluate(() => {
    const text = document.body.innerText;

    // textarea 부모 컨텍스트 분석
    const textareas = [...document.querySelectorAll('textarea')].map((ta, idx) => {
      let parent = ta.parentElement;
      const parents = [];
      for (let i = 0; i < 5 && parent; i++) {
        parents.push({
          tag: parent.tagName,
          class: parent.className.substring(0, 60),
          text: (parent.innerText || '').substring(0, 100).replace(/\n/g, '|'),
        });
        parent = parent.parentElement;
      }
      return {
        idx,
        class: ta.className,
        placeholder: ta.placeholder,
        value: ta.value.substring(0, 50),
        parents,
      };
    });

    // 모든 cl-* 요소 중 선택 관련 찾기 (cl-select, cl-combo, cl-radio 등)
    const selectEls = [...document.querySelectorAll('[class*="cl-select"],[class*="cl-combo"],[class*="cl-radio"],[class*="cl-check"]')]
      .filter(el => el.getBoundingClientRect().width > 0)
      .map(el => ({
        tag: el.tagName,
        class: el.className.substring(0, 80),
        text: (el.innerText || '').trim().substring(0, 50),
        id: el.id,
      }));

    // 버튼 중 저장/확인/적정/보완 관련
    const actionBtns = [...document.querySelectorAll('div,button,a,span')].filter(el => {
      const t = (el.innerText || '').trim();
      const r = el.getBoundingClientRect();
      return r.width > 0 && el.childElementCount === 0 && (
        t === '저장' || t === '확인' || t === '적정' || t === '보완요청' || t === '검토의견저장' ||
        t === '의견저장' || t.includes('저장') || t.includes('등록') || t === '검토완료'
      );
    }).map(el => ({
      tag: el.tagName,
      text: (el.innerText || '').trim(),
      class: el.className.substring(0, 60),
      id: el.id,
      rect: el.getBoundingClientRect(),
    }));

    // 페이지 전체 텍스트에서 중요 섹션 추출
    const fullText = text.substring(0, 2000).replace(/\n+/g, '\n');

    // 숨겨진 select/input 도 포함
    const allInputs = [...document.querySelectorAll('input,select')].map(el => ({
      tag: el.tagName,
      type: el.type || '',
      id: el.id,
      name: el.name,
      class: el.className.substring(0, 60),
      value: (el.value || '').substring(0, 30),
      checked: el.checked,
      options: el.tagName === 'SELECT' ? [...el.options].map(o => `${o.value}:${o.text}`) : undefined,
    }));

    return { textareas, selectEls, actionBtns, fullText, allInputs };
  });

  console.log('\n=== textarea 분석 ===');
  ui.textareas.forEach((ta, i) => {
    console.log(`\ntextarea[${i}]:`);
    console.log('  class:', ta.class);
    console.log('  placeholder:', ta.placeholder);
    ta.parents.forEach((p, pi) => console.log(`  parent[${pi}]: ${p.tag}.${p.class} | "${p.text.substring(0,60)}"`));
  });

  console.log('\n=== 선택 요소 ===');
  ui.selectEls.forEach(el => console.log(`  [${el.tag}] class="${el.class}" text="${el.text}" id="${el.id}"`));

  console.log('\n=== 액션 버튼 ===');
  ui.actionBtns.forEach(b => console.log(`  [${b.tag}] "${b.text}" class="${b.class}" id="${b.id}"`));

  console.log('\n=== 모든 input/select ===');
  ui.allInputs.forEach(el => {
    if (el.tag === 'SELECT') {
      console.log(`  SELECT name="${el.name}" id="${el.id}": ${(el.options||[]).join(', ')}`);
    } else {
      console.log(`  INPUT type="${el.type}" name="${el.name}" id="${el.id}" val="${el.value}" checked=${el.checked}`);
    }
  });

  console.log('\n=== 페이지 텍스트 (앞 2000자) ===');
  console.log(ui.fullText);

  fs.writeFileSync('/tmp/botem-review-ui2.json', JSON.stringify(ui, null, 2));
  console.log('\n저장: /tmp/botem-review-ui2.json');

  await b.close();
})().catch(e => console.error('ERROR:', e.message));
