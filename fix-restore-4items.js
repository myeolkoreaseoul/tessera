/**
 * R1(383880), R9(80000), R10(160300), R11(196000) 을
 * 검토완료 → 보완요청(증빙미첨부)으로 복원
 *
 * 1) 필터를 검토완료("001")로 변경하여 전체 조회
 * 2) 해당 금액 행 찾기
 * 3) DOM 텍스트 클릭으로 행 선택
 * 4) 보완요청 설정 + 코멘트 + 저장
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

// DOM에서 금액 텍스트를 찾아 해당 행 클릭
async function clickRowByAmount(page, amountStr) {
  const coords = await page.evaluate((amt) => {
    const allTds = document.querySelectorAll('td');
    for (const td of allTds) {
      const text = td.textContent.trim();
      if (text === amt) {
        const rect = td.getBoundingClientRect();
        if (rect.height > 0 && rect.width > 0) {
          return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
        }
      }
    }
    return null;
  }, amountStr);

  if (coords) {
    await page.mouse.click(coords.x, coords.y);
    return true;
  }
  return false;
}

const TARGETS = [
  { amount: 383880, amountStr: '383,880', label: 'R1 11월인건비', comment: '증빙파일 미첨부 → 보완 요청 (회의록, 영수증)' },
  { amount: 80000, amountStr: '80,000', label: 'R9 1127회의비', comment: '증빙파일 미첨부 → 보완 요청 (근로계약서, 급여명세서, 지급명세서)' },
  { amount: 160300, amountStr: '160,300', label: 'R10 1110회의비', comment: '증빙파일 미첨부 → 보완 요청 (회의록, 영수증)' },
  { amount: 196000, amountStr: '196,000', label: 'R11 1107회의비', comment: '증빙파일 미첨부 → 보완 요청 (회의록, 영수증)' },
];

async function fixOne(page, target) {
  console.log(`\n--- ${target.label} (${target.amountStr}원) → 보완요청 ---`);

  // 그리드에서 해당 금액 확인
  const found = await page.evaluate((amt) => {
    const grid = DD001002QGridObj;
    const rows = grid.getDataRows();
    for (let i = 0; i < rows.length; i++) {
      const rv = grid.getRowValue(rows[i]);
      const a = parseInt(String(rv.excutAmount || rv.excutSumAmount).replace(/,/g, ''));
      if (a === amt) return { idx: i, purpose: rv.excutPrposCn, status: rv.exmntPrgstNm || '' };
    }
    return null;
  }, target.amount);

  if (!found) {
    console.log('  목록에서 못 찾음 (이미 보완요청이거나 다른 페이지)');
    return 'not_found';
  }
  console.log(`  [${found.idx}] ${found.purpose} | ${found.status}`);

  // DOM 클릭으로 행 선택
  const purposeText = found.purpose;
  const clicked = await page.evaluate((purpose) => {
    const allTds = document.querySelectorAll('td');
    for (const td of allTds) {
      if (td.textContent.trim() === purpose) {
        const rect = td.getBoundingClientRect();
        if (rect.height > 0 && rect.width > 0) {
          return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
        }
      }
    }
    return null;
  }, purposeText);

  if (clicked) {
    await page.mouse.click(clicked.x, clicked.y);
    await sleep(1000);
  } else {
    // 금액으로 시도
    const amtClicked = await clickRowByAmount(page, target.amountStr);
    if (!amtClicked) {
      console.log('  DOM 클릭 실패');
      return 'click_fail';
    }
    await sleep(1000);
  }

  // 포커스 확인
  const focused = await page.evaluate(() => {
    const grid = DD001002QGridObj;
    const fr = grid.getFocusedRow();
    if (fr) {
      const rv = grid.getRowValue(fr);
      return { amount: parseInt(String(rv.excutAmount || rv.excutSumAmount).replace(/,/g, '')), purpose: rv.excutPrposCn };
    }
    return null;
  });
  console.log(`  포커스: ${JSON.stringify(focused)}`);

  if (!focused || focused.amount !== target.amount) {
    console.log(`  포커스 불일치! (${focused?.amount} ≠ ${target.amount})`);
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

  // 금액 재확인
  const detail = await page.evaluate(() => {
    const grid = DD001003SGridObj;
    const rv = grid.getRowValue(grid.getDataRows()[0]);
    return {
      amount: parseInt(String(rv.excutSumAmount).replace(/,/g, '')),
      status: rv.pfrsChckSttusCode,
      purpose: rv.excutPrposCn,
    };
  });
  console.log(`  상세: ${detail.purpose} | ${detail.amount}원 | 상태=${detail.status}`);

  if (detail.amount !== target.amount) {
    console.log(`  ERROR: 금액 불일치 (${detail.amount} ≠ ${target.amount}) → 복귀`);
    await page.evaluate(() => f_prevPage()).catch(() => {});
    await sleep(3000);
    await dismissModals(page);
    return 'wrong_row';
  }

  // 보완요청 설정
  console.log('  → 보완요청 설정');
  await page.click('#DD001003S_btnExmntPrgst002');  // 일괄 보완요청
  await sleep(1000);

  // 코멘트 설정 (그리드 직접 세팅)
  const htmlComment = target.comment.replace(/\n/g, '<br>');
  await page.evaluate((comment) => {
    const grid = DD001003SGridObj;
    const row = grid.getDataRows()[0];
    grid.setValue(row, "exclexCn", comment);
    grid.setValue(row, "orgExclexCn", comment);
    // nrcgnAmount = 0 (증빙미첨부이므로 불인정금액 없음)
    grid.setValue(row, "nrcgnAmount", "0");
  }, htmlComment);
  console.log(`  코멘트: ${target.comment.substring(0, 50)}`);

  // 변경 확인
  const afterSet = await page.evaluate(() => {
    const grid = DD001003SGridObj;
    const rv = grid.getRowValue(grid.getDataRows()[0]);
    return { status: rv.pfrsChckSttusCode, nrcgn: rv.nrcgnAmount, comment: (rv.exclexCn || '').substring(0, 50) };
  });
  console.log(`  세팅 확인: ${JSON.stringify(afterSet)}`);

  // 저장
  await page.click('#DD001003S_btnSave');
  await sleep(1000);
  const c = await waitModal(page, 8000);
  console.log(`  확인: ${c}`);
  await sleep(3000);
  const r = await waitModal(page, 15000);
  console.log(`  결과: ${r}`);
  await dismissModals(page);

  // 저장 후 상태
  const saved = await page.evaluate(() => {
    const grid = DD001003SGridObj;
    const rv = grid.getRowValue(grid.getDataRows()[0]);
    return { status: rv.pfrsChckSttusCode, orgStatus: rv.orgPfrsChckSttusCode };
  }).catch(() => null);
  console.log(`  저장후: ${JSON.stringify(saved)}`);

  // 이전 페이지
  await page.evaluate(() => f_prevPage()).catch(() => {});
  await sleep(3000);
  await dismissModals(page);
  await waitForGrid(page, 'DD001002QGridObj', 10000);

  console.log('  완료');
  return 'ok';
}

async function main() {
  console.log('=== 4건 보완요청 복원 ===\n');

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

  // Step 1: 필터를 "검토완료"로 변경
  console.log('필터 변경: 보완요청(002) → 검토완료(001)');
  await page.evaluate(() => {
    const h1 = document.getElementById('DD001002Q_pExmntPrgstCode');
    const h2 = document.getElementById('DD001002Q_pselExmntPrgstCode');
    if (h1) h1.value = '001';
    if (h2) h2.value = '001';
  });

  // 페이지 사이즈 50으로
  await page.evaluate(() => {
    const el = document.getElementById('DD001002Q_nPageSize');
    if (el) el.value = '50';
  });

  // 조회
  console.log('조회...');
  await page.evaluate(() => f_retrieveListBsnsExcutDetl(1));
  await sleep(3000);
  await dismissModals(page);
  await waitForGrid(page, 'DD001002QGridObj');

  // 목록 확인
  const rows = await page.evaluate(() => {
    const grid = DD001002QGridObj;
    return grid.getDataRows().map((r, i) => {
      const rv = grid.getRowValue(r);
      return {
        idx: i,
        purpose: rv.excutPrposCn,
        amount: parseInt(String(rv.excutAmount || rv.excutSumAmount).replace(/,/g, '')),
        status: rv.exmntPrgstNm || '',
      };
    });
  });
  console.log(`\n검토완료 목록: ${rows.length}행`);
  rows.forEach(r => console.log(`  [${r.idx}] ${r.purpose} | ${r.amount}원 | ${r.status}`));

  // 타겟 확인
  console.log('\n--- 타겟 확인 ---');
  for (const t of TARGETS) {
    const found = rows.find(r => r.amount === t.amount);
    console.log(`  ${t.label} (${t.amountStr}): ${found ? `[${found.idx}] ${found.status}` : '없음'}`);
  }

  // 각 항목 처리
  const results = {};
  for (const target of TARGETS) {
    // 매번 재조회 (이전 항목이 검토완료에서 보완요청으로 바뀌면 목록이 변할 수 있음)
    await page.evaluate(() => {
      const h1 = document.getElementById('DD001002Q_pExmntPrgstCode');
      const h2 = document.getElementById('DD001002Q_pselExmntPrgstCode');
      if (h1) h1.value = '001';
      if (h2) h2.value = '001';
    });
    await page.evaluate(() => f_retrieveListBsnsExcutDetl(1));
    await sleep(3000);
    await dismissModals(page);
    await waitForGrid(page, 'DD001002QGridObj', 10000);

    results[target.label] = await fixOne(page, target);
    await sleep(1000);
  }

  // 최종 확인 - 보완요청 필터로 복원
  console.log('\n\n=== 최종 확인 (보완요청 필터) ===');
  await page.evaluate(() => {
    const h1 = document.getElementById('DD001002Q_pExmntPrgstCode');
    const h2 = document.getElementById('DD001002Q_pselExmntPrgstCode');
    if (h1) h1.value = '002';
    if (h2) h2.value = '002';
  });
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
  console.log(`보완요청: ${finalRows.length}행`);
  finalRows.forEach(r => console.log(`  [${r.idx}] ${r.purpose} | ${r.amount}원 | ${r.status}`));

  console.log('\n--- 결과 요약 ---');
  for (const [k, v] of Object.entries(results)) {
    console.log(`  ${k}: ${v}`);
  }
  console.log('\n=== 완료 ===');
}

main().catch(console.error);
