#!/usr/bin/env node
/**
 * retry-unprocessed.js
 *
 * e나라도움 그리드를 직접 스캔하여 미처리 항목을 찾고 처리하는 전용 스크립트.
 * rowNum 기반 페이지 계산 없이, 그리드의 실제 상태를 기반으로 작동.
 *
 * 1단계: 전체 그리드 스캔 → 미처리 항목 목록 수집
 * 2단계: results와 매칭 (금액+업체명+용도)
 * 3단계: 순서대로 처리 (처리 후 그리드가 변해도 재스캔)
 */

const {
  sleep, connectBrowser, findEnaraPage,
  dismissModals, waitModal, waitForGrid,
} = require('../lib/utils');

const fs = require('fs');
const path = require('path');

const PAGE_SIZE = 20;

async function ensureSettlement(page, settlement) {
  if (!settlement) return;
  const radioId = settlement === 'interim'
    ? 'DD001002Q_excclcSeCode_2'
    : 'DD001002Q_excclcSeCode_1';
  const changed = await page.evaluate((id) => {
    const radio = document.getElementById(id);
    if (radio && !radio.checked) { radio.click(); return true; }
    return false;
  }, radioId);
  if (changed) {
    console.log(`  정산구분: ${settlement === 'interim' ? '중간정산' : '최종정산'} 설정 → 재검색...`);
    await page.evaluate(() => {
      const btn = document.getElementById('DD001002Q_btnRetrieve') ||
                  [...document.querySelectorAll('button')].find(b => b.textContent.trim() === '검색' && b.offsetWidth > 0);
      if (btn) btn.click();
    });
    await sleep(3000);
    await dismissModals(page);
    await waitForGrid(page, 'DD001002QGridObj', 15000);
  }
}

async function goToListPage(page, pageNum) {
  await page.evaluate((pn) => { f_retrieveListBsnsExcutDetl(pn); }, pageNum);
  await sleep(3000);
  await dismissModals(page);
  const ready = await waitForGrid(page, 'DD001002QGridObj', 10000);
  if (!ready) return 0; // 페이지 없으면 0 반환
  const cnt = await page.evaluate(() => DD001002QGridObj.getDataRows().length);
  return cnt;
}

/**
 * 전체 그리드에서 미처리 항목 수집
 */
async function scanUnprocessed(page) {
  const totalRows = await page.evaluate(() => {
    try {
      // 총 건수 확인 (페이지네이션 정보)
      const info = document.querySelector('.page_number') || document.querySelector('[id*="pagingArea"]');
      if (info) {
        const m = info.textContent.match(/(\d+)\s*건/);
        if (m) return parseInt(m[1]);
      }
    } catch(e) {}
    return 0;
  });

  const totalPages = totalRows > 0 ? Math.ceil(totalRows / PAGE_SIZE) : 20; // fallback max 20 pages
  console.log(`  총 ${totalRows || '?'}건 (최대 ${totalPages}페이지 스캔)\n`);

  const unprocessed = [];

  for (let pg = 1; pg <= totalPages; pg++) {
    if (pg > 1) {
      const cnt = await goToListPage(page, pg);
      if (cnt === 0) {
        console.log(`  페이지 ${pg}: 없음 → 스캔 종료`);
        break;
      }
    }

    const rows = await page.evaluate(() => {
      const grid = DD001002QGridObj;
      const dataRows = grid.getDataRows();
      return dataRows.map((row, idx) => {
        const rv = grid.getRowValue(row);
        return {
          gridIdx: idx,
          amount: parseInt(String(rv.lastAmount || rv.excutSumAmount || rv.excutAmount || '0').replace(/,/g, '')),
          vendor: rv.bcncCmpnyNm || '',
          purpose: rv.excutPrposCn || '',
          evidenceType: rv.provngDataSeCdNm || '',
          reviewStatus: rv.exmntPrgstCdNm || rv.exmntPrgstNm || '',
          rawStatus: rv.exmntPrgstCd || '',
        };
      });
    });

    let pageUnprocessed = 0;
    for (const row of rows) {
      // 미처리 = 검토완료/보완요청이 아닌 상태
      const isProcessed = /검토완료|보완요청|검토불필요/.test(row.reviewStatus);
      if (!isProcessed && row.amount > 0) {
        unprocessed.push({ ...row, page: pg });
        pageUnprocessed++;
      }
    }
    console.log(`  페이지 ${pg}: ${rows.length}행, 미처리 ${pageUnprocessed}건`);
  }

  return unprocessed;
}

