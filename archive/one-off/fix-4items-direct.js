/**
 * R1,R9,R10,R11 → 보완요청 복원
 * 검토완료 필터로 그리드 로드 후 DOM 클릭으로 행 선택
 *
 * 핵심: f_retrieveListBsnsExcutDetl 호출 전에 selExmntPrgstCode를
 * "001"로 변경. 단, XHR.prototype이 오염됐으므로 먼저 복원 필요.
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
  { amount: 383880, excutId: 'EXE20251212067828803', label: 'R1 11월인건비', comment: '증빙파일 미첨부 → 보완 요청 (회의록, 영수증)' },
  { amount: 80000, excutId: 'EXE20251202067406366', label: 'R9 1127회의비', comment: '증빙파일 미첨부 → 보완 요청 (근로계약서, 급여명세서, 지급명세서)' },
  { amount: 160300, excutId: 'EXE20251118066841961', label: 'R10 1110회의비', comment: '증빙파일 미첨부 → 보완 요청 (회의록, 영수증)' },
  { amount: 196000, excutId: 'EXE20251118066841486', label: 'R11 1107회의비', comment: '증빙파일 미첨부 → 보완 요청 (회의록, 영수증)' },
];

async function loadGridWithFilter(page, filterCode) {
  // XHR 복원 (이전 인터셉트 코드가 오염시킴)
  await page.evaluate(() => {
    if (!window._xhrRestored) {
      const iframe = document.createElement('iframe');
      iframe.style.display = 'none';
      document.body.appendChild(iframe);
      XMLHttpRequest.prototype.open = iframe.contentWindow.XMLHttpRequest.prototype.open;
      XMLHttpRequest.prototype.send = iframe.contentWindow.XMLHttpRequest.prototype.send;
      document.body.removeChild(iframe);
      window._xhrRestored = true;
    }
  });

  // select 값 변경
  await page.evaluate((code) => {
    document.getElementById('DD001002Q_selExmntPrgstCode').value = code;
  }, filterCode);

  // f_retrieveListBsnsExcutDetl 호출 - 내부에서 select val()을 읽음
  await page.evaluate(() => f_retrieveListBsnsExcutDetl(1));
  await sleep(4000);
  await dismissModals(page);
}

async function main() {
  console.log('=== 4건 보완요청 복원 (직접 접근) ===\n');

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

  // XHR 복원
  await page.evaluate(() => {
    const iframe = document.createElement('iframe');
    iframe.style.display = 'none';
    document.body.appendChild(iframe);
    XMLHttpRequest.prototype.open = iframe.contentWindow.XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.send = iframe.contentWindow.XMLHttpRequest.prototype.send;
    document.body.removeChild(iframe);
    window._xhrRestored = true;
    console.log('XHR restored');
  });

  // 검토완료 필터로 그리드 로드
  console.log('검토완료 필터로 조회...');
  await loadGridWithFilter(page, '001');
  const gridOk = await waitForGrid(page, 'DD001002QGridObj', 10000);

  if (!gridOk) {
    console.log('그리드 로드 실패');
    return;
  }

  const rows = await page.evaluate(() => {
    const grid = DD001002QGridObj;
    return grid.getDataRows().map((r, i) => {
      const rv = grid.getRowValue(r);
      return {
        idx: i,
        purpose: rv.excutPrposCn,
        amount: parseInt(String(rv.excutAmount || rv.excutSumAmount).replace(/,/g, '')),
        status: rv.exmntPrgstNm || '',
        excutId: rv.excutId || '',
      };
    });
  });
  console.log(`그리드: ${rows.length}행`);
  rows.forEach(r => console.log(`  [${r.idx}] ${r.purpose} | ${r.amount}원 | ${r.status} | ${r.excutId}`));

  // 각 타겟 처리
  for (const target of TARGETS) {
    console.log(`\n=== ${target.label} (${target.amount}원) → 보완요청 ===`);

    // 매번 검토완료 필터 재조회 (이전 항목이 변경되면 목록이 바뀜)
    await loadGridWithFilter(page, '001');
    const gr = await waitForGrid(page, 'DD001002QGridObj', 10000);
    if (!gr) {
      console.log('  그리드 비어있음 (검토완료 항목 없음?)');
      continue;
    }

    // 그리드에서 찾기
    const rowData = await page.evaluate((amt) => {
      const grid = DD001002QGridObj;
      const rows = grid.getDataRows();
      for (let i = 0; i < rows.length; i++) {
        const rv = grid.getRowValue(rows[i]);
        const a = parseInt(String(rv.excutAmount || rv.excutSumAmount).replace(/,/g, ''));
        if (a === amt) return { idx: i, purpose: rv.excutPrposCn };
      }
      return null;
    }, target.amount);

    if (!rowData) {
      console.log('  목록에서 못 찾음');
      continue;
    }
    console.log(`  [${rowData.idx}] ${rowData.purpose}`);

    // DOM 클릭으로 행 선택
    const coords = await page.evaluate((text) => {
      const tds = document.querySelectorAll('td');
      for (const td of tds) {
        if (td.textContent.trim() === text) {
          const rect = td.getBoundingClientRect();
          if (rect.height > 0 && rect.width > 0) {
            return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
          }
        }
      }
      return null;
    }, rowData.purpose);

    if (!coords) {
      console.log('  DOM 클릭 실패');
      continue;
    }
    await page.mouse.click(coords.x, coords.y);
    await sleep(1000);

    // 포커스 확인
    const focused = await page.evaluate(() => {
      const grid = DD001002QGridObj;
      const fr = grid.getFocusedRow();
      if (!fr) return null;
      const rv = grid.getRowValue(fr);
      return { amount: parseInt(String(rv.excutAmount || rv.excutSumAmount).replace(/,/g, '')) };
    });

    if (!focused || focused.amount !== target.amount) {
      console.log(`  포커스 불일치 (${focused?.amount})`);
      continue;
    }

    // 세부내역검토
    await page.click('#DD001002Q_detlListExmnt');
    await sleep(4000);
    await dismissModals(page);

    const detailOk = await waitForGrid(page, 'DD001003SGridObj', 15000);
    if (!detailOk) {
      console.log('  상세 로드 실패');
      continue;
    }

    // 금액 확인
    const detail = await page.evaluate(() => {
      const grid = DD001003SGridObj;
      const rv = grid.getRowValue(grid.getDataRows()[0]);
      return { amount: parseInt(String(rv.excutSumAmount).replace(/,/g, '')), status: rv.pfrsChckSttusCode };
    });

    if (detail.amount !== target.amount) {
      console.log(`  금액 불일치 (${detail.amount} ≠ ${target.amount}) → 복귀`);
      await page.evaluate(() => f_prevPage()).catch(() => {});
      await sleep(3000);
      await dismissModals(page);
      continue;
    }
    console.log(`  상세 확인: ${detail.amount}원 | 상태=${detail.status}`);

    // 보완요청 설정
    await page.click('#DD001003S_btnExmntPrgst002');
    await sleep(1000);

    // 코멘트
    const htmlComment = target.comment.replace(/\n/g, '<br>');
    await page.evaluate((comment) => {
      const grid = DD001003SGridObj;
      const row = grid.getDataRows()[0];
      grid.setValue(row, "exclexCn", comment);
      grid.setValue(row, "orgExclexCn", comment);
      grid.setValue(row, "nrcgnAmount", "0");
    }, htmlComment);
    console.log(`  → 보완요청 + 코멘트 설정`);

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
  }

  // 최종 확인 - 직접 XHR로
  console.log('\n\n=== 최종 상태 확인 (XHR) ===');
  const final = await page.evaluate(() => {
    return new Promise((resolve) => {
      const token = document.querySelector("meta[name='_csrf']")?.content || '';
      const headerName = document.querySelector("meta[name='_csrf_header']")?.content || '';
      const results = {};

      function query(filter, label) {
        return new Promise((res) => {
          const p = new URLSearchParams({
            bsnsyear: document.getElementById('DD001002Q_bsnsyear')?.value || '',
            taskNo: document.getElementById('DD001002Q_taskNo')?.value || '',
            requstDeFrom: (document.getElementById('DD001002Q_requstDeFrom')?.value || '').replaceAll('-', ''),
            requstDeTo: (document.getElementById('DD001002Q_requstDeTo')?.value || '').replaceAll('-', ''),
            exmntPrgstCode: filter,
            agremId: document.getElementById('DD001002Q_agremId')?.value || '',
            excInsttId: document.getElementById('DD001002Q_excInsttId')?.value || '',
            currentPageNum: '1',
            countPerPageNum: '50',
            excutAmountFrom: '0',
            excutAmountTo: '999999999999999',
          });
          const xhr = new XMLHttpRequest();
          xhr.open('POST', '/exe/dd/dd001/retrieveListBsnsExcutDetlList.do', true);
          xhr.setRequestHeader('Content-Type', 'application/x-www-form-urlencoded; charset=UTF-8');
          xhr.setRequestHeader('X-Requested-With', 'XMLHttpRequest');
          if (token && headerName) xhr.setRequestHeader(headerName, token);
          xhr.onload = () => {
            try { res(JSON.parse(xhr.responseText)); }
            catch { res(null); }
          };
          xhr.onerror = () => res(null);
          xhr.timeout = 10000;
          xhr.send(p.toString());
        });
      }

      Promise.all([
        query('001', '검토완료'),
        query('002', '보완요청'),
        query('', '전체'),
      ]).then(([r1, r2, r3]) => {
        resolve({ r001: r1, r002: r2, rAll: r3 });
      });
    });
  });

  for (const [label, data] of [['검토완료', final.r001], ['보완요청', final.r002], ['전체', final.rAll]]) {
    if (!data) { console.log(`${label}: 에러`); continue; }
    for (const [key, val] of Object.entries(data)) {
      if (Array.isArray(val)) {
        console.log(`\n${label}: ${val.length}건`);
        val.forEach((item, i) => {
          console.log(`  [${i}] ${item.excutPrposCn} | ${item.excutSumAmount || item.excutAmount}원 | ${item.exmntPrgstNm || ''}`);
        });
        break;
      }
    }
  }
}

main().catch(console.error);
