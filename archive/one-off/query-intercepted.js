/**
 * $.ajax를 가로채서 exmntPrgstCode 강제 변경
 */
const { chromium } = require('playwright');

process.on('unhandledRejection', (err) => {
  if (err && err.message && err.message.includes('No dialog is showing')) return;
});

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function dismissModals(page) {
  await page.evaluate(() => {
    document.querySelectorAll('.popupMask.on').forEach(modal => {
      const ok = modal.querySelector('button.fn.ok, .fn.ok, footer button');
      if (ok) ok.click();
    });
  }).catch(() => {});
}

async function main() {
  console.log('=== AJAX 인터셉트 조회 ===\n');

  const browser = await chromium.connectOverCDP('http://localhost:9444');
  const context = browser.contexts()[0];
  let page = context.pages().find(p => p.url().includes('dd001'));
  if (!page) { console.log('페이지 없음'); return; }
  page.on('dialog', async d => { try { await d.accept(); } catch {} });

  await dismissModals(page);

  // CSRF 헤더 이름 확인
  const csrfHeader = await page.evaluate(() => {
    return $("meta[name='_csrf_header']").attr("content") || '';
  });
  console.log('CSRF header name:', csrfHeader);

  // 방법 1: $.ajax 패치하여 exmntPrgstCode 강제
  for (const targetFilter of ['001', '']) {
    console.log(`\n--- 필터: ${targetFilter || '전체'} ---`);

    const result = await page.evaluate((filter) => {
      return new Promise((resolve) => {
        // 원래 콜백을 가로채기
        const origCallback = window.f_retrieveCallBackDD001002Q;
        window.f_retrieveCallBackDD001002Q = function(data) {
          // 데이터 캡처
          resolve(data);
          // 원래 콜백 복원
          window.f_retrieveCallBackDD001002Q = origCallback;
        };

        // $.ajax 일시적 패치
        const origAjax = $.ajax;
        $.ajax = function(opts) {
          if (opts.url && opts.url.includes('retrieveListBsnsExcutDetl')) {
            opts.data.exmntPrgstCode = filter;
            opts.data.countPerPageNum = 50;
            // 원래 success를 래핑
            const origSuccess = opts.success;
            opts.success = function(responseData, status) {
              resolve(responseData);
              // $.ajax 복원
              $.ajax = origAjax;
            };
            opts.error = function(err) {
              resolve({ error: err.statusText || 'ajax error' });
              $.ajax = origAjax;
            };
          }
          return origAjax.call($, opts);
        };

        // 조회 함수 호출
        f_retrieveListBsnsExcutDetl(1);

        // 타임아웃
        setTimeout(() => {
          $.ajax = origAjax;
          window.f_retrieveCallBackDD001002Q = origCallback;
          resolve({ timeout: true });
        }, 10000);
      });
    }, targetFilter);

    if (result.timeout) {
      console.log('타임아웃');
      continue;
    }
    if (result.error) {
      console.log('에러:', result.error);
      continue;
    }

    // 데이터 분석
    const keys = Object.keys(result);
    console.log('응답 키:', keys.join(', '));

    for (const [key, val] of Object.entries(result)) {
      if (Array.isArray(val)) {
        console.log(`\n${key}: ${val.length}건`);
        if (val.length > 0) {
          // 첫 항목 필드 확인
          console.log('필드:', Object.keys(val[0]).join(', '));
        }

        // 사라진 항목 찾기
        const tracking = [383880, 80000, 160300, 196000, 182000, 255000];
        for (const amt of tracking) {
          const found = val.find(item => {
            const a = parseInt(String(item.excutSumAmount || item.excutAmount || '0').replace(/,/g, ''));
            return a === amt;
          });
          if (found) {
            console.log(`  ★ ${amt}원: ${found.excutPrposCn} | ${found.exmntPrgstNm || found.exmntPrgstCode || ''} | id=${found.excutId || ''}`);
          }
        }

        // 전체 출력 (최대 35개)
        val.slice(0, 35).forEach((item, i) => {
          const a = item.excutSumAmount || item.excutAmount || '';
          console.log(`  [${i}] ${item.excutPrposCn || ''} | ${a}원 | ${item.exmntPrgstNm || item.exmntPrgstCode || ''}`);
        });
        break;
      }
    }
  }

  // 원래 상태 복원
  await dismissModals(page);
}

main().catch(console.error);
