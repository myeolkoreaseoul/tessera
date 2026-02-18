/**
 * R31(255,000) - 그리드 DOM 직접 클릭
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

async function waitModal(page, timeout = 10000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const msg = await page.evaluate(() => {
      const modal = document.querySelector('.popupMask.on');
      if (modal) {
        const msgEl = modal.querySelector('.message');
        const ok = modal.querySelector('button.fn.ok, .fn.ok, footer button');
        const text = msgEl ? msgEl.textContent.trim() : '';
        if (ok) { ok.click(); return text || 'OK'; }
        return text || 'modal_no_ok';
      }
      return null;
    }).catch(() => null);
    if (msg) return msg;
    await sleep(300);
  }
  return null;
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
  console.log('=== R31 (255000원) 클릭 방식 v2 ===');

  const browser = await chromium.connectOverCDP('http://localhost:9444');
  const context = browser.contexts()[0];
  let page = context.pages().find(p => p.url().includes('dd001'));
  if (!page) { console.log('ERROR: 페이지 없음'); return; }
  page.on('dialog', async d => { try { await d.accept(); } catch {} });

  await dismissModals(page);

  if (page.url().includes('DD001003S')) {
    await page.evaluate(() => f_prevPage()).catch(() => {});
    await sleep(3000);
    await dismissModals(page);
  }

  // 재조회
  await page.evaluate(() => f_retrieveListBsnsExcutDetl(1));
  await sleep(3000);
  await dismissModals(page);
  await waitForGrid(page, 'DD001002QGridObj');

  // 목록 확인
  const rows = await page.evaluate(() => {
    const grid = DD001002QGridObj;
    return grid.getDataRows().map((r, i) => {
      const rv = grid.getRowValue(r);
      return { idx: i, purpose: rv.excutPrposCn, amount: parseInt(String(rv.excutAmount || rv.excutSumAmount).replace(/,/g, '')) };
    });
  });
  console.log(`목록: ${rows.length}행`);
  rows.forEach(r => console.log(`  [${r.idx}] ${r.purpose} | ${r.amount}원`));

  const targetIdx = rows.findIndex(r => r.amount === 255000);
  if (targetIdx < 0) { console.log('255000원 행 없음'); return; }
  console.log(`\n타겟: [${targetIdx}] ${rows[targetIdx].purpose}`);

  // 1. 그리드 DOM에서 해당 행 찾아 클릭
  const cellCoords = await page.evaluate((idx) => {
    const grid = DD001002QGridObj;
    // SBGrid의 그리드 컨테이너 찾기
    const containers = document.querySelectorAll('[id*="DD001002Q"][id*="Grid"], [id*="dd001002q"][id*="grid"]');
    const containerIds = Array.from(containers).map(c => c.id);

    // SBGrid tbody의 행 찾기 - 다양한 셀렉터 시도
    let targetCell = null;
    const selectors = [
      '#DD001002QGrid tbody tr',
      '#DD001002Q_sbGrid tbody tr',
      '#sbGridDD001002Q tbody tr',
      'div[id*="DD001002Q"] table tbody tr',
    ];

    for (const sel of selectors) {
      const trs = document.querySelectorAll(sel);
      if (trs.length > 0 && trs[idx]) {
        const td = trs[idx].querySelector('td');
        if (td) {
          const rect = td.getBoundingClientRect();
          return {
            x: rect.x + rect.width / 2,
            y: rect.y + rect.height / 2,
            selector: sel,
            trCount: trs.length,
            containerIds,
          };
        }
      }
    }

    // iframe 내부의 SBGrid도 확인
    const iframes = document.querySelectorAll('iframe');
    const iframeIds = Array.from(iframes).map(f => f.id || f.name || 'unnamed');

    return { found: false, containerIds, iframeIds };
  }, targetIdx);

  console.log('그리드 DOM:', JSON.stringify(cellCoords));

  if (cellCoords.x && cellCoords.y) {
    console.log(`셀 클릭: (${cellCoords.x.toFixed(0)}, ${cellCoords.y.toFixed(0)})`);
    await page.mouse.click(cellCoords.x, cellCoords.y);
    await sleep(1000);
  } else {
    // DOM 클릭 실패 - selectRow fallback
    console.log('DOM 셀 못 찾음, selectRow 사용');
    await page.evaluate((idx) => {
      const grid = DD001002QGridObj;
      const rows = grid.getDataRows();
      grid.selectRow(rows[idx]);
    }, targetIdx);
    await sleep(500);

    // 그리드가 iframe이나 다른 구조에 있는지 추가 탐색
    const gridDom = await page.evaluate(() => {
      // 그리드 오브젝트에서 DOM 참조 찾기
      const grid = DD001002QGridObj;
      const props = [];
      for (const key of Object.keys(grid)) {
        const val = grid[key];
        if (val && typeof val === 'object' && val.tagName) {
          props.push({ key, tagName: val.tagName, id: val.id || '' });
        }
      }
      // SBGrid는 보통 iframe 내부에 렌더링
      const frame = document.getElementById('DD001002QGrid') ||
                     document.querySelector('[name="DD001002QGrid"]') ||
                     document.querySelector('iframe[id*="DD001002Q"]');
      return {
        gridProps: props.slice(0, 10),
        frameFound: frame ? { tagName: frame.tagName, id: frame.id } : null,
      };
    });
    console.log('그리드 DOM 탐색:', JSON.stringify(gridDom));
  }

  // 선택 확인
  const focused = await page.evaluate(() => {
    const grid = DD001002QGridObj;
    if (typeof grid.getFocusedRow === 'function') {
      const fr = grid.getFocusedRow();
      if (fr != null) {
        const rv = grid.getRowValue(fr);
        return { amount: rv.excutAmount || rv.excutSumAmount, purpose: rv.excutPrposCn };
      }
    }
    return null;
  });
  console.log('포커스 행:', JSON.stringify(focused));

  // 2. 세부내역검토 클릭
  console.log('\n세부내역검토...');
  await page.click('#DD001002Q_detlListExmnt');
  await sleep(4000);
  await dismissModals(page);

  const detailReady = await waitForGrid(page, 'DD001003SGridObj', 15000);
  if (!detailReady) { console.log('상세 로드 실패'); return; }

  // 3. 금액 확인
  const detail = await page.evaluate(() => {
    const grid = DD001003SGridObj;
    const rv = grid.getRowValue(grid.getDataRows()[0]);
    return { amount: rv.excutSumAmount, purpose: rv.excutPrposCn, status: rv.pfrsChckSttusCode };
  });
  console.log('상세:', JSON.stringify(detail));

  const detailAmt = parseInt(String(detail.amount).replace(/,/g, ''));
  if (detailAmt !== 255000) {
    console.log(`ERROR: 금액 불일치 (${detailAmt} ≠ 255000) - 잘못된 행!`);
    await page.evaluate(() => f_prevPage()).catch(() => {});
    await sleep(3000);
    await dismissModals(page);
    return;
  }

  console.log('✓ 올바른 행 (255,000원)');

  // 4. 검토완료
  await page.click('#DD001003S_btnExmntPrgst001');
  await sleep(1000);
  console.log('→ 검토완료 설정');

  // 5. 저장
  await page.click('#DD001003S_btnSave');
  await sleep(1000);
  const c = await waitModal(page, 8000);
  console.log('확인:', c);
  await sleep(3000);
  const r = await waitModal(page, 15000);
  console.log('결과:', r);
  await dismissModals(page);

  const afterSave = await page.evaluate(() => {
    const grid = DD001003SGridObj;
    const rv = grid.getRowValue(grid.getDataRows()[0]);
    return { status: rv.pfrsChckSttusCode, orgStatus: rv.orgPfrsChckSttusCode };
  }).catch(() => null);
  console.log('저장후:', JSON.stringify(afterSave));

  // 6. 복귀 + 확인
  await page.evaluate(() => f_prevPage()).catch(() => {});
  await sleep(3000);
  await dismissModals(page);
  await page.evaluate(() => f_retrieveListBsnsExcutDetl(1));
  await sleep(3000);
  await dismissModals(page);

  const final = await page.evaluate(() => {
    const grid = DD001002QGridObj;
    return grid.getDataRows().map((r, i) => {
      const rv = grid.getRowValue(r);
      return { idx: i, purpose: rv.excutPrposCn, amount: rv.excutAmount || rv.excutSumAmount, status: rv.exmntPrgstNm || '' };
    });
  });
  console.log(`\n최종: ${final.length}행`);
  final.forEach(r => console.log(`  [${r.idx}] ${r.purpose} | ${r.amount}원 | ${r.status}`));

  const still = final.find(r => parseInt(String(r.amount).replace(/,/g, '')) === 255000);
  console.log(still ? `\n⚠ R31 아직 있음` : `\n✓ R31 완료`);
}

main().catch(console.error);
