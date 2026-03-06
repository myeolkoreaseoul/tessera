// 보탬e 현재 건: 상태 확인 → 의견 입력 → 저장 → 다음
const { chromium } = require('playwright');
const fs = require('fs');
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

const OPINION = process.argv[2] || '';
const STATUS = process.argv[3] || ''; // 적정 or 보완요청
const MODE = process.argv[4] || 'check'; // check, save, next

(async () => {
  const b = await chromium.connectOverCDP('http://100.87.3.123:9445', { timeout: 10000 });
  const ctx = b.contexts()[0];
  const page = ctx.pages().find(p => p.url().includes('lss.do'));
  if (!page) { console.error('lss.do 탭 없음'); process.exit(1); }

  // 팝업 닫기
  await page.evaluate(() => {
    [...document.querySelectorAll('*')].filter(el => {
      const t = (el.innerText || '').trim();
      return (t === '확인' || t === '닫기') && el.getBoundingClientRect().width > 0 &&
        el.getBoundingClientRect().width < 200 && el.childElementCount === 0;
    }).forEach(el => el.click());
  });
  await sleep(300);

  // 현재 건 정보
  const info = await page.evaluate(() => {
    const text = document.body.innerText;
    const get = (label) => {
      const m = text.match(new RegExp(label + '\\n(.+)'));
      return (m && m[1]) ? m[1].trim() : '';
    };
    return {
      purpose: get('집행목적\\(용도\\)'),
      method: get('증빙유형'),
      status: get('검토진행상태'),
      opinion: get('검증검토의견'),
      date: get('검토일자'),
      amount: get('집행합계금액'),
    };
  });

  console.log('=== 현재 건 ===');
  console.log('용도:', info.purpose);
  console.log('증빙유형:', info.method);
  console.log('검토상태:', info.status);
  console.log('기존의견:', info.opinion || '(없음)');
  console.log('금액:', info.amount);

  if (MODE === 'check') {
    await page.screenshot({ path: '/tmp/botem-review.png' });
    console.log('\n스크린샷: /tmp/botem-review.png');
    await b.close();
    return;
  }

  if (MODE === 'save' && OPINION) {
    // 1. 검토진행상태 선택
    console.log('\n=== 검토진행상태 설정 ===');
    // 검토완료 or 보완요청 드롭다운 찾기
    const statusSet = await page.evaluate((status) => {
      // cl-select 또는 select 요소 찾기
      const selects = [...document.querySelectorAll('select')];
      for (const sel of selects) {
        const opts = [...sel.options].map(o => o.text);
        if (opts.some(o => o.includes('검토완료') || o.includes('보완요청'))) {
          const target = status === '적정' ? '검토완료' : '보완요청';
          const opt = [...sel.options].find(o => o.text.includes(target));
          if (opt) {
            sel.value = opt.value;
            sel.dispatchEvent(new Event('change', { bubbles: true }));
            return { ok: true, selected: opt.text, selectId: sel.id };
          }
        }
      }
      // cl 프레임워크 select (div 기반)
      // 검토진행상태 레이블 옆의 드롭다운
      const labels = [...document.querySelectorAll('*')].filter(el =>
        el.childElementCount === 0 && (el.innerText || '').trim() === '검토진행상태'
      );
      return { ok: false, selectCount: selects.length, labelCount: labels.length };
    }, STATUS);
    console.log('상태 설정:', JSON.stringify(statusSet));

    // 2. 의견 입력
    console.log('\n=== 의견 입력 ===');
    const opinionSet = await page.evaluate((opinion) => {
      // textarea 찾기
      const textareas = [...document.querySelectorAll('textarea')];
      for (const ta of textareas) {
        if (ta.getBoundingClientRect().width > 100) {
          ta.value = opinion;
          ta.dispatchEvent(new Event('input', { bubbles: true }));
          ta.dispatchEvent(new Event('change', { bubbles: true }));
          return { ok: true, id: ta.id, name: ta.name };
        }
      }
      // cl 프레임워크 input
      const inputs = [...document.querySelectorAll('input[type="text"], input:not([type])')].filter(i => {
        const r = i.getBoundingClientRect();
        return r.width > 200;
      });
      if (inputs.length > 0) {
        // 검증검토의견 레이블 근처의 input
        const opInput = inputs.find(i => {
          const parent = i.closest('[class*="form"]');
          return parent && parent.innerText.includes('검증검토의견');
        }) || inputs[inputs.length - 1];
        opInput.value = opinion;
        opInput.dispatchEvent(new Event('input', { bubbles: true }));
        opInput.dispatchEvent(new Event('change', { bubbles: true }));
        return { ok: true, id: opInput.id, tag: 'input' };
      }
      return { ok: false, textareaCount: textareas.length, inputCount: inputs.length };
    }, OPINION);
    console.log('의견 입력:', JSON.stringify(opinionSet));

    // 스크린샷 (입력 확인)
    await page.screenshot({ path: '/tmp/botem-before-save.png' });
    console.log('입력 후 스크린샷: /tmp/botem-before-save.png');

    // 3. 저장 버튼 클릭
    console.log('\n=== 저장 ===');
    const saved = await page.evaluate(() => {
      const btns = [...document.querySelectorAll('*')].filter(el => {
        const t = (el.innerText || '').trim();
        return t === '저장' && el.getBoundingClientRect().width > 0 && el.childElementCount === 0;
      });
      if (btns.length > 0) {
        // "✓ 저장" 또는 "저장" 버튼
        const btn = btns.find(b => b.closest('[class*="btn"]')) || btns[0];
        btn.click();
        return true;
      }
      return false;
    });
    console.log('저장 클릭:', saved);

    await sleep(2000);

    // 팝업 처리 (저장 확인)
    await page.evaluate(() => {
      [...document.querySelectorAll('*')].filter(el => {
        const t = (el.innerText || '').trim();
        return t === '확인' && el.getBoundingClientRect().width > 0 &&
          el.getBoundingClientRect().width < 200 && el.childElementCount === 0;
      }).forEach(el => el.click());
    });
    await sleep(500);

    await page.screenshot({ path: '/tmp/botem-after-save.png' });
    console.log('저장 후 스크린샷: /tmp/botem-after-save.png');
  }

  if (MODE === 'next') {
    // 다음 집행정보 보기
    console.log('\n=== 다음 건 이동 ===');
    const nextClicked = await page.evaluate(() => {
      const btns = [...document.querySelectorAll('*')].filter(el => {
        const t = (el.innerText || '').trim();
        return t.includes('다음') && t.includes('집행정보') && el.getBoundingClientRect().width > 0 && el.childElementCount === 0;
      });
      if (btns[0]) { btns[0].click(); return true; }
      return false;
    });
    console.log('다음 클릭:', nextClicked);
    await sleep(1500);

    // 팝업 처리
    await page.evaluate(() => {
      [...document.querySelectorAll('*')].filter(el => {
        const t = (el.innerText || '').trim();
        return t === '확인' && el.getBoundingClientRect().width > 0 &&
          el.getBoundingClientRect().width < 200 && el.childElementCount === 0;
      }).forEach(el => el.click());
    });
    await sleep(300);

    // 새 건 정보
    const newInfo = await page.evaluate(() => {
      const text = document.body.innerText;
      const m = text.match(/집행목적\(용도\)\n(.+)/);
      return (m && m[1]) ? m[1].trim() : '';
    });
    console.log('새 건:', newInfo);
  }

  await b.close();
})().catch(e => console.error('ERROR:', e.message));
