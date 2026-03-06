/**
 * 통합이지바로 결과 입력 어댑터
 * - results.json 기반 점검결과 입력
 * - 순번(seq/rowNum) 기준 페이지네이션 탐색
 *
 * 사용법:
 *   node lib/review-ezbaro.js --results=xxx-results.json [--save] [--start=1] [--host=100.87.3.123] [--port=9446]
 */
const fs = require('fs');
const path = require('path');
const nav = require('./navigate');
const ext = require('./collect');
const { sleep } = require('../../utils');

function normalizeStatus(status) {
  const s = String(status || '').trim();
  if (s === '적정' || s === '점검완료' || s === '검토완료') return '점검완료';
  return '보완요청';
}

async function clickVisibleByText(page, regex) {
  return page.evaluate((pattern) => {
    const re = new RegExp(pattern);
    const isVisible = (el) => {
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    };
    const el = [...document.querySelectorAll('button, div, span, a')].find(node => {
      const t = (node.innerText || '').trim();
      return isVisible(node) && node.childElementCount === 0 && re.test(t);
    });
    if (!el) return false;
    el.click();
    return true;
  }, regex.source);
}

async function clickRowBySeqOnCurrentPage(page, seq) {
  return page.evaluate((targetSeq) => {
    const rows = [...document.querySelectorAll('[class*="cl-grid-row"]')].filter(el => {
      const r = el.getBoundingClientRect();
      return r.width > 300 && r.height > 12 && r.y > 80;
    });

    for (const row of rows) {
      const texts = [...row.querySelectorAll('.cl-text')].map(el => (el.innerText || '').trim()).filter(Boolean);
      if (!texts.length) continue;
      const firstNumeric = texts.find(t => /^\d+$/.test(t));
      if (firstNumeric && Number(firstNumeric) === Number(targetSeq)) {
        const r = row.getBoundingClientRect();
        const x = Math.round(r.x + Math.min(30, r.width / 3));
        const y = Math.round(r.y + r.height / 2);
        return { found: true, x, y, texts };
      }
    }

    return { found: false };
  }, seq);
}

async function openDetailForSeq(page, seq) {
  await ext.goFirstPage(page);

  for (let group = 0; group < 999; group++) {
    const pageCount = await page.evaluate(() => {
      const area = [...document.querySelectorAll('.cl-pageindexer-index-area')]
        .find(el => el.getBoundingClientRect().width > 0);
      return area ? area.querySelectorAll('.cl-pageindexer-index').length : 0;
    }).catch(() => 0);

    if (!pageCount) break;

    for (let i = 0; i < pageCount; i++) {
      if (!(group === 0 && i === 0)) {
        const moved = await ext.clickPageIndex(page, i);
        if (!moved) continue;
      }

      const row = await clickRowBySeqOnCurrentPage(page, seq);
      if (!row.found) continue;

      await page.mouse.click(row.x, row.y);
      await sleep(400);

      const opened = await clickVisibleByText(page, /점검|검토|상세/);
      if (!opened) return false;

      await sleep(1200);
      await nav.dismissModalsEzbaro(page);

      // 상세 화면 렌더링 대기
      for (let w = 0; w < 20; w++) {
        const controls = await ext.detectReviewControls(page);
        if (controls && controls.opinionTextareaSelector) return true;
        await sleep(300);
      }
      return false;
    }

    const next = await ext.clickNextPageGroup(page);
    if (!next) break;
  }

  return false;
}

async function setStatus(page, controls, statusText) {
  if (!controls.statusComboSelector) return false;

  const comboClicked = await page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) return false;
    el.click();
    return true;
  }, controls.statusComboSelector).catch(() => false);

  if (!comboClicked) return false;
  await sleep(250);

  const picked = await page.evaluate((target) => {
    const opts = [...document.querySelectorAll('.cl-combobox-list.cl-popup .cl-text, [role="option"]')]
      .filter(el => {
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0;
      });

    const opt = opts.find(el => (el.innerText || '').trim() === target);
    if (!opt) return false;
    opt.click();
    return true;
  }, statusText).catch(() => false);

  await sleep(250);
  return picked;
}

async function setOpinion(page, controls, comment) {
  if (!controls.opinionTextareaSelector) return false;
  return page.evaluate(({ sel, value }) => {
    const ta = document.querySelector(sel);
    if (!ta) return false;
    ta.value = value;
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    ta.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  }, { sel: controls.opinionTextareaSelector, value: comment || '' }).catch(() => false);
}

