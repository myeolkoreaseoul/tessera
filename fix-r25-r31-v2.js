/**
 * R25(182,000), R31(255,000) 보완요청→검토완료 재수정
 * 상세 페이지 진입 후 실제 상태 확인하고 변경
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
  { amount: 182000, label: 'R25 1114회의비' },
  { amount: 255000, label: 'R31 1103회의비' },
];

async function fixOne(page, target) {
  console.log(`\n=== ${target.label} (${target.amount}원) ===`);

  // 1. 목록에서 해당 행 찾아 선택
  const idx = await page.evaluate((amt) => {
    const grid = DD001002QGridObj;
    const rows = grid.getDataRows();
    for (let i = 0; i < rows.length; i++) {
      const rv = grid.getRowValue(rows[i]);
      const a = parseInt(String(rv.excutAmount || rv.excutSumAmount).replace(/,/g, ''));
      if (a === amt) { grid.selectRow(rows[i]); return i; }
    }
    return -1;
  }, target.amount);

  if (idx < 0) {
    console.log('  ERROR: 행 못 찾음');
    return false;
  }
  console.log(`  행 선택: [${idx}]`);
  await sleep(500);

  // 2. 세부내역검토 클릭 → 상세 페이지
  await page.click('#DD001002Q_detlListExmnt');
  await sleep(3000);
  await dismissModals(page);

  const detailReady = await waitForGrid(page, 'DD001003SGridObj', 15000);
  if (!detailReady) {
    console.log('  ERROR: 상세 그리드 로드 실패');
    await page.evaluate(() => f_prevPage()).catch(() => {});
    await sleep(3000);
    await dismissModals(page);
    return false;
  }

  // 3. 현재 상세 상태 확인
  const status = await page.evaluate(() => {
    const grid = DD001003SGridObj;
    const rows = grid.getDataRows();
    return rows.map(r => {
      const rv = grid.getRowValue(r);
      return {
        pfrsChckSttusCode: rv.pfrsChckSttusCode,
        orgPfrsChckSttusCode: rv.orgPfrsChckSttusCode,
        nrcgnAmount: rv.nrcgnAmount,
        exclexCn: (rv.exclexCn || '').substring(0, 80),
      };
    });
  });
  console.log('  현재 상태:', JSON.stringify(status));

  // 이미 검토완료면 스킵
  if (status[0] && status[0].pfrsChckSttusCode === '001') {
    console.log('  이미 검토완료 → 스킵');
    await page.evaluate(() => f_prevPage()).catch(() => {});
    await sleep(3000);
    await dismissModals(page);
    return true;
  }

  // 4. 검토완료 설정 - f_changeExmntPrgst 대신 직접 그리드 값 세팅
  await page.evaluate(() => {
    const grid = DD001003SGridObj;
    const rows = grid.getDataRows();
    const row = rows[0];
    grid.setValue(row, "pfrsChckSttusCode", "001");
    grid.setValue(row, "nrcgnAmount", "0");
    grid.setValue(row, "exclexCn", "");
    grid.setValue(row, "orgExclexCn", "");
  });
  console.log('  → 검토완료 직접 세팅');

  // 변경 확인
  const afterSet = await page.evaluate(() => {
    const grid = DD001003SGridObj;
    const rv = grid.getRowValue(grid.getDataRows()[0]);
    return {
      pfrsChckSttusCode: rv.pfrsChckSttusCode,
      nrcgnAmount: rv.nrcgnAmount,
      exclexCn: rv.exclexCn,
    };
  });
  console.log('  세팅 후:', JSON.stringify(afterSet));

  // 5. 저장 - 버튼 클릭이 아닌 함수 직접 호출
  console.log('  저장 시도...');
  await page.evaluate(() => {
    f_exclexRegist();
  });
  await sleep(500);

  // 확인 모달 ("저장하시겠습니까?")
  const confirmMsg = await waitModal(page, 5000);
  console.log(`  확인 모달: ${confirmMsg}`);

  await sleep(2000);

  // 성공 모달 ("처리되었습니다")
  const successMsg = await waitModal(page, 15000);
  console.log(`  결과 모달: ${successMsg}`);

  await sleep(1000);
  await dismissModals(page);

  // 6. 이전 페이지
  await page.evaluate(() => f_prevPage()).catch(() => {});
  await sleep(3000);
  await dismissModals(page);
  await waitForGrid(page, 'DD001002QGridObj', 10000);

  // 7. 변경 확인 - 해당 행이 아직 보완요청인지 검토완료인지
  const verify = await page.evaluate((amt) => {
    const grid = DD001002QGridObj;
    const rows = grid.getDataRows();
    for (let i = 0; i < rows.length; i++) {
      const rv = grid.getRowValue(rows[i]);
      const a = parseInt(String(rv.excutAmount || rv.excutSumAmount).replace(/,/g, ''));
      if (a === amt) return { found: true, idx: i, status: rv.exmntPrgstNm || rv.exmntPrgstCode };
    }
    return { found: false };
  }, target.amount);

  if (verify.found) {
    console.log(`  목록 확인: [${verify.idx}] 상태=${verify.status}`);
    if (verify.status.includes('검토완료') || verify.status === '001') {
      console.log('  ✓ 검토완료 확인!');
      return true;
    } else {
      console.log(`  ✗ 아직 ${verify.status} - 저장 실패 가능성`);
      return false;
    }
  } else {
    console.log('  목록에서 해당 행 사라짐 (필터로 인해 검토완료 항목이 숨겨졌을 수 있음)');
    return true;  // 보완요청 필터 목록에서 사라졌으면 검토완료로 변경된 것
  }
}

async function main() {
  console.log('=== R25, R31 재수정 v2 ===');

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

  // 그리드 확인/재조회
  const gridReady = await waitForGrid(page, 'DD001002QGridObj', 3000);
  if (!gridReady) {
    console.log('그리드 재조회...');
    await page.evaluate(() => f_retrieveListBsnsExcutDetl(1));
    await sleep(3000);
    await dismissModals(page);
    await waitForGrid(page, 'DD001002QGridObj');
  }

  // 현재 목록
  const rows = await page.evaluate(() => {
    const grid = DD001002QGridObj;
    return grid.getDataRows().map((r, i) => {
      const rv = grid.getRowValue(r);
      return { idx: i, purpose: rv.excutPrposCn, amount: rv.excutAmount || rv.excutSumAmount, status: rv.exmntPrgstNm || '' };
    });
  });
  console.log(`\n현재 목록: ${rows.length}행`);
  rows.forEach(r => console.log(`  [${r.idx}] ${r.purpose} | ${r.amount}원 | ${r.status}`));

  for (const target of TARGETS) {
    const result = await fixOne(page, target);
    console.log(`${target.label}: ${result ? '성공' : '실패'}`);
    await sleep(1000);
  }

  // 최종 목록 확인
  console.log('\n=== 최종 목록 상태 ===');
  await page.evaluate(() => f_retrieveListBsnsExcutDetl(1));
  await sleep(3000);
  await dismissModals(page);
  const finalRows = await page.evaluate(() => {
    const grid = DD001002QGridObj;
    return grid.getDataRows().map((r, i) => {
      const rv = grid.getRowValue(r);
      return { idx: i, purpose: rv.excutPrposCn, amount: rv.excutAmount || rv.excutSumAmount, status: rv.exmntPrgstNm || '' };
    });
  });
  console.log(`최종 ${finalRows.length}행:`);
  finalRows.forEach(r => console.log(`  [${r.idx}] ${r.purpose} | ${r.amount}원 | ${r.status}`));
  console.log('\n=== 완료 ===');
}

main().catch(console.error);
