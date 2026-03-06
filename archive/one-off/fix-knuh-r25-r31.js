/**
 * R25, R31 보완요청 → 검토완료로 수정
 * 현재 그리드 상태: [2]=1114회의비(R25), [8]=1103회의비(R31)
 */
const { chromium } = require('playwright');

process.on('unhandledRejection', (err) => {
  if (err && err.message && err.message.includes('No dialog is showing')) return;
});

// 현재 그리드에서의 위치 + 금액 검증값
const FIXES = [
  { gridIdx: 2, amount: 182000, label: 'R25 1114회의비', desc: '외부인력9명, 16,545원/인' },
  { gridIdx: 8, amount: 255000, label: 'R31 1103회의비', desc: '12인분, 대구대 외부참석, 21,250원/인' },
];

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function waitAndDismissModal(page, timeout = 10000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const found = await page.evaluate(() => {
      const modal = document.querySelector('.popupMask.on');
      if (modal) {
        const ok = modal.querySelector('button.fn.ok, .fn.ok, footer button');
        if (ok) { ok.click(); return true; }
      }
      return false;
    }).catch(() => false);
    if (found) return true;
    await sleep(300);
  }
  return false;
}

async function dismissModalIfAny(page) {
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
  console.log('=== R25, R31 보완요청 → 검토완료 수정 ===\n');

  const browser = await chromium.connectOverCDP('http://localhost:9444');
  const context = browser.contexts()[0];
  let page = context.pages().find(p => p.url().includes('dd001'));
  if (!page) { console.log('ERROR: 페이지 없음'); return; }
  page.on('dialog', async d => { try { await d.accept(); } catch {} });

  await dismissModalIfAny(page);
  await sleep(300);

  // 상세 페이지면 복귀
  if (page.url().includes('DD001003S')) {
    await page.evaluate(() => f_prevPage()).catch(() => {});
    await sleep(3000);
    await dismissModalIfAny(page);
  }

  // 조회 실행 (그리드가 비어있을 수 있으므로)
  const gridReady = await waitForGrid(page, 'DD001002QGridObj', 3000);
  if (!gridReady) {
    console.log('그리드 재조회...');
    await page.evaluate(() => f_retrieveListBsnsExcutDetl(1));
    await sleep(3000);
    await dismissModalIfAny(page);
    await waitForGrid(page, 'DD001002QGridObj');
  }

  // 현재 그리드 확인
  const currentGrid = await page.evaluate(() => {
    const rows = DD001002QGridObj.getDataRows();
    return rows.map((r, i) => {
      const rv = DD001002QGridObj.getRowValue(r);
      return { idx: i, purpose: rv.excutPrposCn, amount: rv.excutAmount || rv.excutSumAmount };
    });
  });
  console.log(`현재 그리드: ${currentGrid.length}행`);
  currentGrid.forEach(r => console.log(`  [${r.idx}] ${r.purpose} ${r.amount}원`));
  console.log('');

  for (const fix of FIXES) {
    console.log(`--- ${fix.label} → 검토완료 (${fix.desc}) ---`);

    // 금액으로 행 찾기 (gridIdx가 변했을 수 있으므로)
    const targetIdx = await page.evaluate((amt) => {
      const rows = DD001002QGridObj.getDataRows();
      for (let i = 0; i < rows.length; i++) {
        const rv = DD001002QGridObj.getRowValue(rows[i]);
        const a = parseInt(String(rv.excutAmount || rv.excutSumAmount).replace(/,/g, ''));
        if (a === amt) return i;
      }
      return -1;
    }, fix.amount);

    if (targetIdx < 0) {
      console.log(`    ERROR: 금액 ${fix.amount}원 행을 찾을 수 없음`);
      continue;
    }

    // 1. 행 선택
    const rowInfo = await page.evaluate((idx) => {
      const grid = DD001002QGridObj;
      const rows = grid.getDataRows();
      grid.selectRow(rows[idx]);
      const rv = grid.getRowValue(rows[idx]);
      return { purpose: rv.excutPrposCn, amount: rv.excutAmount || rv.excutSumAmount };
    }, targetIdx);
    console.log(`    행 선택 [${targetIdx}]: ${rowInfo.purpose} (${rowInfo.amount}원)`);
    await sleep(500);

    // 2. 세부내역검토 → 상세
    await page.click('#DD001002Q_detlListExmnt');
    await sleep(3000);

    const modal = await page.evaluate(() => {
      const m = document.querySelector('.popupMask.on');
      return m ? (m.querySelector('.message')?.textContent?.trim() || null) : null;
    }).catch(() => null);
    if (modal) {
      console.log(`    모달: ${modal}`);
      await dismissModalIfAny(page);
      continue;
    }

    const detailOk = await waitForGrid(page, 'DD001003SGridObj');
    if (!detailOk) {
      console.log('    ERROR: 상세 그리드 로드 실패');
      await page.evaluate(() => f_prevPage()).catch(() => {});
      await sleep(3000);
      continue;
    }

    // 현재 상세 상태 확인
    const detailStatus = await page.evaluate(() => {
      const grid = DD001003SGridObj;
      const rows = grid.getDataRows();
      return rows.map(r => {
        const rv = grid.getRowValue(r);
        return {
          pfrsChckSttusCode: rv.pfrsChckSttusCode,
          nrcgnAmount: rv.nrcgnAmount,
          exclexCn: (rv.exclexCn || '').substring(0, 50),
        };
      });
    });
    console.log(`    현재 상태: ${JSON.stringify(detailStatus)}`);

    // 3. 검토완료 설정
    await page.evaluate(() => {
      f_changeExmntPrgst("001");  // 검토완료: nrcgnAmount=0, exclexCn 클리어
    });
    console.log('    → 검토완료 설정');

    // 4. 저장
    await page.click('#DD001003S_btnSave');
    await sleep(500);

    const confirmed = await waitAndDismissModal(page, 5000);
    if (confirmed) {
      console.log('    확인 모달 OK');
    } else {
      console.log('    WARNING: 확인 모달 없음');
      const errMsg = await page.evaluate(() => {
        const m = document.querySelector('.popupMask.on');
        return m ? (m.querySelector('.message')?.textContent?.trim() || '') : '';
      }).catch(() => '');
      if (errMsg) console.log(`    에러: ${errMsg}`);
      await dismissModalIfAny(page);
    }

    await sleep(2000);
    const success = await waitAndDismissModal(page, 10000);
    console.log(success ? '    저장 완료' : '    WARNING: 성공 모달 대기 초과');
    await dismissModalIfAny(page);
    await sleep(1000);

    // 5. 이전 페이지
    await page.evaluate(() => f_prevPage()).catch(() => {});
    await sleep(3000);
    await dismissModalIfAny(page);
    await sleep(500);
    await waitForGrid(page, 'DD001002QGridObj', 10000);

    console.log('    완료\n');
  }

  console.log('=== 수정 완료 ===');
}

main().catch(console.error);