/**
 * results.json과 매칭
 */
function matchResults(unprocessed, results) {
  const matched = [];
  const resultsMap = new Map();

  // Build index by amount for faster lookup
  for (const r of results) {
    const key = r.amount;
    if (!resultsMap.has(key)) resultsMap.set(key, []);
    resultsMap.get(key).push({ ...r, used: false });
  }

  for (const item of unprocessed) {
    const candidates = resultsMap.get(item.amount) || [];
    let bestMatch = null;
    let bestScore = 0;

    for (const c of candidates) {
      if (c.used) continue;
      let score = 1; // amount matches
      if (c.vendor && item.vendor.includes(c.vendor.substring(0, 5))) score += 3;
      if (item.purpose && c.vendor && item.purpose.includes(c.vendor.substring(0, 3))) score += 1;
      if (score > bestScore) {
        bestScore = score;
        bestMatch = c;
      }
    }

    if (bestMatch) {
      bestMatch.used = true;
      matched.push({
        ...item,
        resultRowNum: bestMatch.rowNum,
        targetStatus: bestMatch.status,
        issues: bestMatch.issues || [],
      });
    } else {
      // No match in results - 보수적으로 확인 처리
      matched.push({
        ...item,
        resultRowNum: null,
        targetStatus: '확인',
        issues: ['교차검증 결과 매칭 없음'],
      });
    }
  }

  return matched;
}

