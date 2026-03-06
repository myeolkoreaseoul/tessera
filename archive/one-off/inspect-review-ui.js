/**
 * 보탬e 집행내역 상세 → 검토 입력 UI 구조 파악
 * 첫 번째 건(rn=2, 미검토)을 클릭해서 검토 화면 구조 확인
 */
const { chromium } = require('playwright');
const fs = require('fs');
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

(async () => {
  const b = await chromium.connectOverCDP('http://localhost:9445', { timeout: 10000 });
  const page = b.contexts()[0].pages().find(p => p.url().includes('lss.do'));
  if (!page) { console.error('lss.do 탭 없음'); process.exit(1); }

  // 현재 페이지 상태 확인
  const state = await page.evaluate(() => {
    const text = document.body.innerText;
    return {
      hasListMarker: text.includes('집행내역 목록'),
      hasTotal: /총\s*\n?\s*\d+\s*\n?\s*건/.test(text),
      url: location.href.substring(0, 80),
      bodyStart: text.substring(0, 150).replace(/\n/g, '|'),
    };
  });
  console.log('현재 상태:', JSON.stringify(state, null, 2));

  // 목록에서 첫 번째 미검토 행 찾기 (클릭해서 상세 진입)
  const clickResult = await page.evaluate(() => {
    // 테이블 행들을 찾아서 첫 번째 미검토 행 클릭
    const rows = [...document.querySelectorAll('div[class*="cl-row"], tr, .cl-grid-row')];
    console.log('행 수:', rows.length);

    // innerText에 "미검토"가 포함된 첫 번째 행 클릭
    const targetRow = rows.find(r => (r.innerText || '').includes('미검토'));
    if (targetRow) {
      // 행 내의 클릭 가능한 요소 찾기
      const clickable = targetRow.querySelector('a, [onclick], div[class*="cl-link"]');
      if (clickable) {
        clickable.click();
        return `클릭: ${clickable.tagName} ${clickable.className} "${(clickable.innerText||'').substring(0,30)}"`;
      }
      // 직접 행 클릭
      targetRow.click();
      return `행 클릭: ${targetRow.tagName} "${(targetRow.innerText||'').substring(0,50)}"`;
    }
    return '미검토 행 없음';
  });
  console.log('클릭 결과:', clickResult);
  await sleep(3000);

  // 상세 페이지 구조 분석
  const detail = await page.evaluate(() => {
    const text = document.body.innerText;

    // 모든 선택 가능한 요소 (드롭다운, 라디오 등)
    const selects = [...document.querySelectorAll('select')].map(s => ({
      id: s.id, name: s.name, class: s.className.substring(0, 50),
      options: [...s.options].map(o => o.text).slice(0, 10),
    }));

    // 텍스트에어리어
    const textareas = [...document.querySelectorAll('textarea')].map(t => ({
      id: t.id, name: t.name, class: t.className.substring(0, 50),
      placeholder: t.placeholder,
      value: t.value.substring(0, 50),
    }));

    // 버튼들
    const btns = [...document.querySelectorAll('div,button,a')].filter(el => {
      const r = el.getBoundingClientRect();
      const t = (el.innerText || '').trim();
      return r.width > 0 && t.length > 0 && t.length < 20 && el.childElementCount === 0;
    }).map(el => ({
      tag: el.tagName,
      text: (el.innerText || '').trim(),
      class: el.className.substring(0, 50),
      id: el.id,
    }));

    // 라디오 버튼
    const radios = [...document.querySelectorAll('input[type="radio"]')].map(r => ({
      id: r.id, name: r.name, value: r.value, checked: r.checked,
      labelText: r.parentElement?.innerText?.trim().substring(0, 30),
    }));

    // 검토 관련 키워드 포함 요소
    const reviewEls = [...document.querySelectorAll('*')].filter(el => {
      const t = (el.innerText || '').trim();
      return el.childElementCount === 0 && (
        t.includes('적정') || t.includes('보완') || t.includes('검토의견') || t.includes('검토결과')
      ) && t.length < 50;
    }).map(el => ({
      tag: el.tagName,
      text: el.innerText.trim(),
      class: el.className.substring(0, 50),
      id: el.id,
    })).slice(0, 20);

    return {
      url: location.href.substring(0, 100),
      pageText: text.substring(0, 300).replace(/\n/g, '|'),
      selects,
      textareas,
      btns: btns.slice(0, 30),
      radios,
      reviewEls,
    };
  });

  console.log('\n=== 상세 페이지 구조 ===');
  console.log('URL:', detail.url);
  console.log('텍스트 시작:', detail.pageText);
  console.log('\nSelects:', JSON.stringify(detail.selects, null, 2));
  console.log('\nTextareas:', JSON.stringify(detail.textareas, null, 2));
  console.log('\n라디오:', JSON.stringify(detail.radios, null, 2));
  console.log('\n검토관련 요소:', JSON.stringify(detail.reviewEls, null, 2));
  console.log('\n버튼들:', detail.btns.map(b => `[${b.tag}] "${b.text}" id=${b.id} class=${b.class}`).join('\n  '));

  fs.writeFileSync('/tmp/botem-review-ui.json', JSON.stringify(detail, null, 2));
  console.log('\n저장: /tmp/botem-review-ui.json');

  await b.close();
})().catch(e => console.error('ERROR:', e.message));
