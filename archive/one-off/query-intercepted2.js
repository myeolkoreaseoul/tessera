/**
 * Playwright route 인터셉트로 exmntPrgstCode 강제 변경
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

async function waitForGrid(page, gridName, timeout = 15000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const ready = await page.evaluate((name) => {
      const g = window[name];
      return g && typeof g.getDataRows === 'function' && g.getDataRows().length > 0;
    }, gridName).catch(() => false);
    if (ready) return true;
    await sleep(500);
  }
  return false;
}

async function main() {
  console.log('=== Playwright route 인터셉트 ===\n');

  const browser = await chromium.connectOverCDP('http://localhost:9444');
  const context = browser.contexts()[0];
  let page = context.pages().find(p => p.url().includes('dd001'));
  if (!page) { console.log('페이지 없음'); return; }
  page.on('dialog', async d => { try { await d.accept(); } catch {} });

  await dismissModals(page);

  // 방법: route로 POST body의 exmntPrgstCode를 변경
  for (const targetFilter of ['001', '', '002']) {
    console.log(`\n--- 필터: ${targetFilter || '전체'} ---`);

    // 인터셉트 설치
    let capturedResponse = null;
    await page.route('**/retrieveListBsnsExcutDetlList.do', async (route, request) => {
      const postData = request.postData();
      if (postData) {
        // URL-encoded body에서 exmntPrgstCode 변경
        const params = new URLSearchParams(postData);
        params.set('exmntPrgstCode', targetFilter);
        params.set('countPerPageNum', '50');

        console.log(`  인터셉트: exmntPrgstCode=${params.get('exmntPrgstCode')}`);

        // 변경된 body로 요청 계속
        await route.continue({
          postData: params.toString(),
        });
      } else {
        await route.continue();
      }
    });

    // 조회 실행
    await page.evaluate(() => f_retrieveListBsnsExcutDetl(1));
    await sleep(4000);
    await dismissModals(page);

    // 인터셉트 해제
    await page.unroute('**/retrieveListBsnsExcutDetlList.do');

    // 그리드 결과 확인
    const gridReady = await waitForGrid(page, 'DD001002QGridObj', 5000);
    if (!gridReady) {
      // 그리드가 비어있을 수 있음
      const rowCount = await page.evaluate(() => {
        if (typeof DD001002QGridObj === 'undefined') return -1;
        return DD001002QGridObj.getDataRows().length;
      });
      console.log(`  그리드: ${rowCount}행`);
      if (rowCount === 0) {
        console.log('  항목 없음');
        continue;
      }
    }

    const rows = await page.evaluate(() => {
      const grid = DD001002QGridObj;
      const dataRows = grid.getDataRows();
      return dataRows.map((r, i) => {
        const rv = grid.getRowValue(r);
        return {
          idx: i,
          purpose: rv.excutPrposCn,
          amount: parseInt(String(rv.excutAmount || rv.excutSumAmount).replace(/,/g, '')),
          status: rv.exmntPrgstNm || rv.exmntPrgstCode || '',
          excutId: rv.excutId || '',
        };
      });
    });

    console.log(`  결과: ${rows.length}행`);

    // 사라진 항목 추적
    const tracking = [383880, 80000, 160300, 196000];
    for (const amt of tracking) {
      const found = rows.find(r => r.amount === amt);
      if (found) console.log(`  ★ ${amt}원: [${found.idx}] ${found.purpose} | ${found.status} | id=${found.excutId}`);
    }

    // 전체 출력 (페이지 1 max 20)
    rows.slice(0, 30).forEach(r => {
      console.log(`  [${r.idx}] ${r.purpose} | ${r.amount}원 | ${r.status}`);
    });

    // 페이징 확인
    const totalInfo = await page.evaluate(() => {
      const el = document.getElementById('DD001002Q_nTotalCnt');
      const paging = document.getElementById('DD001002Q_sbGridPaging');
      return {
        total: el ? el.value || el.textContent : 'not found',
        paging: paging ? paging.textContent.trim() : 'not found',
      };
    });
    console.log(`  총건수: ${totalInfo.total} | 페이징: ${totalInfo.paging}`);
  }
}

main().catch(console.error);
