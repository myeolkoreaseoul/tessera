/**
 * 공통 e나라도움 세부내역검토 자동 입력
 *
 * DOM 클릭 방식으로 행 선택 (selectRow 금지 - getFocusedRow 버그)
 * XHR 프로토타입 복원 필수 (iframe 기법)
 *
 * 사용법:
 *   node lib/review-generic.js --results=xxx-results.json [--save] [--start=N] [--settlement=interim|final]
 *
 *   또는 모듈:
 *   const review = require('./lib/review-generic');
 *   await review.run({ results, saveMode: true, settlement: 'interim' });
 */
const {
  sleep, connectBrowser, findEnaraPage,
  dismissModals, waitModal, waitForGrid,
} = require('./utils');

let PAGE_SIZE = 20;

/**
 * 정산구분 라디오 설정 + 재검색
 * @param {'interim'|'final'} settlement - interim=중간정산, final=최종정산
 */
async function ensureSettlement(page, settlement) {
  if (!settlement) return;
  const radioId = settlement === 'interim'
    ? 'DD001002Q_excclcSeCode_2'   // 중간정산(002)
    : 'DD001002Q_excclcSeCode_1';  // 최종정산(009)
  const label = settlement === 'interim' ? '중간정산' : '최종정산';

  const changed = await page.evaluate((id) => {
    const radio = document.getElementById(id);
    if (radio && !radio.checked) { radio.click(); return true; }
    return false;
  }, radioId);

  if (changed) {
    console.log(`  정산구분: ${label} 설정 → 재검색...`);
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

/**
 * 목록 그리드를 특정 페이지로 이동
 */
async function goToListPage(page, pageNum) {
  console.log(`  [페이지 ${pageNum} 이동]`);
  await page.evaluate((pn) => {
    f_retrieveListBsnsExcutDetl(pn);
  }, pageNum);
  await sleep(3000);
  await dismissModals(page);
  const ready = await waitForGrid(page, 'DD001002QGridObj');
  if (!ready) throw new Error(`페이지 ${pageNum} 로드 실패`);
  const cnt = await page.evaluate(() => DD001002QGridObj.getDataRows().length);
  console.log(`  [페이지 ${pageNum}: ${cnt}행 로드]\n`);
  return cnt;
}

/**
 * 그리드 행 선택 (인덱스 기반)
 */
async function selectGridRow(page, gridIdx) {
  return page.evaluate((idx) => {
    const grid = DD001002QGridObj;
    const rows = grid.getDataRows();
    if (idx >= rows.length) return null;
    const row = rows[idx];
    const rv = grid.getRowValue(row);
    if (typeof grid.focus === 'function') grid.focus(row);
    else if (typeof grid.clickCell === 'function') grid.clickCell(row, 'excutPrposCn');
    else grid.selectRow(row);
    return rv;
  }, gridIdx);
}

/**
 * 그리드에서 금액+업체명으로 행 검색 후 선택
 */
async function findAndSelectRow(page, amount, vendor, purpose) {
  return page.evaluate(({ amt, ven, pur }) => {
    const grid = DD001002QGridObj;
    const rows = grid.getDataRows();
    let bestIdx = -1;
    let bestScore = 0;
    for (let i = 0; i < rows.length; i++) {
      const rv = grid.getRowValue(rows[i]);
      const rowAmt = parseInt(String(rv.lastAmount || rv.excutSumAmount || 0).replace(/,/g, ''));
      if (rowAmt !== amt) continue;
      let score = 1;
      const rowVen = rv.bcncCmpnyNm || '';
      const rowPur = rv.excutPrposCn || '';
      if (ven && rowVen.includes(ven.substring(0, 5))) score += 3;
      if (pur && rowPur.includes(pur.substring(0, 10))) score += 2;
      if (score > bestScore) { bestScore = score; bestIdx = i; }
    }
    if (bestIdx < 0) return null;
    const row = rows[bestIdx];
    const rv = grid.getRowValue(row);
    if (typeof grid.focus === 'function') grid.focus(row);
    else if (typeof grid.clickCell === 'function') grid.clickCell(row, 'excutPrposCn');
    else grid.selectRow(row);
    return { rv, gridIdx: bestIdx };
  }, { amt: amount, ven: vendor, pur: purpose });
}

/**
 * 목록 페이지로 강제 복구
 * 1. f_prevPage()  2. 목록 버튼 클릭  3. URL 이동 + 정산구분 + 검색  4. 리로드 + 정산구분 + 검색
 */
async function recoverToList(page, listUrl, settlement) {
  // 전략 1: f_prevPage()
  await page.evaluate(() => f_prevPage()).catch(() => {});
  await sleep(3000);
  await dismissModals(page);
  let ok = await waitForGrid(page, 'DD001002QGridObj', 5000);
  if (ok) {
    await ensureSettlement(page, settlement);
    return { ok: true, method: 'f_prevPage' };
  }

  // 전략 2: 목록 버튼 클릭
  await page.evaluate(() => {
    const btn = document.getElementById('DD001003S_btnList') ||
                document.getElementById('DD001003S_btnPrevPage') ||
                [...document.querySelectorAll('button')].find(b => /목록|이전/.test(b.textContent.trim()));
    if (btn) btn.click();
  }).catch(() => {});
  await sleep(3000);
  await dismissModals(page);
  ok = await waitForGrid(page, 'DD001002QGridObj', 5000);
  if (ok) {
    await ensureSettlement(page, settlement);
    return { ok: true, method: 'button' };
  }

  // 전략 3: URL 직접 이동 + 정산구분 설정 + 검색
  console.log(`    목록 URL 직접 이동`);
  await page.goto(listUrl, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
  await sleep(3000);
  await dismissModals(page);
  // 정산구분 먼저 설정
  if (settlement === 'interim') {
    await page.evaluate(() => {
      const r2 = document.getElementById('DD001002Q_excclcSeCode_2');
      if (r2 && !r2.checked) r2.click();
    }).catch(() => {});
  }
  // 검색 버튼 클릭
  await page.evaluate(() => {
    const btn = document.getElementById('DD001002Q_btnRetrieve') ||
                [...document.querySelectorAll('button')].find(b => b.textContent.trim() === '검색' && b.offsetWidth > 0);
    if (btn) btn.click();
  }).catch(() => {});
  await sleep(4000);
  await dismissModals(page);
  ok = await waitForGrid(page, 'DD001002QGridObj', 15000);
  if (ok) return { ok: true, method: 'goto+search', resetPage: true };

  // 전략 4: 페이지 리로드 + 정산구분 + 검색
  console.log(`    페이지 리로드 시도`);
  await page.reload({ waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
  await sleep(5000);
  await dismissModals(page);
  if (settlement === 'interim') {
    await page.evaluate(() => {
      const r2 = document.getElementById('DD001002Q_excclcSeCode_2');
      if (r2 && !r2.checked) r2.click();
    }).catch(() => {});
  }
  await page.evaluate(() => {
    const btn = document.getElementById('DD001002Q_btnRetrieve') ||
                [...document.querySelectorAll('button')].find(b => b.textContent.trim() === '검색' && b.offsetWidth > 0);
    if (btn) btn.click();
  }).catch(() => {});
  await sleep(4000);
  await dismissModals(page);
  ok = await waitForGrid(page, 'DD001002QGridObj', 15000);
  if (ok) return { ok: true, method: 'reload+search', resetPage: true };

  return { ok: false };
}

async function run({ results, overrides = {}, saveMode = false, startRow = 1, pageSize = 20, settlement = 'interim' }) {
  PAGE_SIZE = pageSize;
  console.log(`=== e나라도움 세부내역검토 자동 입력 ===`);
  console.log(`모드: ${saveMode ? '★ 실제 저장' : 'DRY RUN (저장 안 함)'}`);
  console.log(`정산구분: ${settlement === 'interim' ? '중간정산' : '최종정산'}`);
  console.log(`시작 행: ${startRow}`);
  console.log(`총 ${results.length}건 (적정 ${results.filter(r => r.status === '적정').length}, 확인 ${results.filter(r => r.status === '확인').length})`);
  console.log('');

  // DRY RUN
  if (!saveMode) {
    console.log('[ DRY RUN - 실행 계획 ]\n');
    for (const r of results) {
      if (r.rowNum < startRow) continue;
      const statusKor = r.status === '적정' ? '검토완료' : '보완요청';
      const ov = r.status === '확인' ? overrides[r.rowNum] : null;
      const pageNum = Math.ceil(r.rowNum / PAGE_SIZE);
      const gridIdx = r.rowNum - (pageNum - 1) * PAGE_SIZE - 1;
      console.log(`R${String(r.rowNum).padStart(2)} [P${pageNum}:${gridIdx}] ${r.type.padEnd(6)} ${String(r.amount.toLocaleString()).padStart(12)}원 → ${statusKor}`);
      if (ov) console.log(`     불인정: ${ov.disallowed.toLocaleString()}원 | ${ov.comment}`);
    }
    console.log('\n→ 실제 저장하려면 --save 플래그 추가');
    return;
  }

  // ── 실제 저장 모드 ──
  const { context } = await connectBrowser();
  let page = await findEnaraPage(context);
  if (!page) { console.log('ERROR: e나라도움 페이지를 찾을 수 없습니다.'); return; }

  await dismissModals(page);
  await sleep(500);

  // 상세 페이지에 있으면 목록으로 돌아감
  if (page.url().includes('DD001003S') || page.url().includes('dd001003')) {
    console.log('현재 상세 페이지 → 목록으로 돌아감...');
    await page.evaluate(() => f_prevPage()).catch(() => {});
    await sleep(3000);
    await dismissModals(page);
  }

  const gridReady = await waitForGrid(page, 'DD001002QGridObj');
  if (!gridReady) {
    // 그리드 없으면 검색 시도
    console.log('그리드 없음 → 검색 시도...');
    await ensureSettlement(page, settlement);
    await page.evaluate(() => {
      const btn = document.getElementById('DD001002Q_btnRetrieve') ||
                  [...document.querySelectorAll('button')].find(b => b.textContent.trim() === '검색' && b.offsetWidth > 0);
      if (btn) btn.click();
    });
    await sleep(4000);
    await dismissModals(page);
    const retry = await waitForGrid(page, 'DD001002QGridObj', 15000);
    if (!retry) { console.log('ERROR: 목록 그리드 데이터 없음'); return; }
  }

  const listUrl = page.url();

  // 정산구분 항상 확인/설정
  await ensureSettlement(page, settlement);

  let currentPage = 1;
  let processed = 0, skipped = 0, errors = 0;

  const startPage = Math.ceil(startRow / PAGE_SIZE);
  if (startPage > 1) {
    await goToListPage(page, startPage);
    currentPage = startPage;
  }

  for (const r of results) {
    if (r.rowNum < startRow) { skipped++; continue; }

    const targetPage = Math.ceil(r.rowNum / PAGE_SIZE);
    const gridIdx = r.rowNum - (targetPage - 1) * PAGE_SIZE - 1;

    if (targetPage !== currentPage) {
      await goToListPage(page, targetPage);
      currentPage = targetPage;
    }

    const statusKor = r.status === '적정' ? '검토완료' : '보완요청';
    const ov = r.status === '확인' ? overrides[r.rowNum] : null;

    console.log(`--- R${r.rowNum} [${r.type}] ${r.amount.toLocaleString()}원 (${r.vendor}) → ${statusKor} ---`);
    if (ov) console.log(`    불인정: ${ov.disallowed.toLocaleString()}원 | 의견: ${ov.comment}`);

    try {
      // 1. 행 선택
      let rowInfo = await selectGridRow(page, gridIdx);
      let usedDynamic = false;

      if (rowInfo) {
        const gridAmount = parseInt(String(rowInfo.lastAmount || rowInfo.excutSumAmount || rowInfo.excutAmount || '0').replace(/,/g, ''));
        if (gridAmount !== r.amount) {
          const found = await findAndSelectRow(page, r.amount, r.vendor, r.purpose || '');
          if (found) {
            rowInfo = found.rv; usedDynamic = true;
            console.log(`    인덱스 불일치 → 동적 매칭 성공 (행 ${found.gridIdx})`);
          } else {
            let foundOnOtherPage = false;
            const totalPages = Math.ceil(results[results.length - 1].rowNum / PAGE_SIZE);
            for (let pg = 1; pg <= totalPages; pg++) {
              if (pg === currentPage) continue;
              await goToListPage(page, pg); currentPage = pg;
              const found2 = await findAndSelectRow(page, r.amount, r.vendor, r.purpose || '');
              if (found2) {
                rowInfo = found2.rv; usedDynamic = true; foundOnOtherPage = true;
                console.log(`    페이지 ${pg}에서 동적 매칭 성공 (행 ${found2.gridIdx})`);
                break;
              }
            }
            if (!foundOnOtherPage) {
              console.log(`    SKIP: 그리드에서 찾을 수 없음 (이미 처리됨?)`);
              errors++; continue;
            }
          }
        }
      } else {
        const found = await findAndSelectRow(page, r.amount, r.vendor, r.purpose || '');
        if (found) {
          rowInfo = found.rv; usedDynamic = true;
          console.log(`    인덱스 초과 → 동적 매칭 성공 (행 ${found.gridIdx})`);
        } else {
          console.log(`    SKIP: 그리드에서 찾을 수 없음 (이미 처리됨?)`);
          errors++; continue;
        }
      }

      console.log(`    행 선택: ${rowInfo.excutPrposCn || ''}`);
      await sleep(500);

      // 2. 세부내역검토 클릭 (focus 확인 후)
      let detailReady = false;
      for (let attempt = 0; attempt < 2; attempt++) {
        // focus 상태 확인
        const focused = await page.evaluate(() => {
          const grid = DD001002QGridObj;
          return grid.getFocusedRow ? grid.getFocusedRow() !== null : true;
        }).catch(() => false);

        if (!focused && attempt === 0) {
          console.log(`    focus 재설정...`);
          if (usedDynamic) {
            await findAndSelectRow(page, r.amount, r.vendor, r.purpose || '');
          } else {
            await selectGridRow(page, gridIdx);
          }
          await sleep(500);
        }

        await page.click('#DD001002Q_detlListExmnt');
        await sleep(3000);

        // 모달 체크
        const modalText = await page.evaluate(() => {
          const m = document.querySelector('.popupMask.on');
          return m ? m.textContent.trim() : null;
        }).catch(() => null);

        if (modalText && /선택해주세요|선택하세요/.test(modalText)) {
          console.log(`    모달: 행 선택 필요 → 재시도`);
          await dismissModals(page);
          if (attempt === 0) {
            // re-focus and retry
            if (usedDynamic) {
              await findAndSelectRow(page, r.amount, r.vendor, r.purpose || '');
            } else {
              await selectGridRow(page, gridIdx);
            }
            await sleep(500);
            continue;
          }
          errors++; break;
        }
        if (modalText) {
          await dismissModals(page);
          await sleep(1000);
        }

        // 상세 그리드 대기
        detailReady = await waitForGrid(page, 'DD001003SGridObj', 20000);
        break;
      }

      if (!detailReady) {
        console.log(`    ERROR: 상세 페이지 그리드 로드 실패 → 복구 시도`);
        errors++;
        const recovery = await recoverToList(page, listUrl, settlement);
        if (!recovery.ok) { console.log(`    ERROR: 복구 불가, 중단`); break; }
        console.log(`    복구 성공 (${recovery.method})`);
        if (recovery.resetPage) currentPage = 1;
        continue;
      }

      // 3. 검토 결과 입력
      if (r.status === '적정') {
        await page.evaluate(() => f_changeExmntPrgst("001"));
        console.log(`    검토완료 설정`);
      } else {
        const disallowed = ov ? ov.disallowed : 0;
        const comment = ov ? ov.comment : r.issues.join('; ');
        await page.evaluate(({ dis, cmt }) => {
          f_changeExmntPrgst("002");
          const grid = DD001003SGridObj;
          const rows = grid.getDataRows();
          const row = rows[0];
          if (dis > 0) grid.setValue(row, "nrcgnAmount", String(dis));
          const htmlComment = cmt.replace(/\n/g, "<br>");
          grid.setValue(row, "exclexCn", htmlComment);
          grid.setValue(row, "orgExclexCn", htmlComment);
        }, { dis: disallowed, cmt: comment });
        console.log(`    보완요청 설정 (불인정: ${disallowed.toLocaleString()}원)`);
      }

      // 4. 저장
      await page.click('#DD001003S_btnSave');
      await sleep(500);

      const confirmed = await waitModal(page, 5000);
      if (!confirmed) {
        console.log(`    WARNING: 확인 모달 미출현`);
        const errMsg = await page.evaluate(() => {
          const m = document.querySelector('.popupMask.on');
          return m ? (m.querySelector('.message')?.textContent?.trim() || '') : '';
        }).catch(() => '');
        if (errMsg) { console.log(`    에러: ${errMsg}`); await dismissModals(page); }
        errors++;
        await page.evaluate(() => f_prevPage()).catch(() => {});
        await sleep(3000); await dismissModals(page);
        await waitForGrid(page, 'DD001002QGridObj');
        continue;
      }

      await sleep(2000);
      const success = await waitModal(page, 10000);
      if (success) console.log(`    저장 완료`);
      else { console.log(`    WARNING: 성공 모달 미출현`); await dismissModals(page); }
      await sleep(1000);

      // 5. 목록 복귀
      await page.evaluate(() => f_prevPage()).catch(async () => {
        await page.click('#DD001003S_btnPrevPage').catch(() => {});
      });
      await sleep(3000);
      await dismissModals(page);
      await sleep(500);

      const listReady = await waitForGrid(page, 'DD001002QGridObj');
      if (!listReady) {
        console.log(`    목록 복귀 실패 → 복구 시도...`);
        const recovery = await recoverToList(page, listUrl, settlement);
        if (!recovery.ok) { console.log(`    ERROR: 복구 불가, 중단`); errors++; break; }
        console.log(`    복구 성공 (${recovery.method})`);
        if (recovery.resetPage) currentPage = 1;
      }

      // 정산구분 재확인 (상세→목록 복귀 시 리셋될 수 있음)
      await ensureSettlement(page, settlement);

      // 페이지 확인
      const afterRows = await page.evaluate(() => DD001002QGridObj.getDataRows().length);
      if (targetPage > 1 && afterRows === PAGE_SIZE) {
        console.log(`    [페이지 재이동: ${targetPage}]`);
        await goToListPage(page, targetPage);
      }

      processed++;
      console.log(`    완료 (${processed}/${results.length - skipped})\n`);

    } catch (err) {
      console.log(`    ERROR: ${err.message}`);
      errors++;
      await dismissModals(page).catch(() => {});
      await sleep(1000);
      try {
        let listOk = await waitForGrid(page, 'DD001002QGridObj', 3000);
        if (!listOk) {
          console.log(`    복구 시도...`);
          const recovery = await recoverToList(page, listUrl, settlement);
          if (recovery.ok) {
            console.log(`    복구 성공 (${recovery.method})`);
            if (recovery.resetPage) currentPage = 1;
          } else {
            console.log(`    복구 실패`);
          }
        }
      } catch (e2) {
        console.log(`    복구 실패: ${e2.message}`);
      }
    }
  }

  console.log('\n=============================');
  console.log(`처리 완료: ${processed}건`);
  console.log(`건너뜀: ${skipped}건`);
  console.log(`오류: ${errors}건`);
  console.log('=============================');
}

module.exports = { run, goToListPage, selectGridRow };

// ── CLI ──
if (require.main === module) {
  const fs = require('fs');
  const args = process.argv.slice(2);
  const getArg = (prefix) => {
    const a = args.find(x => x.startsWith(prefix));
    return a ? a.substring(prefix.length) : null;
  };

  const resultsFile = getArg('--results=');
  const overridesFile = getArg('--overrides=');
  const saveMode = args.includes('--save');
  const startArg = args.find(a => a.startsWith('--start='));
  const startRow = startArg ? parseInt(startArg.split('=')[1]) : 1;
  const pageSizeArg = getArg('--pagesize=');
  const pageSize = pageSizeArg ? parseInt(pageSizeArg) : 20;
  const settlementArg = getArg('--settlement=');
  const settlement = settlementArg || 'interim';

  if (!resultsFile) {
    console.log('사용법: node lib/review-generic.js --results=xxx-results.json [--save] [--start=N] [--settlement=interim|final]');
    process.exit(1);
  }

  const results = JSON.parse(fs.readFileSync(resultsFile, 'utf-8'));
  const overrides = overridesFile ? JSON.parse(fs.readFileSync(overridesFile, 'utf-8')) : {};

  run({ results, overrides, saveMode, startRow, pageSize, settlement }).catch(console.error);
}