async function saveReview(page) {
  const clicked = await clickVisibleByText(page, /저장/);
  if (!clicked) return false;

  await sleep(800);
  for (let i = 0; i < 4; i++) {
    await nav.dismissModalsEzbaro(page);
    await sleep(350);
  }
  return true;
}

async function goBackToList(page) {
  for (let i = 0; i < 3; i++) {
    const clicked = await clickVisibleByText(page, /목록|이전/);
    await sleep(900);
    await nav.dismissModalsEzbaro(page);

    const onList = await nav.isOnExecutionList(page);
    if (onList) return true;
    if (!clicked) await sleep(600);
  }
  return nav.isOnExecutionList(page);
}

async function run({ results, startRow = 1, saveMode = false, host, port }) {
  console.log('=== 이지바로 결과 입력 ===');
  console.log(`모드: ${saveMode ? 'SAVE' : 'DRY RUN'}`);
  console.log(`시작 행: ${startRow}`);
  console.log(`건수: ${results.length}`);
  console.log('');

  if (!saveMode) {
    for (const r of results) {
      if ((r.rowNum || 0) < startRow) continue;
      const seq = r.seq || r.rowNum;
      const status = normalizeStatus(r.status);
      console.log(`R${r.rowNum} (seq:${seq}) -> ${status} | ${(r.comment || '').slice(0, 80)}`);
    }
    return;
  }

  const { browser, page } = await nav.goToExecutionList({ host, port });
  let processed = 0;
  let failed = 0;
  let skipped = 0;

  try {
    await nav.startKeepAliveEzbaro(page);

    for (const r of results) {
      if ((r.rowNum || 0) < startRow) {
        skipped += 1;
        continue;
      }

      const seq = r.seq || r.rowNum;
      const status = normalizeStatus(r.status);
      const comment = String(r.comment || '').trim();

      console.log(`--- R${r.rowNum} (seq:${seq}) ${status} ---`);

      const opened = await openDetailForSeq(page, seq);
      if (!opened) {
        console.log('  ERROR: 상세 진입 실패');
        failed += 1;
        continue;
      }

      const controls = await ext.detectReviewControls(page);
      if (!controls || !controls.opinionTextareaSelector) {
        console.log('  ERROR: 검토 필드 탐지 실패');
        failed += 1;
        await goBackToList(page);
        continue;
      }

      const statusOk = await setStatus(page, controls, status);
      const opinionOk = await setOpinion(page, controls, comment);

      if (!statusOk) console.log('  WARN: 상태 콤보 선택 실패');
      if (!opinionOk) console.log('  WARN: 의견 입력 실패');

      if (status === '보완요청' && controls.requestButtonSelector) {
        await page.evaluate((sel) => {
          const btn = document.querySelector(sel);
          if (btn) btn.click();
        }, controls.requestButtonSelector).catch(() => {});
        await sleep(300);
      }

      const saved = await saveReview(page);
      if (!saved) {
        console.log('  ERROR: 저장 버튼 클릭 실패');
        failed += 1;
      } else {
        processed += 1;
      }

      const back = await goBackToList(page);
      if (!back) {
        console.log('  ERROR: 목록 복귀 실패');
        failed += 1;
        break;
      }

      await nav.queryIfNeeded(page);
      await sleep(500);
    }
  } finally {
    nav.stopKeepAliveEzbaro();
    await browser.close().catch(() => {});
  }

  console.log('');
  console.log(`완료: 처리 ${processed}, 실패 ${failed}, 건너뜀 ${skipped}`);
}

module.exports = {
  run,
  normalizeStatus,
  openDetailForSeq,
  setStatus,
  setOpinion,
  saveReview,
  goBackToList,
};

if (require.main === module) {
  const getArg = (name, dflt = null) => {
    const p = `--${name}=`;
    const found = process.argv.find(a => a.startsWith(p));
    return found ? found.slice(p.length) : dflt;
  };

  const resultsFile = getArg('results');
  const startRow = parseInt(getArg('start', '1'), 10);
  const saveMode = process.argv.includes('--save');
  const host = getArg('host', process.env.CDP_HOST || '100.87.3.123');
  const port = Number(getArg('port', process.env.CDP_PORT || '9446'));

  if (!resultsFile) {
    console.log('사용법: node lib/review-ezbaro.js --results=xxx-results.json [--save] [--start=1] [--host=100.87.3.123] [--port=9446]');
    process.exit(1);
  }

  const abs = path.resolve(resultsFile);
  const results = JSON.parse(fs.readFileSync(abs, 'utf-8'));
  run({ results, startRow, saveMode, host, port }).catch(e => {
    console.error('ERROR:', e.message);
    process.exit(1);
  });
}
