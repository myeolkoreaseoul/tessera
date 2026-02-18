/**
 * 직접 AJAX로 검토완료 항목 조회 (CSRF 수동 처리)
 */
const { chromium } = require('playwright');

process.on('unhandledRejection', (err) => {
  if (err && err.message && err.message.includes('No dialog is showing')) return;
});

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function main() {
  console.log('=== 직접 AJAX 조회 ===\n');

  const browser = await chromium.connectOverCDP('http://localhost:9444');
  const context = browser.contexts()[0];
  let page = context.pages().find(p => p.url().includes('dd001'));
  if (!page) { console.log('페이지 없음'); return; }
  page.on('dialog', async d => { try { await d.accept(); } catch {} });

  // 1. CSRF 토큰 확인
  const csrfInfo = await page.evaluate(() => {
    const result = {};
    // meta tag
    const meta = document.querySelector('meta[name="_csrf"]') ||
                 document.querySelector('meta[name="csrf-token"]');
    if (meta) result.meta = { name: meta.name, content: meta.content };

    // hidden input
    const hiddenCsrf = document.querySelector('input[name="_csrf"]');
    if (hiddenCsrf) result.hidden = { name: hiddenCsrf.name, value: hiddenCsrf.value };

    // cf_setCSRFHeader 소스
    if (typeof cf_setCSRFHeader === 'function') {
      result.fnSource = cf_setCSRFHeader.toString().substring(0, 300);
    }

    // 쿠키
    result.cookies = document.cookie.substring(0, 200);

    return result;
  });
  console.log('CSRF:', JSON.stringify(csrfInfo, null, 2));

  // 2. 기본 파라미터
  const params = await page.evaluate(() => ({
    bsnsyear: $('#DD001002Q_bsnsyear').val(),
    taskNo: $('#DD001002Q_taskNo').val(),
    requstDeFrom: $('#DD001002Q_requstDeFrom').val().replaceAll('-', ''),
    requstDeTo: $('#DD001002Q_requstDeTo').val().replaceAll('-', ''),
    agremId: $('#DD001002Q_agremId').val(),
    excInsttId: $('#DD001002Q_excInsttId').val(),
  }));
  console.log('파라미터:', JSON.stringify(params));

  // 3. AJAX 호출 (fetch API 사용)
  for (const filter of ['001', '002', '']) {
    console.log(`\n--- 필터: ${filter || '전체'} ---`);

    const result = await page.evaluate(async ({ params, filter, csrfInfo }) => {
      try {
        const body = new URLSearchParams({
          bsnsyear: params.bsnsyear,
          taskNo: params.taskNo,
          requstDeFrom: params.requstDeFrom,
          requstDeTo: params.requstDeTo,
          exmntPrgstCode: filter,
          agremId: params.agremId,
          excInsttId: params.excInsttId,
          currentPageNum: '1',
          countPerPageNum: '50',
          excutAmountFrom: '0',
          excutAmountTo: '999999999999999',
          excutPrposCn: '',
          bcncCmpnyNm: '',
          prufSeCode: '',
          asstnExpitmCode: '',
          asstnTaxitmCode: '',
          focusManage: '',
        });

        const headers = {
          'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
          'X-Requested-With': 'XMLHttpRequest',
        };

        // CSRF 토큰 추가
        if (csrfInfo.hidden) {
          body.append(csrfInfo.hidden.name, csrfInfo.hidden.value);
        }
        // meta에서 헤더 이름과 값 추출
        if (csrfInfo.fnSource) {
          const headerMatch = csrfInfo.fnSource.match(/setRequestHeader\("([^"]+)",\s*"?([^")]+)"?\)/);
          if (headerMatch) {
            headers[headerMatch[1]] = headerMatch[2];
          }
          // 또는 변수에서 추출
          const varMatch = csrfInfo.fnSource.match(/var\s+(\w+)\s*=\s*\$\("meta\[name='([^']+)'\]"\)\.attr\("content"\)/g);
        }

        const resp = await fetch('/exe/dd/dd001/retrieveListBsnsExcutDetlList.do', {
          method: 'POST',
          headers,
          body: body.toString(),
          credentials: 'same-origin',
        });

        const text = await resp.text();
        try {
          return { status: resp.status, data: JSON.parse(text) };
        } catch {
          return { status: resp.status, text: text.substring(0, 500) };
        }
      } catch (err) {
        return { error: err.message };
      }
    }, { params, filter, csrfInfo });

    if (result.error) {
      console.log('에러:', result.error);
      continue;
    }

    if (result.text) {
      console.log(`HTTP ${result.status}: ${result.text}`);
      continue;
    }

    const data = result.data;
    // 데이터 구조 탐색
    for (const [key, val] of Object.entries(data)) {
      if (Array.isArray(val)) {
        console.log(`${key}: ${val.length}건`);
        val.forEach((item, i) => {
          const amt = item.excutSumAmount || item.excutAmount || '';
          const purpose = item.excutPrposCn || '';
          const status = item.exmntPrgstNm || item.exmntPrgstCode || '';
          const excutId = item.excutId || '';
          console.log(`  [${i}] ${purpose} | ${amt}원 | ${status} | id=${excutId}`);
        });
      } else if (typeof val === 'number' || typeof val === 'string') {
        if (key.includes('cnt') || key.includes('Cnt') || key.includes('total') || key.includes('Total')) {
          console.log(`${key}: ${val}`);
        }
      }
    }
  }
}

main().catch(console.error);
