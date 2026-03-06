/**
 * R31(255,000) - 그리드 행 직접 클릭으로 선택 후 검토완료
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
  console.log('=== R31 (1103회의비, 255000원) - 클릭 방식 ===');

  const browser = await chromium.connectOverCDP('http://localhost:9444');
  const context = browser.contexts()[0];
  let page = context.pages().find(p => p.url().includes('dd001'));
  if (!page) { console.log('ERROR: 페이지 없음'); return; }
  page.on('dialog', async d => { try { await d.accept(); } catch {} });

  await dismissModals(page);
  await sleep(300);

  if (page.url().includes('DD001003S')) {
    await page.evaluate(() => f_prevPage()).catch(() => {});
    await sleep(3000);
    await dismissModals(page);
  }

  // 그리드 재조회
  console.log('그리드 재조회...');
  await page.evaluate(() => f_retrieveListBsnsExcutDetl(1));
  await sleep(3000);
  await dismissModals(page);
  await waitForGrid(page, 'DD001002QGridObj');

  // 현재 목록 + 그리드 구조 파악
  const gridInfo = await page.evaluate(() => {
    const grid = DD001002QGridObj;
    const rows = grid.getDataRows();
    const data = rows.map((r, i) => {
      const rv = grid.getRowValue(r);
      return {
        idx: i,
        row: r,
        purpose: rv.excutPrposCn,
        amount: parseInt(String(rv.excutAmount || rv.excutSumAmount).replace(/,/g, '')),
        status: rv.exmntPrgstNm || '',
      };
    });
    // 그리드 선택 관련 API 확인
    const apis = [];
    for (const fn of ['selectRow', 'setFocusCell', 'clickRow', 'setSelectRow',
      'getSelectedRow', 'getFocusedRow', 'getActiveRow']) {
      if (typeof grid[fn] === 'function') apis.push(fn);
    }
    return { data, apis, gridId: grid.id || grid.gridId || 'unknown' };
  });

  console.log(`현재 목록: ${gridInfo.data.length}행`);
  gridInfo.data.forEach(r => console.log(`  [${r.idx}] ${r.purpose} | ${r.amount}원 | ${r.status}`));
  console.log(`그리드 API: ${gridInfo.apis.join(', ')}`);

  // R31 찾기
  const target = gridInfo.data.find(r => r.amount === 255000);
  if (!target) {
    console.log('255000원 행 없음');
    return;
  }
  console.log(`\n타겟: [${target.idx}] ${target.purpose} ${target.amount}원`);

  // 1. 그리드 행 클릭으로 선택 (UI 이벤트 발생)
  // 그리드 렌더링 방식에 따라 tbody tr:nth-child 또는 다른 셀렉터 사용
  const clickInfo = await page.evaluate((idx) => {
    const grid = DD001002QGridObj;
    const rows = grid.getDataRows();
    const row = rows[idx];

    // selectRow + setFocusCell 시도
    grid.selectRow(row);
    if (typeof grid.setFocusCell === 'function') {
      grid.setFocusCell(row, 0);
    }

    // 선택 확인
    let selectedRow = null;
    if (typeof grid.getSelectedRow === 'function') {
      selectedRow = grid.getSelectedRow();
    }

    // 그리드 DOM에서 해당 행의 셀 찾기
    const gridEl = document.getElementById('DD001002QGrid');
    let cellRect = null;
    if (gridEl) {
      // SBGrid는 보통 table tbody tr 구조
      const trs = gridEl.querySelectorAll('tbody tr');
      if (trs[idx]) {
        const td = trs[idx].querySelector('td');
        if (td) {
          const rect = td.getBoundingClientRect();
          cellRect = { x: rect.x + rect.width/2, y: rect.y + rect.height/2 };
        }
      }
    }

    return {
      selectedRow,
      targetRow: row,
      match: selectedRow === row,
      cellRect,
      gridElFound: !!gridEl,
    };
  }, target.idx);
  console.log('클릭 정보:', JSON.stringify(clickInfo));

  // 셀 좌표가 있으면 직접 클릭
  if (clickInfo.cellRect) {
    console.log(`그리드 셀 클릭: (${clickInfo.cellRect.x}, ${clickInfo.cellRect.y})`);
    await page.mouse.click(clickInfo.cellRect.x, clickInfo.cellRect.y);
    await sleep(500);
  }

  // 선택된 행 확인
  const selectedInfo = await page.evaluate(() => {
    const grid = DD001002QGridObj;
    let sel = null;
    if (typeof grid.getSelectedRow === 'function') sel = grid.getSelectedRow();
    const rv = sel != null ? grid.getRowValue(sel) : null;
    return {
      selectedRow: sel,
      amount: rv ? (rv.excutAmount || rv.excutSumAmount) : null,
      purpose: rv ? rv.excutPrposCn : null,
    };
  });
  console.log('선택된 행:', JSON.stringify(selectedInfo));

  // 2. 세부내역검토 클릭
  console.log('\n세부내역검토 클릭...');
  await page.click('#DD001002Q_detlListExmnt');
  await sleep(4000);
  await dismissModals(page);

  const detailReady = await waitForGrid(page, 'DD001003SGridObj', 15000);
  if (!detailReady) {
    console.log('ERROR: 상세 그리드 로드 실패');
    return;
  }

  // 3. 상세 페이지 - 금액 확인 (올바른 행이 열렸는지)
  const detail = await page.evaluate(() => {
    const grid = DD001003SGridObj;
    const rv = grid.getRowValue(grid.getDataRows()[0]);
    return {
      excutSumAmount: rv.excutSumAmount,
      pfrsChckSttusCode: rv.pfrsChckSttusCode,
      orgPfrsChckSttusCode: rv.orgPfrsChckSttusCode,
      excutPrposCn: rv.excutPrposCn || '',
    };
  });
  console.log('상세 페이지:', JSON.stringify(detail));

  if (detail.excutSumAmount !== 255000 && detail.excutSumAmount !== '255000' &&
      detail.excutSumAmount !== '255,000') {
    console.log(`ERROR: 금액 불일치! 예상 255000, 실제 ${detail.excutSumAmount}`);
    console.log('잘못된 행이 열림 - 이전 페이지로 복귀');
    await page.evaluate(() => f_prevPage()).catch(() => {});
    await sleep(3000);
    await dismissModals(page);
    return;
  }

  console.log('✓ 올바른 행 확인 (255,000원)');

  // 4. 검토완료 버튼 클릭
  console.log('\n검토완료 버튼 클릭...');
  await page.click('#DD001003S_btnExmntPrgst001');
  await sleep(1000);

  const after = await page.evaluate(() => {
    const grid = DD001003SGridObj;
    const rv = grid.getRowValue(grid.getDataRows()[0]);
    return { pfrsChckSttusCode: rv.pfrsChckSttusCode, nrcgnAmount: rv.nrcgnAmount };
  });
  console.log('변경 후:', JSON.stringify(after));

  // 5. 저장
  console.log('\n저장...');
  await page.click('#DD001003S_btnSave');
  await sleep(1000);

  const confirm1 = await waitModal(page, 8000);
  console.log('확인 모달:', confirm1);
  await sleep(3000);

  const result1 = await waitModal(page, 15000);
  console.log('결과 모달:', result1);
  await sleep(1000);
  await dismissModals(page);

  // 저장 후 상태
  const afterSave = await page.evaluate(() => {
    const grid = DD001003SGridObj;
    if (!grid || !grid.getDataRows) return null;
    const rows = grid.getDataRows();
    if (rows.length === 0) return null;
    const rv = grid.getRowValue(rows[0]);
    return { pfrsChckSttusCode: rv.pfrsChckSttusCode, orgPfrsChckSttusCode: rv.orgPfrsChckSttusCode };
  }).catch(() => null);
  console.log('저장 후:', JSON.stringify(afterSave));

  // 6. 이전 페이지
  console.log('\n이전 페이지...');
  await page.evaluate(() => f_prevPage()).catch(() => {});
  await sleep(3000);
  await dismissModals(page);

  // 재조회
  await page.evaluate(() => f_retrieveListBsnsExcutDetl(1));
  await sleep(3000);
  await dismissModals(page);
  await waitForGrid(page, 'DD001002QGridObj', 10000);

  const finalRows = await page.evaluate(() => {
    const grid = DD001002QGridObj;
    return grid.getDataRows().map((r, i) => {
      const rv = grid.getRowValue(r);
      return { idx: i, purpose: rv.excutPrposCn, amount: rv.excutAmount || rv.excutSumAmount, status: rv.exmntPrgstNm || '' };
    });
  });
  console.log(`\n최종 목록: ${finalRows.length}행`);
  finalRows.forEach(r => console.log(`  [${r.idx}] ${r.purpose} | ${r.amount}원 | ${r.status}`));

  const r31Still = finalRows.find(r => String(r.amount).replace(/,/g, '') === '255000');
  console.log(r31Still ? `\n⚠ R31 아직 있음 (${r31Still.status})` : '\n✓ R31 사라짐 → 검토완료 완료');

  console.log('\n=== 완료 ===');
}

main().catch(console.error);
