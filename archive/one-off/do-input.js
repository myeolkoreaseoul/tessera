// 보탬e cl 프레임워크 의견 입력 — 구체적 요소 ID 사용
const { chromium } = require('playwright');
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

const ACTION = process.argv[2] || 'scroll'; // scroll, dropdown, type, save, next
const OPINION = process.argv[3] || '';

(async () => {
  const b = await chromium.connectOverCDP('http://100.87.3.123:9445', { timeout: 10000 });
  const page = b.contexts()[0].pages().find(p => p.url().includes('lss.do'));
  if (!page) { console.error('lss.do 탭 없음'); process.exit(1); }

  // 팝업 정리
  await page.evaluate(() => {
    [...document.querySelectorAll('*')].filter(el => {
      const t = (el.innerText || '').trim();
      return (t === '확인' || t === '닫기') && el.getBoundingClientRect().width > 0 && el.getBoundingClientRect().width < 200 && el.childElementCount === 0;
    }).forEach(el => el.click());
  });
  await sleep(200);

  if (ACTION === 'scroll') {
    // 검증검토의견 영역으로 스크롤
    await page.evaluate(() => {
      const el = document.querySelector('#uuid-3dfa44b1-e152-5ebf-9422-484468dead05');
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
    await sleep(500);
    await page.screenshot({ path: '/tmp/botem-opinion-area.png' });
    console.log('스크린샷: /tmp/botem-opinion-area.png');

    // 현재 건 정보
    const purpose = await page.evaluate(() => {
      const m = document.body.innerText.match(/집행목적\(용도\)\n(.+)/);
      return (m && m[1]) ? m[1].trim() : '';
    });
    console.log('현재 건:', purpose);
  }

  if (ACTION === 'dropdown') {
    // 검토진행상태 드롭다운 열기 + 옵션 확인
    const comboId = 'uuid-7022e960-056a-09a3-1747-cb0c0d2a33c2';

    // 먼저 드롭다운 클릭
    const clicked = await page.evaluate((id) => {
      const el = document.getElementById(id);
      if (!el) return { ok: false, msg: 'element not found' };
      // cl-combobox: 내부의 클릭 영역 찾기
      const btn = el.querySelector('[class*="cl-icon"]') || el.querySelector('[class*="cl-arrow"]') || el;
      btn.click();
      return { ok: true, cls: el.className.substring(0, 80) };
    }, comboId);
    console.log('드롭다운 클릭:', JSON.stringify(clicked));

    await sleep(500);
    await page.screenshot({ path: '/tmp/botem-dropdown.png' });

    // 드롭다운 옵션 확인
    const options = await page.evaluate(() => {
      // cl 프레임워크 드롭다운: floating div
      const lists = [...document.querySelectorAll('[class*="cl-list"], [class*="cl-dropdown"], [class*="cl-float"]')];
      const items = [];
      for (const list of lists) {
        const r = list.getBoundingClientRect();
        if (r.width > 50 && r.height > 0) {
          const children = [...list.querySelectorAll('[class*="cl-item"], [class*="cl-list-item"], div')];
          children.forEach(c => {
            const t = (c.innerText || '').trim();
            if (t.length > 0 && t.length < 30) items.push(t);
          });
        }
      }
      // 팝업/오버레이 확인
      const overlays = [...document.querySelectorAll('[style*="z-index"]')].filter(el => {
        const r = el.getBoundingClientRect();
        return r.width > 50 && r.height > 20 && parseInt(getComputedStyle(el).zIndex) > 100;
      });
      overlays.forEach(o => {
        const t = (o.innerText || '').trim();
        if (t.length > 0 && t.length < 200) items.push('overlay: ' + t);
      });
      return items;
    });
    console.log('옵션:', options);
  }

  if (ACTION === 'select') {
    // 드롭다운에서 "보완요청" 선택
    const comboId = 'uuid-7022e960-056a-09a3-1747-cb0c0d2a33c2';
    const targetText = OPINION || '보완요청';

    // cl-combobox 클릭하여 열기
    await page.evaluate((id) => {
      const el = document.getElementById(id);
      if (el) el.click();
    }, comboId);
    await sleep(500);

    // 옵션 선택
    const selected = await page.evaluate((target) => {
      const items = [...document.querySelectorAll('*')].filter(el => {
        const t = (el.innerText || '').trim();
        const r = el.getBoundingClientRect();
        return t === target && r.width > 0 && el.childElementCount === 0;
      });
      if (items.length > 0) {
        items[0].click();
        return { ok: true, text: target };
      }
      // 부분 매칭
      const partial = [...document.querySelectorAll('*')].filter(el => {
        const t = (el.innerText || '').trim();
        const r = el.getBoundingClientRect();
        return t.includes(target) && r.width > 0 && r.width < 300 && el.childElementCount === 0;
      });
      if (partial.length > 0) {
        partial[0].click();
        return { ok: true, text: (partial[0].innerText || '').trim() };
      }
      return { ok: false };
    }, targetText);
    console.log('선택:', JSON.stringify(selected));
    await sleep(300);
    await page.screenshot({ path: '/tmp/botem-selected.png' });
  }

  if (ACTION === 'type') {
    // 검증검토의견 텍스트 입력
    const textareaId = 'uuid-3dfa44b1-e152-5ebf-9422-484468dead05';

    // cl-textarea: 내부 textarea 또는 contenteditable 찾기
    const typed = await page.evaluate(({ id, text }) => {
      const container = document.getElementById(id);
      if (!container) return { ok: false, msg: 'container not found' };

      // 방법1: 내부 textarea
      const ta = container.querySelector('textarea');
      if (ta) {
        ta.focus();
        ta.value = text;
        ta.dispatchEvent(new Event('input', { bubbles: true }));
        ta.dispatchEvent(new Event('change', { bubbles: true }));
        return { ok: true, method: 'textarea', id: ta.id };
      }

      // 방법2: 내부 contenteditable div
      const ce = container.querySelector('[contenteditable="true"]');
      if (ce) {
        ce.focus();
        ce.innerText = text;
        ce.dispatchEvent(new Event('input', { bubbles: true }));
        return { ok: true, method: 'contenteditable' };
      }

      // 방법3: cl-textarea-wrap 내부
      const wrap = container.querySelector('.cl-textarea-wrap');
      if (wrap) {
        // textarea-wrap 안의 실제 입력 요소
        const inner = wrap.querySelector('textarea, [contenteditable], input');
        if (inner) {
          inner.focus();
          if (inner.tagName === 'TEXTAREA' || inner.tagName === 'INPUT') {
            inner.value = text;
          } else {
            inner.innerText = text;
          }
          inner.dispatchEvent(new Event('input', { bubbles: true }));
          inner.dispatchEvent(new Event('change', { bubbles: true }));
          return { ok: true, method: 'wrap-inner', tag: inner.tagName };
        }
      }

      // 방법4: 컨테이너 자체에 focus + Keyboard
      container.click();
      return { ok: false, msg: 'no editable element found', html: container.innerHTML.substring(0, 300) };
    }, { id: textareaId, text: OPINION });

    console.log('입력 결과:', JSON.stringify(typed));

    if (!typed.ok) {
      // Playwright keyboard로 직접 입력 시도
      console.log('Playwright keyboard 입력 시도...');
      await page.click(`#${textareaId}`);
      await sleep(300);
      // 기존 텍스트 지우기
      await page.keyboard.down('Control');
      await page.keyboard.press('a');
      await page.keyboard.up('Control');
      await page.keyboard.press('Backspace');
      await sleep(100);
      await page.keyboard.type(OPINION, { delay: 10 });
      console.log('keyboard 입력 완료');
    }

    await sleep(300);
    await page.screenshot({ path: '/tmp/botem-typed.png' });
    console.log('스크린샷: /tmp/botem-typed.png');
  }

  if (ACTION === 'save') {
    // 저장
    await page.evaluate(() => {
      const btns = [...document.querySelectorAll('*')].filter(el => {
        const t = (el.innerText || '').trim();
        return (t === '저장' || t.includes('저장')) && el.getBoundingClientRect().width > 50 && el.childElementCount <= 2;
      });
      const saveBtn = btns.find(b => {
        const r = b.getBoundingClientRect();
        return r.y > 400; // 하단에 있는 저장 버튼
      }) || btns[btns.length - 1];
      if (saveBtn) saveBtn.click();
    });
    console.log('저장 클릭');
    await sleep(2000);
    await page.screenshot({ path: '/tmp/botem-save.png' });
    console.log('저장 후 스크린샷: /tmp/botem-save.png');

    // 확인 팝업
    await page.evaluate(() => {
      [...document.querySelectorAll('*')].filter(el => {
        const t = (el.innerText || '').trim();
        return t === '확인' && el.getBoundingClientRect().width > 0 && el.getBoundingClientRect().width < 200 && el.childElementCount === 0;
      }).forEach(el => el.click());
    });
    await sleep(500);
  }

  if (ACTION === 'next') {
    await page.evaluate(() => {
      [...document.querySelectorAll('*')].filter(el => {
        const t = (el.innerText || '').trim();
        return t.includes('다음') && t.includes('집행정보') && el.getBoundingClientRect().width > 0 && el.childElementCount === 0;
      }).forEach(el => el.click());
    });
    await sleep(1500);
    await page.evaluate(() => {
      [...document.querySelectorAll('*')].filter(el => {
        const t = (el.innerText || '').trim();
        return t === '확인' && el.getBoundingClientRect().width > 0 && el.getBoundingClientRect().width < 200 && el.childElementCount === 0;
      }).forEach(el => el.click());
    });
    await sleep(300);
    const newP = await page.evaluate(() => {
      const m = document.body.innerText.match(/집행목적\(용도\)\n(.+)/);
      return (m && m[1]) ? m[1].trim() : '';
    });
    console.log('다음 건:', newP);
    await page.screenshot({ path: '/tmp/botem-next.png' });
  }

  await b.close();
})().catch(e => console.error('ERROR:', e.message));
