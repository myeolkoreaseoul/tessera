/**
 * R31(255,000) 보완요청→검토완료 - f_changeExmntPrgst 사용
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
  console.log('=== R31 (1103회의비, 255000원) 재수정 ===');

  const browser = await chromium.connectOverCDP('http://localhost:9444');
  const context = browser.contexts()[0];
  let page = context.pages().find(p => p.url().includes('dd001'));
  if (!page) { console.log('ERROR: 페이지 없음'); return; }
  page.on('dialog', async d => { try { await d.accept(); } catch {} });

  await dismissModals(page);
  await sleep(300);

  // 상세 페이지면 복귀
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

  // 현재 목록
  const rows = await page.evaluate(() => {
    const grid = DD001002QGridObj;
    return grid.getDataRows().map((r, i) => {
      const rv = grid.getRowValue(r);
      return { idx: i, purpose: rv.excutPrposCn, amount: parseInt(String(rv.excutAmount || rv.excutSumAmount).replace(/,/g, '')), status: rv.exmntPrgstNm || '' };
    });
  });
  console.log(`현재 목록: ${rows.length}행`);
  rows.forEach(r => console.log(`  [${r.idx}] ${r.purpose} | ${r.amount}원 | ${r.status}`));

  // R31 찾기
  const target = rows.find(r => r.amount === 255000);
  if (!target) {
    console.log('\n255000원 행 없음 - 이미 처리된 것일 수 있음');
    return;
  }

  // 1. 행 선택
  console.log(`\n행 선택: [${target.idx}] ${target.purpose}`);
  await page.evaluate((idx) => {
    const grid = DD001002QGridObj;
    const rows = grid.getDataRows();
    grid.selectRow(rows[idx]);
  }, target.idx);
  await sleep(1000);

  // 2. 세부내역검토 클릭
  console.log('세부내역검토 클릭...');
  await page.click('#DD001002Q_detlListExmnt');
  await sleep(4000);
  await dismissModals(page);

  const detailReady = await waitForGrid(page, 'DD001003SGridObj', 15000);
  if (!detailReady) {
    console.log('ERROR: 상세 그리드 로드 실패');
    return;
  }

  // 3. 현재 상태
  const before = await page.evaluate(() => {
    const grid = DD001003SGridObj;
    const rows = grid.getDataRows();
    return rows.map(r => {
      const rv = grid.getRowValue(r);
      return rv;
    });
  });
  console.log('상세 상태:', JSON.stringify(before[0], null, 2).substring(0, 500));

  // 4. 검토완료 버튼 직접 클릭 (f_changeExmntPrgst("001") 호출)
  console.log('\n검토완료 버튼 클릭...');
  await page.click('#DD001003S_btnExmntPrgst001');
  await sleep(1000);

  // 변경 확인
  const after = await page.evaluate(() => {
    const grid = DD001003SGridObj;
    const rv = grid.getRowValue(grid.getDataRows()[0]);
    return {
      pfrsChckSttusCode: rv.pfrsChckSttusCode,
      nrcgnAmount: rv.nrcgnAmount,
      exclexCn: rv.exclexCn,
    };
  });
  console.log('변경 후:', JSON.stringify(after));

  // 5. 저장 버튼 클릭
  console.log('\n저장 버튼 클릭...');
  await page.click('#DD001003S_btnSave');
  await sleep(1000);

  // 확인 모달
  const confirm1 = await waitModal(page, 8000);
  console.log('확인 모달:', confirm1);
  await sleep(3000);

  // 결과 모달
  const result1 = await waitModal(page, 15000);
  console.log('결과 모달:', result1);
  await sleep(1000);
  await dismissModals(page);

  // 6. 다시 상세 상태 확인 (저장 후)
  const detailAfterSave = await page.evaluate(() => {
    const grid = DD001003SGridObj;
    if (!grid || !grid.getDataRows) return null;
    const rows = grid.getDataRows();
    if (rows.length === 0) return null;
    const rv = grid.getRowValue(rows[0]);
    return {
      pfrsChckSttusCode: rv.pfrsChckSttusCode,
      orgPfrsChckSttusCode: rv.orgPfrsChckSttusCode,
    };
  }).catch(() => null);
  console.log('저장 후 상세 상태:', JSON.stringify(detailAfterSave));

  // 7. 이전 페이지
  console.log('\n이전 페이지...');
  await page.evaluate(() => f_prevPage()).catch(() => {});
  await sleep(3000);
  await dismissModals(page);
  await waitForGrid(page, 'DD001002QGridObj', 10000);

  // 8. 최종 목록 확인
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
  if (r31Still) {
    console.log(`\n⚠ R31 아직 목록에 있음 (${r31Still.status})`);
  } else {
    console.log('\n✓ R31 목록에서 사라짐 → 검토완료 처리 완료');
  }

  console.log('\n=== 완료 ===');
}

main().catch(console.error);