async function processItem(page, item, listUrl, settlement) {
  const statusKor = item.targetStatus === '적정' ? '검토완료' : '보완요청';
  console.log(`\n--- ${item.purpose} | ${item.amount.toLocaleString()}원 (${item.vendor}) → ${statusKor} ---`);
  if (item.resultRowNum) console.log(`    매칭: R${item.resultRowNum}`);

  // 1. 항상 해당 페이지로 이동
  await goToListPage(page, item.page);

  // 2. 해당 행 찾기 & 선택 (금액+업체명+용도 동적 매칭, 미처리만)
  const found = await page.evaluate(({ amt, ven, pur }) => {
    const grid = DD001002QGridObj;
    const rows = grid.getDataRows();
    let bestIdx = -1;
    let bestScore = 0;
    for (let i = 0; i < rows.length; i++) {
      const rv = grid.getRowValue(rows[i]);
      const rowAmt = parseInt(String(rv.lastAmount || rv.excutSumAmount || rv.excutAmount || '0').replace(/,/g, ''));
      if (rowAmt !== amt) continue;
      // 이미 처리된 건은 스킵 (exmntPrgstCd: 001=검토완료, 002=보완요청)
      const statusCd = rv.exmntPrgstCd || '';
      const statusNm = rv.exmntPrgstCdNm || rv.exmntPrgstNm || '';
      if (statusCd === '001' || statusCd === '002' || /검토완료|보완요청|검토불필요/.test(statusNm)) continue;
      let score = 1;
      const rowVen = rv.bcncCmpnyNm || '';
      const rowPur = rv.excutPrposCn || '';
      if (ven && ven.length >= 5 && rowVen.includes(ven.substring(0, 5))) score += 3;
      else if (ven && ven.length >= 3 && rowVen.includes(ven.substring(0, 3))) score += 2;
      if (pur && pur.length >= 10 && rowPur.includes(pur.substring(0, 10))) score += 2;
      else if (pur && pur.length >= 5 && rowPur.includes(pur.substring(0, 5))) score += 1;
      if (score > bestScore) { bestScore = score; bestIdx = i; }
    }
    if (bestIdx < 0) return null;
    const row = rows[bestIdx];
    const rv = grid.getRowValue(row);
    if (typeof grid.focus === 'function') grid.focus(row);
    else grid.selectRow(row);
    return rv;
  }, { amt: item.amount, ven: item.vendor, pur: item.purpose });

  if (!found) {
    // 전체 페이지 스캔 (미처리 항목이 다른 페이지에 있을 수 있음)
    let foundOnOther = false;
    for (let pg = 1; pg <= 20; pg++) {
      if (pg === item.page) continue;
      const cnt = await goToListPage(page, pg);
      if (cnt === 0) break;
      const found2 = await page.evaluate(({ amt, ven, pur }) => {
        const grid = DD001002QGridObj;
        const rows = grid.getDataRows();
        for (let i = 0; i < rows.length; i++) {
          const rv = grid.getRowValue(rows[i]);
          const rowAmt = parseInt(String(rv.lastAmount || rv.excutSumAmount || rv.excutAmount || '0').replace(/,/g, ''));
          if (rowAmt !== amt) continue;
          const statusCd = rv.exmntPrgstCd || '';
          const statusNm = rv.exmntPrgstCdNm || rv.exmntPrgstNm || '';
          if (statusCd === '001' || statusCd === '002' || /검토완료|보완요청|검토불필요/.test(statusNm)) continue;
          if (typeof grid.focus === 'function') grid.focus(rows[i]);
          else grid.selectRow(rows[i]);
          return grid.getRowValue(rows[i]);
        }
        return null;
      }, { amt: item.amount, ven: item.vendor, pur: item.purpose });
      if (found2) {
        console.log(`    페이지 ${pg}에서 발견`);
        item.page = pg;
        foundOnOther = true;
        break;
      }
    }
    if (!foundOnOther) {
      console.log(`    SKIP: 미처리 항목을 찾을 수 없음`);
      return false;
    }
  }

  console.log(`    행 선택 완료`);
  await sleep(500);

  // 3. 세부내역검토 클릭
  let detailReady = false;
  for (let attempt = 0; attempt < 2; attempt++) {
    await page.click('#DD001002Q_detlListExmnt');
    await sleep(3000);

    const modalText = await page.evaluate(() => {
      const m = document.querySelector('.popupMask.on');
      return m ? m.textContent.trim() : null;
    }).catch(() => null);

    if (modalText && /선택해주세요|선택하세요/.test(modalText)) {
      console.log(`    모달: 행 선택 필요 → 재시도`);
      await dismissModals(page);
      await sleep(500);
      continue;
    }
    if (modalText) {
      await dismissModals(page);
      await sleep(1000);
    }

    detailReady = await waitForGrid(page, 'DD001003SGridObj', 20000);
    break;
  }

  if (!detailReady) {
    console.log(`    ERROR: 상세 페이지 로드 실패 → 복구`);
    await page.evaluate(() => f_prevPage()).catch(() => {});
    await sleep(3000);
    await dismissModals(page);
    await waitForGrid(page, 'DD001002QGridObj', 10000);
    await ensureSettlement(page, settlement);
    return false;
  }

  // 4. 검토 결과 입력
  if (item.targetStatus === '적정') {
    await page.evaluate(() => f_changeExmntPrgst("001"));
    console.log(`    검토완료 설정`);
  } else {
    const comment = item.issues.join('; ') || '추가 확인 필요';
    await page.evaluate(({ cmt }) => {
      f_changeExmntPrgst("002");
      const grid = DD001003SGridObj;
      const rows = grid.getDataRows();
      const row = rows[0];
      grid.setValue(row, "nrcgnAmount", "0");
      const htmlComment = cmt.replace(/\n/g, "<br>");
      grid.setValue(row, "exclexCn", htmlComment);
      grid.setValue(row, "orgExclexCn", htmlComment);
    }, { cmt: comment });
    console.log(`    보완요청 설정`);
  }

  // 5. 저장
  await page.click('#DD001003S_btnSave');
  await sleep(500);

  const confirmed = await waitModal(page, 5000);
  if (!confirmed) {
    console.log(`    WARNING: 확인 모달 미출현`);
    const errMsg = await page.evaluate(() => {
      const m = document.querySelector('.popupMask.on');
      return m ? (m.querySelector('.message')?.textContent?.trim() || '') : '';
    }).catch(() => '');
    if (errMsg) {
      console.log(`    에러: ${errMsg}`);
      await dismissModals(page);
    }
    await page.evaluate(() => f_prevPage()).catch(() => {});
    await sleep(3000);
    await dismissModals(page);
    await waitForGrid(page, 'DD001002QGridObj', 10000);
    await ensureSettlement(page, settlement);
    return false;
  }

  await sleep(2000);
  const success = await waitModal(page, 10000);
  if (success) console.log(`    저장 완료`);
  else { console.log(`    WARNING: 성공 모달 미출현 (저장됐을 가능성 있음)`); await dismissModals(page); }
  await sleep(1000);

  // 6. 목록 복귀
  await page.evaluate(() => f_prevPage()).catch(async () => {
    await page.click('#DD001003S_btnPrevPage').catch(() => {});
  });
  await sleep(3000);
  await dismissModals(page);

  const listReady = await waitForGrid(page, 'DD001002QGridObj', 10000);
  if (!listReady) {
    console.log(`    목록 복귀 실패 → URL 이동`);
    await page.goto(listUrl, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
    await sleep(3000);
    await dismissModals(page);
    await ensureSettlement(page, settlement);
    await page.evaluate(() => {
      const btn = document.getElementById('DD001002Q_btnRetrieve') ||
                  [...document.querySelectorAll('button')].find(b => b.textContent.trim() === '검색' && b.offsetWidth > 0);
      if (btn) btn.click();
    });
    await sleep(4000);
    await dismissModals(page);
    await waitForGrid(page, 'DD001002QGridObj', 15000);
  }

  await ensureSettlement(page, settlement);
  return true;
}

async function main() {
  // Load results
  const resultsFile = path.join(__dirname, '..', '대구경북재단-results-final.json');
  const results = JSON.parse(fs.readFileSync(resultsFile, 'utf-8'));
  console.log(`results 로드: ${results.length}건\n`);

  const settlement = 'interim';

  // Connect
  const { context } = await connectBrowser();
  let page = await findEnaraPage(context);
  if (!page) { console.log('ERROR: e나라도움 페이지를 찾을 수 없습니다.'); return; }

  await dismissModals(page);

  // 상세 페이지에 있으면 복귀
  if (page.url().includes('DD001003S') || page.url().includes('dd001003')) {
    console.log('상세 페이지 → 목록 복귀...');
    await page.evaluate(() => f_prevPage()).catch(() => {});
    await sleep(3000);
    await dismissModals(page);
  }

  await waitForGrid(page, 'DD001002QGridObj', 10000);
  await ensureSettlement(page, settlement);

  const listUrl = page.url();

  // 1단계: 미처리 항목 스캔
  console.log('=== 1단계: 미처리 항목 스캔 ===\n');
  await goToListPage(page, 1);
  const unprocessed = await scanUnprocessed(page);
  console.log(`\n미처리 합계: ${unprocessed.length}건\n`);

  if (unprocessed.length === 0) {
    console.log('미처리 항목 없음. 완료.');
    return;
  }

  // 2단계: results 매칭
  console.log('=== 2단계: results 매칭 ===\n');
  const matched = matchResults(unprocessed, results);

  const stats = { 적정: 0, 확인: 0 };
  matched.forEach(m => { stats[m.targetStatus] = (stats[m.targetStatus] || 0) + 1; });
  console.log(`매칭 완료: 적정 ${stats['적정']}건, 확인 ${stats['확인']}건\n`);

  // 저장
  fs.writeFileSync(
    path.join(__dirname, 'unprocessed-scan.json'),
    JSON.stringify(matched, null, 2), 'utf-8'
  );

  // 3단계: 처리
  console.log('=== 3단계: 미처리 항목 처리 ===\n');

  let success = 0, fail = 0;

  for (let i = 0; i < matched.length; i++) {
    const item = matched[i];
    console.log(`[${i + 1}/${matched.length}]`);

    try {
      const ok = await processItem(page, item, listUrl, settlement);
      if (ok) {
        success++;
        console.log(`    ✓ 완료 (${success}/${matched.length})`);
      } else {
        fail++;
        console.log(`    ✗ 실패`);
      }
    } catch (err) {
      console.log(`    ERROR: ${err.message}`);
      fail++;
      await dismissModals(page).catch(() => {});
      await sleep(2000);
      // 복구
      const listReady = await waitForGrid(page, 'DD001002QGridObj', 3000);
      if (!listReady) {
        await page.goto(listUrl, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
        await sleep(3000);
        await dismissModals(page);
        await ensureSettlement(page, settlement);
        await page.evaluate(() => {
          const btn = document.getElementById('DD001002Q_btnRetrieve');
          if (btn) btn.click();
        });
        await sleep(4000);
        await dismissModals(page);
        await waitForGrid(page, 'DD001002QGridObj', 15000);
      }
    }
  }

  console.log(`\n=============================`);
  console.log(`처리 성공: ${success}건`);
  console.log(`처리 실패: ${fail}건`);
  console.log(`=============================`);

  // 실패 건이 있으면 재스캔
  if (fail > 0) {
    console.log(`\n=== 잔여 미처리 재스캔 ===\n`);
    await goToListPage(page, 1);
    await ensureSettlement(page, settlement);
    const remaining = await scanUnprocessed(page);
    console.log(`\n잔여 미처리: ${remaining.length}건`);
    if (remaining.length > 0) {
      fs.writeFileSync(
        path.join(__dirname, 'remaining-unprocessed.json'),
        JSON.stringify(remaining, null, 2), 'utf-8'
      );
      console.log('remaining-unprocessed.json에 저장됨');
    }
  }
}

main().catch(err => { console.error('FATAL:', err); process.exit(1); });
