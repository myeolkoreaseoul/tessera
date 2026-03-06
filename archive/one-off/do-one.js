/**
 * 보탬e 현재 건 1건 전체 워크플로우:
 * 1. 현재 건 정보 확인
 * 2. 검토의견 입력 필드 찾기 (cl 프레임워크)
 * 3. 의견 입력
 * 4. 저장
 * 5. 다음 이동
 */
const { chromium } = require('playwright');
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

const ACTION = process.argv[2] || 'check'; // check, input, save, next
const OPINION = process.argv[3] || '';
const STATUS_CODE = process.argv[4] || ''; // 001=검토완료, 002=보완요청

(async () => {
  const b = await chromium.connectOverCDP('http://100.87.3.123:9445', { timeout: 10000 });
  const page = b.contexts()[0].pages().find(p => p.url().includes('lss.do'));
  if (!page) { console.error('lss.do 탭 없음'); process.exit(1); }

  // 팝업 정리
  await page.evaluate(() => {
    [...document.querySelectorAll('*')].filter(el => {
      const t = (el.innerText || '').trim();
      const r = el.getBoundingClientRect();
      return (t === '확인' || t === '닫기') && r.width > 0 && r.width < 200 && el.childElementCount === 0;
    }).forEach(el => el.click());
  });
  await sleep(300);

  if (ACTION === 'check') {
    // DOM 분석: 모든 입력 필드 찾기
    const fields = await page.evaluate(() => {
      const result = {};

      // 1. cl-output 요소들 (읽기전용 표시 필드)
      const outputs = [...document.querySelectorAll('[class*="cl-output"]')].map(el => ({
        id: el.id,
        text: (el.innerText || '').trim().substring(0, 80),
        cls: el.className.substring(0, 60),
      })).filter(x => x.text.length > 0);

      // 2. cl-input 요소들 (입력 가능 필드)
      const inputs = [...document.querySelectorAll('[class*="cl-input"], [class*="cl-textarea"]')].map(el => {
        const r = el.getBoundingClientRect();
        return {
          id: el.id,
          tag: el.tagName,
          cls: el.className.substring(0, 80),
          w: Math.round(r.width),
          h: Math.round(r.height),
          value: (el.value || el.innerText || '').substring(0, 50),
          ndid: el.getAttribute('data-ndid') || '',
        };
      }).filter(x => x.w > 50);

      // 3. select/combobox (cl-select, cl-combo)
      const selects = [...document.querySelectorAll('[class*="cl-select"], [class*="cl-combo"]')].map(el => {
        const r = el.getBoundingClientRect();
        return {
          id: el.id,
          cls: el.className.substring(0, 80),
          w: Math.round(r.width),
          text: (el.innerText || '').trim().substring(0, 50),
          ndid: el.getAttribute('data-ndid') || '',
        };
      }).filter(x => x.w > 30);

      // 4. 검증검토의견 영역 찾기
      const opinionLabels = [...document.querySelectorAll('*')].filter(el =>
        el.childElementCount === 0 && (el.innerText || '').trim() === '검증검토의견'
      );
      const statusLabels = [...document.querySelectorAll('*')].filter(el =>
        el.childElementCount === 0 && (el.innerText || '').trim() === '검토진행상태'
      );

      // 레이블 주변의 입력필드
      const findNearbyInput = (label) => {
        if (!label) return null;
        let p = label.parentElement;
        for (let i = 0; i < 5 && p; i++) {
          const inputEls = p.querySelectorAll('[class*="cl-input"], [class*="cl-textarea"], textarea, input');
          if (inputEls.length > 0) {
            const el = inputEls[0];
            return {
              id: el.id,
              tag: el.tagName,
              cls: el.className.substring(0, 80),
              ndid: el.getAttribute('data-ndid') || '',
              value: (el.value || el.innerText || '').substring(0, 50),
            };
          }
          // cl-control (편집 가능한 div)
          const ctrlEls = p.querySelectorAll('[class*="cl-control"]:not([class*="cl-output"])');
          for (const ctrl of ctrlEls) {
            if (ctrl.querySelector('[contenteditable]') || ctrl.getAttribute('contenteditable')) {
              return { id: ctrl.id, tag: 'contenteditable', cls: ctrl.className.substring(0, 80) };
            }
          }
          p = p.parentElement;
        }
        return null;
      };

      const findNearbySelect = (label) => {
        if (!label) return null;
        let p = label.parentElement;
        for (let i = 0; i < 5 && p; i++) {
          const selEls = p.querySelectorAll('[class*="cl-select"], [class*="cl-combo"], select');
          if (selEls.length > 0) {
            const el = selEls[0];
            return {
              id: el.id,
              cls: el.className.substring(0, 80),
              ndid: el.getAttribute('data-ndid') || '',
              text: (el.innerText || '').trim().substring(0, 50),
            };
          }
          p = p.parentElement;
        }
        return null;
      };

      result.opinionInput = findNearbyInput(opinionLabels[0]);
      result.statusSelect = findNearbySelect(statusLabels[0]);
      result.inputCount = inputs.length;
      result.selectCount = selects.length;
      result.inputs = inputs.slice(0, 10);
      result.selects = selects.slice(0, 10);

      return result;
    });

    console.log('=== 입력 필드 분석 ===');
    console.log(JSON.stringify(fields, null, 2));

    // 전체 페이지 스크린샷 (스크롤 포함)
    await page.evaluate(() => window.scrollTo(0, 500));
    await sleep(300);
    await page.screenshot({ path: '/tmp/botem-scrolled.png' });
    console.log('\n스크린샷: /tmp/botem-scrolled.png');
  }

  if (ACTION === 'input') {
    // 의견 입력 + 상태 설정
    console.log('의견 입력:', OPINION.substring(0, 50) + '...');
    console.log('상태:', STATUS_CODE);

    const result = await page.evaluate(({ opinion, statusCode }) => {
      const log = [];

      // 1. 검토진행상태 드롭다운 설정
      const statusLabels = [...document.querySelectorAll('*')].filter(el =>
        el.childElementCount === 0 && (el.innerText || '').trim() === '검토진행상태'
      );
      if (statusLabels.length > 0) {
        let p = statusLabels[0].parentElement;
        for (let i = 0; i < 8 && p; i++) {
          // cl-combo or cl-select 찾기
          const combo = p.querySelector('[class*="cl-combo"], [class*="cl-select"]');
          if (combo) {
            // cl 프레임워크: 클릭하여 드롭다운 열기
            combo.click();
            log.push('combo 클릭: ' + combo.id);
            break;
          }
          p = p.parentElement;
        }
      }

      // 2. 검증검토의견 텍스트 입력
      const opLabels = [...document.querySelectorAll('*')].filter(el =>
        el.childElementCount === 0 && (el.innerText || '').trim() === '검증검토의견'
      );
      if (opLabels.length > 0) {
        let p = opLabels[0].parentElement;
        for (let i = 0; i < 8 && p; i++) {
          const textarea = p.querySelector('textarea');
          const input = p.querySelector('[class*="cl-input"] input, [class*="cl-textarea"] textarea, input[type="text"]');
          const target = textarea || input;
          if (target) {
            target.focus();
            target.value = opinion;
            target.dispatchEvent(new Event('input', { bubbles: true }));
            target.dispatchEvent(new Event('change', { bubbles: true }));
            log.push('의견 입력 완료: ' + target.tagName + '#' + target.id);
            break;
          }
          p = p.parentElement;
        }
      }

      return log;
    }, { opinion: OPINION, statusCode: STATUS_CODE });

    console.log('결과:', result);
    await sleep(500);
    await page.screenshot({ path: '/tmp/botem-input.png' });
    console.log('스크린샷: /tmp/botem-input.png');
  }

  if (ACTION === 'save') {
    // 저장 버튼 클릭
    await page.evaluate(() => {
      const btns = [...document.querySelectorAll('*')].filter(el => {
        const t = (el.innerText || '').trim();
        return (t === '저장' || t === '✓ 저장') && el.getBoundingClientRect().width > 0 && el.childElementCount <= 2;
      });
      // 마지막 버튼이 보통 저장 버튼
      if (btns.length > 0) btns[btns.length - 1].click();
    });
    console.log('저장 클릭');
    await sleep(2000);
    await page.screenshot({ path: '/tmp/botem-save-result.png' });
    // 확인 팝업
    await page.evaluate(() => {
      [...document.querySelectorAll('*')].filter(el => {
        const t = (el.innerText || '').trim();
        return t === '확인' && el.getBoundingClientRect().width > 0 && el.getBoundingClientRect().width < 200 && el.childElementCount === 0;
      }).forEach(el => el.click());
    });
    await sleep(300);
    console.log('저장 완료');
  }

  if (ACTION === 'next') {
    await page.evaluate(() => {
      const btns = [...document.querySelectorAll('*')].filter(el => {
        const t = (el.innerText || '').trim();
        return t.includes('다음') && t.includes('집행정보') && el.getBoundingClientRect().width > 0 && el.childElementCount === 0;
      });
      if (btns[0]) btns[0].click();
    });
    await sleep(1500);
    await page.evaluate(() => {
      [...document.querySelectorAll('*')].filter(el => {
        const t = (el.innerText || '').trim();
        return t === '확인' && el.getBoundingClientRect().width > 0 && el.getBoundingClientRect().width < 200 && el.childElementCount === 0;
      }).forEach(el => el.click());
    });
    await sleep(300);
    const newPurpose = await page.evaluate(() => {
      const m = document.body.innerText.match(/집행목적\(용도\)\n(.+)/);
      return (m && m[1]) ? m[1].trim() : '';
    });
    console.log('다음 건:', newPurpose);
  }

  await b.close();
})().catch(e => console.error('ERROR:', e.message));
