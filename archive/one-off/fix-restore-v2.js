/**
 * R1(383880), R9(80000), R10(160300), R11(196000) 복원
 * 올바른 필터: DD001002Q_selExmntPrgstCode
 * DOM 클릭으로 행 선택 (getFocusedRow)
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

// DOM에서 purpose 텍스트 셀을 찾아 클릭 → getFocusedRow 설정
async function clickRowByPurpose(page, purpose) {
  const coords = await page.evaluate((text) => {
    const allTds = document.querySelectorAll('td');
    for (const td of allTds) {
      if (td.textContent.trim() === text) {
        const rect = td.getBoundingClientRect();
        if (rect.height > 0 && rect.width > 0) {
          return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
        }
      }
    }
    return null;
  }, purpose);

  if (coords) {
    await page.mouse.click(coords.x, coords.y);
    return true;
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
  // selExmntPrgstCode 변경 (select 요소)
  await page.evaluate((code) => {
    const sel = document.getElementById('DD001002Q_selExmntPrgstCode');
    if (sel) {
      sel.value = code;
      // 옵션이 없으면 추가
      let found = false;
      for (const opt of sel.options) {
        if (opt.value === code) { found = true; break; }
      }
      if (!found && code) {
        const opt = document.createElement('option');
        opt.value = code;
        opt.text = code === '001' ? '검토완료' : code === '002' ? '보완요청' : '전체';
        sel.appendChild(opt);
        sel.value = code;
      }
    }
    // hidden 필드도 같이 변경
    const h1 = document.getElementById('DD001002Q_pExmntPrgstCode');
    const h2 = document.getElementById('DD001002Q_pselExmntPrgstCode');
    if (h1) h1.value = code;
    if (h2) h2.value = code;
  }, filterCode);

  await page.evaluate(() => {
    const el = document.getElementById('DD001002Q_nPageSize');
    if (el) el.value = '50';
  });

  await page.evaluate(() => f_retrieveListBsnsExcutDetl(1));
  await sleep(3000);
  await dismissModals(page);
}

async function fixOne(page, target) {
  console.log(`\n--- ${target.label} (${target.amount}원) → 보완요청 ---`);

  // 검토완료 필터로 재조회
  await queryWithFilter(page, '001');
  const gridReady = await waitForGrid(page, 'DD001002QGridObj', 10000);
  if (!gridReady) {
    console.log('  그리드 로드 실패 (검토완료 항목 없음?)');
    return 'no_grid';
  }

  // 목록에서 찾기
  const rowInfo = await page.evaluate((amt) => {
    const grid = DD001002QGridObj;
    const rows = grid.getDataRows();
    const all = [];
    let target = null;
    for (let i = 0; i < rows.length; i++) {
      const rv = grid.getRowValue(rows[i]);
      const a = parseInt(String(rv.excutAmount || rv.excutSumAmount).replace(/,/g, ''));
      all.push({ idx: i, purpose: rv.excutPrposCn, amount: a, status: rv.exmntPrgstNm || '' });
      if (a === amt) target = { idx: i, purpose: rv.excutPrposCn, amount: a };
    }
    return { target, total: all.length, rows: all };
  }, target.amount);

  if (!rowInfo.target) {
    console.log(`  못 찾음 (검토완료 ${rowInfo.total}행 중)`);
    rowInfo.rows.forEach(r => console.log(`    [${r.idx}] ${r.purpose} | ${r.amount}원 | ${r.status}`));
    return 'not_found';
  }
  console.log(`  찾음: [${rowInfo.target.idx}] ${rowInfo.target.purpose}`);

  // DOM 클릭으로 행 선택
  const clicked = await clickRowByPurpose(page, rowInfo.target.purpose);
  if (!clicked) {
    console.log('  DOM 클릭 실패, 금액으로 시도');
    const amtStr = target.amount.toLocaleString();
    const amtClicked = await page.evaluate((amt) => {
      const allTds = document.querySelectorAll('td');
      for (const td of allTds) {
        if (td.textContent.trim() === amt) {
          const rect = td.getBoundingClientRect();
          if (rect.height > 0 && rect.width > 0) {
            return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
          }
        }
      }
      return null;
    }, amtStr);
    if (amtClicked) {
      await page.mouse.click(amtClicked.x, amtClicked.y);
    } else {
      console.log('  금액 클릭도 실패');
      return 'click_fail';
    }
  }
  await sleep(1000);

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

  // 금액 재확인
  const detail = await page.evaluate(() => {
    const grid = DD001003SGridObj;
    const rv = grid.getRowValue(grid.getDataRows()[0]);
    return {
      amount: parseInt(String(rv.excutSumAmount).replace(/,/g, '')),
      status: rv.pfrsChckSttusCode,
    };
  });
  console.log(`  상세: ${detail.amount}원 | 상태=${detail.status}`);

  if (detail.amount !== target.amount) {
    console.log(`  ERROR: 금액 불일치 → 복귀`);
    await page.evaluate(() => f_prevPage()).catch(() => {});
    await sleep(3000);
    await dismissModals(page);
    return 'wrong_row';
  }

  if (detail.status === '002') {
    console.log('  이미 보완요청 → 스킵');
    await page.evaluate(() => f_prevPage()).catch(() => {});
    await sleep(3000);
    await dismissModals(page);
    return 'already_ok';
  }

  // 보완요청 설정
  console.log('  → 보완요청 설정');
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

  // 확인
  const afterSet = await page.evaluate(() => {
    const grid = DD001003SGridObj;
    const rv = grid.getRowValue(grid.getDataRows()[0]);
    return { status: rv.pfrsChckSttusCode, comment: (rv.exclexCn || '').substring(0, 40) };
  });
  console.log(`  세팅: ${JSON.stringify(afterSet)}`);

  // 저장
  await page.click('#DD001003S_btnSave');
  await sleep(1000);
  const c = await waitModal(page, 8000);
  console.log(`  확인: ${c}`);
  await sleep(3000);
  const r = await waitModal(page, 15000);
  console.log(`  결과: ${r}`);
  await dismissModals(page);

  // 이전 페이지
  await page.evaluate(() => f_prevPage()).catch(() => {});
  await sleep(3000);
  await dismissModals(page);

  console.log('  완료');
  return 'ok';
}

async function main() {
  console.log('=== 4건 보완요청 복원 v2 ===\n');

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

  // 먼저 검토완료 필터로 전체 목록 확인
  console.log('--- 검토완료 필터 조회 ---');
  await queryWithFilter(page, '001');
  const gridOk = await waitForGrid(page, 'DD001002QGridObj', 10000);

  if (gridOk) {
    const rows = await page.evaluate(() => {
      const grid = DD001002QGridObj;
      return grid.getDataRows().map((r, i) => {
        const rv = grid.getRowValue(r);
        return { idx: i, purpose: rv.excutPrposCn, amount: parseInt(String(rv.excutAmount || rv.excutSumAmount).replace(/,/g, '')), status: rv.exmntPrgstNm || '' };
      });
    });
    console.log(`검토완료: ${rows.length}행`);
    rows.forEach(r => console.log(`  [${r.idx}] ${r.purpose} | ${r.amount}원 | ${r.status}`));

    // 타겟 확인
    for (const t of TARGETS) {
      const f = rows.find(r => r.amount === t.amount);
      console.log(`  ${t.label}: ${f ? 'FOUND' : 'not found'}`);
    }
  } else {
    console.log('검토완료 항목 없음 (그리드 비어있음)');
  }

  // 페이징 확인
  const paging = await page.evaluate(() => {
    const nav = document.getElementById('DD001002Q_sbGridPaging');
    return nav ? nav.textContent.trim() : 'not found';
  });
  console.log('페이징:', paging);

  // 각 항목 처리
  const results = {};
  for (const target of TARGETS) {
    results[target.label] = await fixOne(page, target);
    await sleep(1000);
  }

  // 최종 확인 - 보완요청 필터
  console.log('\n\n=== 최종 확인 (보완요청) ===');
  await queryWithFilter(page, '002');
  const finalOk = await waitForGrid(page, 'DD001002QGridObj', 10000);
  if (finalOk) {
    const finalRows = await page.evaluate(() => {
      const grid = DD001002QGridObj;
      return grid.getDataRows().map((r, i) => {
        const rv = grid.getRowValue(r);
        return { idx: i, purpose: rv.excutPrposCn, amount: rv.excutAmount || rv.excutSumAmount, status: rv.exmntPrgstNm || '' };
      });
    });
    console.log(`보완요청: ${finalRows.length}행`);
    finalRows.forEach(r => console.log(`  [${r.idx}] ${r.purpose} | ${r.amount}원 | ${r.status}`));
  }

  console.log('\n--- 결과 ---');
  for (const [k, v] of Object.entries(results)) {
    console.log(`  ${k}: ${v}`);
  }
  console.log('\n=== 완료 ===');
}

main().catch(console.error);
