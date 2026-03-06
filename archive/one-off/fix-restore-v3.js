/**
 * 검토완료 필터로 변경하여 조회 + 4건 보완요청 복원
 * jQuery를 통한 select 변경 + DOM 클릭 행 선택
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

const TARGETS = [
  { amount: 383880, label: 'R1 11월인건비', comment: '증빙파일 미첨부 → 보완 요청 (회의록, 영수증)' },
  { amount: 80000, label: 'R9 1127회의비', comment: '증빙파일 미첨부 → 보완 요청 (근로계약서, 급여명세서, 지급명세서)' },
  { amount: 160300, label: 'R10 1110회의비', comment: '증빙파일 미첨부 → 보완 요청 (회의록, 영수증)' },
  { amount: 196000, label: 'R11 1107회의비', comment: '증빙파일 미첨부 → 보완 요청 (회의록, 영수증)' },
];

async function queryWithFilter(page, filterCode) {
  // jQuery로 select 값 변경
  await page.evaluate((code) => {
    $('#DD001002Q_selExmntPrgstCode').val(code);
    // change event 발생
    $('#DD001002Q_selExmntPrgstCode').trigger('change');
  }, filterCode);
  await sleep(300);

  // 값 확인
  const val = await page.evaluate(() => $('#DD001002Q_selExmntPrgstCode').val());
  console.log(`  필터 값: ${val}`);

  // 조회
  await page.evaluate(() => f_retrieveListBsnsExcutDetl(1));
  await sleep(4000);
  await dismissModals(page);
}

async function getGridRows(page) {
  return page.evaluate(() => {
    if (typeof DD001002QGridObj === 'undefined') return [];
    const grid = DD001002QGridObj;
    const rows = grid.getDataRows();
    return rows.map((r, i) => {
      const rv = grid.getRowValue(r);
      return {
        idx: i,
        purpose: rv.excutPrposCn,
        amount: parseInt(String(rv.excutAmount || rv.excutSumAmount).replace(/,/g, '')),
        status: rv.exmntPrgstNm || rv.exmntPrgstCode || '',
      };
    });
  });
}

async function clickRowByText(page, text) {
  return page.evaluate((searchText) => {
    const allTds = document.querySelectorAll('td');
    for (const td of allTds) {
      if (td.textContent.trim() === searchText) {
        const rect = td.getBoundingClientRect();
        if (rect.height > 0 && rect.width > 0) {
          return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
        }
      }
    }
    return null;
  }, text);
}

async function fixOne(page, target) {
  console.log(`\n=== ${target.label} (${target.amount}원) → 보완요청 ===`);

  // 검토완료 필터로 조회
  await queryWithFilter(page, '001');
  const gridOk = await waitForGrid(page, 'DD001002QGridObj', 10000);

  if (!gridOk) {
    // 그리드가 비어있을 수 있음 (검토완료 항목 없음)
    console.log('  검토완료 항목 없음');
    return 'no_items';
  }

  const rows = await getGridRows(page);
  console.log(`  검토완료: ${rows.length}행`);

  const targetRow = rows.find(r => r.amount === target.amount);
  if (!targetRow) {
    console.log(`  ${target.amount}원 못 찾음`);
    rows.forEach(r => console.log(`    [${r.idx}] ${r.purpose} | ${r.amount}원`));

    // 2페이지 확인
    await page.evaluate(() => f_retrieveListBsnsExcutDetl(2));
    await sleep(3000);
    await dismissModals(page);
    const rows2 = await getGridRows(page);
    if (rows2.length > 0) {
      console.log(`  2페이지: ${rows2.length}행`);
      const t2 = rows2.find(r => r.amount === target.amount);
      if (!t2) {
        console.log('  2페이지에도 없음');
        return 'not_found';
      }
      // 2페이지에서 찾음
      return await processRow(page, t2, target);
    }
    return 'not_found';
  }

  return await processRow(page, targetRow, target);
}

async function processRow(page, rowInfo, target) {
  console.log(`  찾음: [${rowInfo.idx}] ${rowInfo.purpose} | ${rowInfo.status}`);

  // DOM 클릭
  const coords = await clickRowByText(page, rowInfo.purpose);
  if (coords) {
    await page.mouse.click(coords.x, coords.y);
    await sleep(1000);
  } else {
    // 금액으로 시도
    const amtStr = target.amount.toLocaleString();
    const amtCoords = await clickRowByText(page, amtStr);
    if (amtCoords) {
      await page.mouse.click(amtCoords.x, amtCoords.y);
      await sleep(1000);
    } else {
      console.log('  클릭 실패');
      return 'click_fail';
    }
  }

  // 포커스 확인
  const focused = await page.evaluate(() => {
    const grid = DD001002QGridObj;
    const fr = grid.getFocusedRow();
    if (!fr) return null;
    const rv = grid.getRowValue(fr);
    return { amount: parseInt(String(rv.excutAmount || rv.excutSumAmount).replace(/,/g, '')), purpose: rv.excutPrposCn };
  });
  console.log(`  포커스: ${JSON.stringify(focused)}`);

  if (!focused || focused.amount !== target.amount) {
    console.log('  포커스 불일치!');
    return 'focus_mismatch';
  }

  // 세부내역검토
  await page.click('#DD001002Q_detlListExmnt');
  await sleep(4000);
  await dismissModals(page);

  const detailReady = await waitForGrid(page, 'DD001003SGridObj', 15000);
  if (!detailReady) {
    console.log('  상세 로드 실패');
    return 'detail_fail';
  }

  // 금액 확인
  const detail = await page.evaluate(() => {
    const grid = DD001003SGridObj;
    const rv = grid.getRowValue(grid.getDataRows()[0]);
    return { amount: parseInt(String(rv.excutSumAmount).replace(/,/g, '')), status: rv.pfrsChckSttusCode };
  });
  console.log(`  상세: ${detail.amount}원 | ${detail.status}`);

  if (detail.amount !== target.amount) {
    console.log(`  ERROR: 금액 불일치 → 복귀`);
    await page.evaluate(() => f_prevPage()).catch(() => {});
    await sleep(3000);
    await dismissModals(page);
    return 'wrong_row';
  }

  if (detail.status === '002') {
    console.log('  이미 보완요청');
    await page.evaluate(() => f_prevPage()).catch(() => {});
    await sleep(3000);
    await dismissModals(page);
    return 'already_ok';
  }

  // 보완요청 설정
  await page.click('#DD001003S_btnExmntPrgst002');
  await sleep(1000);

  // 코멘트 + 불인정금액
  const htmlComment = target.comment.replace(/\n/g, '<br>');
  await page.evaluate((comment) => {
    const grid = DD001003SGridObj;
    const row = grid.getDataRows()[0];
    grid.setValue(row, "exclexCn", comment);
    grid.setValue(row, "orgExclexCn", comment);
    grid.setValue(row, "nrcgnAmount", "0");
  }, htmlComment);
  console.log(`  → 보완요청 설정 + 코멘트`);

  // 저장
  await page.click('#DD001003S_btnSave');
  await sleep(1000);
  const c = await waitModal(page, 8000);
  console.log(`  확인: ${c}`);
  await sleep(3000);
  const r = await waitModal(page, 15000);
  console.log(`  결과: ${r}`);
  await dismissModals(page);

  // 복귀
  await page.evaluate(() => f_prevPage()).catch(() => {});
  await sleep(3000);
  await dismissModals(page);

  console.log('  완료');
  return 'ok';
}

async function main() {
  console.log('=== 4건 복원 v3 (jQuery 필터 변경) ===\n');

  const browser = await chromium.connectOverCDP('http://localhost:9444');
  const context = browser.contexts()[0];
  let page = context.pages().find(p => p.url().includes('dd001'));
  if (!page) { console.log('페이지 없음'); return; }
  page.on('dialog', async d => { try { await d.accept(); } catch {} });

  await dismissModals(page);

  if (page.url().includes('DD001003S')) {
    await page.evaluate(() => f_prevPage()).catch(() => {});
    await sleep(3000);
    await dismissModals(page);
  }

  // Step 0: 먼저 검토완료 필터 조회 테스트
  console.log('--- 검토완료 필터 테스트 ---');
  await queryWithFilter(page, '001');
  const testGrid = await waitForGrid(page, 'DD001002QGridObj', 10000);
  if (testGrid) {
    const testRows = await getGridRows(page);
    console.log(`검토완료 목록: ${testRows.length}행`);
    testRows.forEach(r => console.log(`  [${r.idx}] ${r.purpose} | ${r.amount}원 | ${r.status}`));
  } else {
    console.log('검토완료 목록 비어있음');

    // 전체로도 시도
    console.log('\n--- 전체 필터 테스트 ---');
    await queryWithFilter(page, '');
    const allGrid = await waitForGrid(page, 'DD001002QGridObj', 10000);
    if (allGrid) {
      const allRows = await getGridRows(page);
      console.log(`전체: ${allRows.length}행`);
      allRows.forEach(r => console.log(`  [${r.idx}] ${r.purpose} | ${r.amount}원 | ${r.status}`));
    } else {
      console.log('전체도 비어있음');
    }
  }

  // 각 항목 처리
  const results = {};
  for (const target of TARGETS) {
    results[target.label] = await fixOne(page, target);
    await sleep(1000);
  }

  // 최종: 보완요청 필터
  console.log('\n\n=== 최종 보완요청 목록 ===');
  await queryWithFilter(page, '002');
  const finalGrid = await waitForGrid(page, 'DD001002QGridObj', 10000);
  if (finalGrid) {
    const finalRows = await getGridRows(page);
    console.log(`보완요청: ${finalRows.length}행`);
    finalRows.forEach(r => console.log(`  [${r.idx}] ${r.purpose} | ${r.amount}원 | ${r.status}`));
  }

  console.log('\n--- 결과 ---');
  for (const [k, v] of Object.entries(results)) {
    console.log(`  ${k}: ${v}`);
  }
}

main().catch(console.error);
