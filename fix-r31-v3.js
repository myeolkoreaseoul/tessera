/**
 * R31(255,000) - DOM 행 매핑 탐색 후 클릭
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
  console.log('=== R31 (255000원) v3 - DOM 매핑 ===\n');

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

  await page.evaluate(() => f_retrieveListBsnsExcutDetl(1));
  await sleep(3000);
  await dismissModals(page);
  await waitForGrid(page, 'DD001002QGridObj');

  // Step 1: 그리드 DOM 구조 탐색 - 모든 tr의 텍스트와 좌표
  const domInfo = await page.evaluate(() => {
    const result = {};

    // DD001002Q_GridArea 내부 탐색
    const gridArea = document.getElementById('DD001002Q_GridArea');
    if (gridArea) {
      result.gridArea = {
        tagName: gridArea.tagName,
        children: Array.from(gridArea.children).map(c => ({
          tagName: c.tagName, id: c.id, className: (c.className || '').substring(0, 50),
        })),
      };
    }

    // DD001002QGridObj 요소 탐색
    const gridEl = document.getElementById('DD001002QGridObj');
    if (gridEl) {
      result.gridObj = {
        tagName: gridEl.tagName,
        children: Array.from(gridEl.children).slice(0, 5).map(c => ({
          tagName: c.tagName, id: c.id || '', className: (c.className || '').substring(0, 50),
        })),
      };

      // iframe인 경우
      if (gridEl.tagName === 'IFRAME') {
        result.isIframe = true;
      }
    }

    // 그리드 영역의 모든 table 찾기
    const tables = gridArea ? gridArea.querySelectorAll('table') : document.querySelectorAll('table');
    result.tables = Array.from(tables).slice(0, 5).map(t => ({
      id: t.id || '',
      className: (t.className || '').substring(0, 50),
      rows: t.rows ? t.rows.length : 0,
    }));

    // "255,000" 또는 "255000" 포함 요소 찾기
    const allTds = document.querySelectorAll('td');
    const matchingTds = [];
    allTds.forEach(td => {
      const text = td.textContent.trim();
      if (text.includes('255,000') || text.includes('255000') || text.includes('1103')) {
        const rect = td.getBoundingClientRect();
        matchingTds.push({
          text: text.substring(0, 40),
          x: rect.x + rect.width / 2,
          y: rect.y + rect.height / 2,
          visible: rect.height > 0 && rect.width > 0,
          parent: td.parentElement ? td.parentElement.tagName : null,
          rowIdx: td.parentElement && td.parentElement.rowIndex != null ? td.parentElement.rowIndex : null,
        });
      }
    });
    result.matchingTds = matchingTds;

    return result;
  });

  console.log('그리드 DOM 구조:');
  console.log(JSON.stringify(domInfo, null, 2));

  // "255,000" 또는 "1103"이 포함된 visible td 찾기
  const visibleMatches = (domInfo.matchingTds || []).filter(td => td.visible);
  console.log(`\n255000/1103 포함 visible 셀: ${visibleMatches.length}개`);
  visibleMatches.forEach(m => console.log(`  "${m.text}" at (${m.x.toFixed(0)}, ${m.y.toFixed(0)})`));

  if (visibleMatches.length === 0) {
    console.log('ERROR: 매칭되는 셀 없음');

    // iframe 내부도 확인
    const frames = page.frames();
    console.log(`\nFrames: ${frames.length}`);
    for (const frame of frames) {
      const url = frame.url();
      console.log(`  ${url.substring(0, 80)}`);
      const hasGrid = await frame.evaluate(() => {
        return typeof DD001002QGridObj !== 'undefined';
      }).catch(() => false);
      if (hasGrid) {
        console.log('  → DD001002QGridObj 존재!');
      }
    }
    return;
  }

  // 1103이 포함된 셀의 행 전체를 클릭
  const targetCell = visibleMatches.find(m => m.text.includes('1103'));
  if (!targetCell) {
    console.log('1103 텍스트 셀 못 찾음, 255000으로 시도');
    const amtCell = visibleMatches.find(m => m.text.includes('255'));
    if (!amtCell) { console.log('ERROR'); return; }
    console.log(`\n금액 셀 클릭: (${amtCell.x.toFixed(0)}, ${amtCell.y.toFixed(0)})`);
    await page.mouse.click(amtCell.x, amtCell.y);
  } else {
    console.log(`\n1103 셀 클릭: (${targetCell.x.toFixed(0)}, ${targetCell.y.toFixed(0)})`);
    await page.mouse.click(targetCell.x, targetCell.y);
  }
  await sleep(1000);

  // 포커스 확인
  const focused = await page.evaluate(() => {
    const grid = DD001002QGridObj;
    if (typeof grid.getFocusedRow === 'function') {
      const fr = grid.getFocusedRow();
      if (fr != null) {
        const rv = grid.getRowValue(fr);
        return { amount: parseInt(String(rv.excutAmount || rv.excutSumAmount).replace(/,/g, '')), purpose: rv.excutPrposCn };
      }
    }
    return null;
  });
  console.log('포커스 행:', JSON.stringify(focused));

  if (focused && focused.amount !== 255000) {
    console.log('포커스가 255000이 아님 - 다시 시도');

    // selectRow로도 시도
    await page.evaluate(() => {
      const grid = DD001002QGridObj;
      const rows = grid.getDataRows();
      for (let i = 0; i < rows.length; i++) {
        const rv = grid.getRowValue(rows[i]);
        const a = parseInt(String(rv.excutAmount || rv.excutSumAmount).replace(/,/g, ''));
        if (a === 255000) {
          grid.selectRow(rows[i]);
          // 이벤트 강제 발생
          if (grid.onAfterClick) {
            try { grid.onAfterClick({ row: rows[i], rowIndex: i }); } catch(e) {}
          }
          break;
        }
      }
    });
    await sleep(500);

    const focused2 = await page.evaluate(() => {
      const grid = DD001002QGridObj;
      const fr = grid.getFocusedRow();
      if (fr) {
        const rv = grid.getRowValue(fr);
        return { amount: parseInt(String(rv.excutAmount || rv.excutSumAmount).replace(/,/g, '')), purpose: rv.excutPrposCn };
      }
      return null;
    });
    console.log('재시도 포커스:', JSON.stringify(focused2));
  }

  // 세부내역검토
  console.log('\n세부내역검토...');
  await page.click('#DD001002Q_detlListExmnt');
  await sleep(4000);
  await dismissModals(page);

  const detailReady = await waitForGrid(page, 'DD001003SGridObj', 15000);
  if (!detailReady) { console.log('상세 로드 실패'); return; }

  const detail = await page.evaluate(() => {
    const grid = DD001003SGridObj;
    const rv = grid.getRowValue(grid.getDataRows()[0]);
    return { amount: rv.excutSumAmount, status: rv.pfrsChckSttusCode, purpose: rv.excutPrposCn };
  });
  console.log('상세:', JSON.stringify(detail));

  const amt = parseInt(String(detail.amount).replace(/,/g, ''));
  if (amt !== 255000) {
    console.log(`금액 불일치 (${amt}) - 복귀`);
    await page.evaluate(() => f_prevPage()).catch(() => {});
    await sleep(3000);
    await dismissModals(page);
    return;
  }

  // 검토완료
  await page.click('#DD001003S_btnExmntPrgst001');
  await sleep(1000);
  console.log('→ 검토완료');

  // 저장
  await page.click('#DD001003S_btnSave');
  await sleep(1000);
  console.log('확인:', await waitModal(page, 8000));
  await sleep(3000);
  console.log('결과:', await waitModal(page, 15000));
  await dismissModals(page);

  const afterSave = await page.evaluate(() => {
    const grid = DD001003SGridObj;
    const rv = grid.getRowValue(grid.getDataRows()[0]);
    return { status: rv.pfrsChckSttusCode, orgStatus: rv.orgPfrsChckSttusCode };
  }).catch(() => null);
  console.log('저장후:', JSON.stringify(afterSave));

  // 복귀
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
}

main().catch(console.error);
