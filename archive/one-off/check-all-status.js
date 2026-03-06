/**
 * 전체 목록 조회 (보완요청 필터 없이) + R11 보완요청 복원 + 사라진 행 추적
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
  console.log('=== 전체 상태 확인 ===\n');

  const browser = await chromium.connectOverCDP('http://localhost:9444');
  const context = browser.contexts()[0];
  let page = context.pages().find(p => p.url().includes('dd001'));
  if (!page) { console.log('ERROR: 페이지 없음'); return; }
  page.on('dialog', async d => { try { await d.accept(); } catch {} });
  await dismissModals(page);

  console.log('URL:', page.url());

  // 1. 검토진행상태 필터 확인 및 해제
  const filterInfo = await page.evaluate(() => {
    // 여러 가능한 셀렉터로 검토상태 필터 찾기
    const result = {};

    // select/combo 요소
    const selectors = [
      '#DD001002Q_exmntPrgstCode',
      '#DD001002Q_pExmntPrgst',
      'select[name="exmntPrgstCode"]',
      'input[name="exmntPrgstCode"]',
    ];
    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (el) {
        result[sel] = {
          tagName: el.tagName,
          value: el.value,
          type: el.type || '',
          options: el.options ? Array.from(el.options).map(o => ({ value: o.value, text: o.text })) : null,
        };
      }
    }

    // hidden input으로 필터가 전달될 수도 있음
    const hiddens = document.querySelectorAll('input[type="hidden"]');
    const relevantHiddens = [];
    hiddens.forEach(h => {
      if (h.name && (h.name.includes('exmnt') || h.name.includes('Prgst') || h.name.includes('prgst'))) {
        relevantHiddens.push({ name: h.name, id: h.id, value: h.value });
      }
    });
    if (relevantHiddens.length > 0) result.hiddens = relevantHiddens;

    // 현재 검색 파라미터 확인 - form data
    const form = document.querySelector('form');
    if (form) {
      const fd = new FormData(form);
      const params = {};
      for (const [k, v] of fd.entries()) {
        if (k.includes('exmnt') || k.includes('Prgst') || k.includes('prgst')) {
          params[k] = v;
        }
      }
      if (Object.keys(params).length > 0) result.formParams = params;
    }

    // SBCombo 확인
    if (typeof SBCombo !== 'undefined') {
      result.hasSBCombo = true;
    }

    // 검토진행상태 라벨 주변 요소
    const labels = document.querySelectorAll('th, label, span');
    labels.forEach(l => {
      if (l.textContent.includes('검토진행상태') || l.textContent.includes('검토상태')) {
        const parent = l.closest('tr') || l.parentElement;
        if (parent) {
          const inputs = parent.querySelectorAll('input, select, [class*="combo"]');
          inputs.forEach(inp => {
            result.nearLabel = {
              id: inp.id,
              tagName: inp.tagName,
              className: (inp.className || '').substring(0, 50),
              value: inp.value || '',
            };
          });
        }
      }
    });

    return result;
  });
  console.log('필터 정보:', JSON.stringify(filterInfo, null, 2));

  // 2. 전체 조회 (필터 없이)
  // 먼저 현재 목록의 검색조건 확인
  const searchCond = await page.evaluate(() => {
    const result = {};
    const ids = [
      'DD001002Q_excutPrposCn', 'DD001002Q_bcncCmpnyNm',
      'DD001002Q_exmntPrgstCode', 'DD001002Q_excutAmountFrom',
      'DD001002Q_excutAmountTo', 'DD001002Q_nPageSize',
      'DD001002Q_nTotalCnt',
    ];
    for (const id of ids) {
      const el = document.getElementById(id);
      if (el) result[id] = el.value;
    }

    // IBCombo(SBCombo) 확인
    const combos = document.querySelectorAll('[class*="IBCombo"], [class*="SBCombo"]');
    combos.forEach(c => {
      if (c.id) result['combo_' + c.id] = c.textContent?.trim()?.substring(0, 30);
    });

    return result;
  });
  console.log('\n검색조건:', JSON.stringify(searchCond, null, 2));

  // 페이지 사이즈를 최대로 변경하고 전체 조회 시도
  console.log('\n페이지 사이즈 변경 시도 (50행)...');
  await page.evaluate(() => {
    const el = document.getElementById('DD001002Q_nPageSize');
    if (el) {
      el.value = '50';
      // change 이벤트 트리거
      el.dispatchEvent(new Event('change'));
    }
  });
  await sleep(500);

  // 조회
  await page.evaluate(() => f_retrieveListBsnsExcutDetl(1));
  await sleep(3000);
  await dismissModals(page);
  await waitForGrid(page, 'DD001002QGridObj');

  // 전체 결과
  const allRows = await page.evaluate(() => {
    const grid = DD001002QGridObj;
    return grid.getDataRows().map((r, i) => {
      const rv = grid.getRowValue(r);
      return {
        idx: i,
        purpose: rv.excutPrposCn,
        amount: parseInt(String(rv.excutAmount || rv.excutSumAmount).replace(/,/g, '')),
        status: rv.exmntPrgstNm || rv.exmntPrgstCode || '',
      };
    });
  });
  console.log(`\n전체 조회: ${allRows.length}행`);
  allRows.forEach(r => console.log(`  [${r.idx}] ${r.purpose} | ${r.amount}원 | ${r.status}`));

  // 특정 금액 추적
  const tracking = [383880, 80000, 160300, 196000];
  console.log('\n--- 사라진 항목 추적 ---');
  for (const amt of tracking) {
    const found = allRows.find(r => r.amount === amt);
    console.log(`  ${amt}원: ${found ? `[${found.idx}] ${found.purpose} | ${found.status}` : '못 찾음'}`);
  }

  // 페이징 확인
  const paging = await page.evaluate(() => {
    const nav = document.getElementById('DD001002Q_sbGridPaging');
    return nav ? nav.textContent.trim() : 'not found';
  });
  console.log('\n페이징:', paging);
  const totalCnt = await page.evaluate(() => {
    const el = document.getElementById('DD001002Q_nTotalCnt');
    return el ? el.value : 'not found';
  });
  console.log('총건수:', totalCnt);
}

main().catch(console.error);
