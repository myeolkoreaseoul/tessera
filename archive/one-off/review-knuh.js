/**
 * 경북대학교병원 e나라도움 세부내역검토 자동 입력
 *
 * 워크플로우 (건별):
 *   목록 페이지 → 행 선택 → 세부내역검토 클릭 → 상세 페이지
 *   → 검토상태 설정 (검토완료/보완요청) → 불인정금액/의견 입력
 *   → 저장 → 이전 페이지 → 목록 복귀 → 다음 건 반복
 *
 * 사용법:
 *   node review-knuh.js          # DRY RUN (실제 저장 안 함)
 *   node review-knuh.js --save   # 실제 저장
 *   node review-knuh.js --save --start=5  # 5번째 행부터 저장
 */
const { chromium } = require('playwright');
const results = require('./knuh-results.json');

process.on('unhandledRejection', (err) => {
  if (err && err.message && err.message.includes('No dialog is showing')) return;
});

// === 검토 결과 데이터 ===
const OVERRIDES = {
  20: { disallowed: 3685000, comment: '범용성 장비(노트북 LG그램) 임차 → 지침 별표2 "범용성 장비 구입 또는 대여" 전액 불인정' },
  1:  { disallowed: 0, comment: '증빙파일 미첨부 → 보완 요청 (회의록, 영수증)' },
  9:  { disallowed: 0, comment: '증빙파일 미첨부 → 보완 요청 (근로계약서, 급여명세서, 지급명세서)' },
  10: { disallowed: 0, comment: '증빙파일 미첨부 → 보완 요청 (회의록, 영수증)' },
  11: { disallowed: 0, comment: '증빙파일 미첨부 → 보완 요청 (회의록, 영수증)' },
  12: { disallowed: 0, comment: '증빙파일 미첨부 → 보완 요청 (회의록, 영수증)' },
  23: { disallowed: 0, comment: '증빙파일 미첨부 → 보완 요청 (회의록, 영수증)' },
  25: { disallowed: 0, comment: '외부참석자 확인 불가 → 회의록 참석자명단 보완 요청' },
  31: { disallowed: 0, comment: '참석인원 대비 1인당 5만원 한도 확인 필요 → 보완 요청' },
};

const PAGE_SIZE = 20;  // e나라도움 그리드 페이지 크기

const args = process.argv.slice(2);
const SAVE_MODE = args.includes('--save');
const startArg = args.find(a => a.startsWith('--start='));
const START_ROW = startArg ? parseInt(startArg.split('=')[1]) : 1;

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

async function waitForListGrid(page, timeout = 15000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const ready = await page.evaluate(() => {
      return typeof DD001002QGridObj !== 'undefined' &&
             typeof DD001002QGridObj.getDataRows === 'function' &&
             DD001002QGridObj.getDataRows().length > 0;
    }).catch(() => false);
    if (ready) return true;
    await sleep(500);
  }
  return false;
}

async function waitForDetailGrid(page, timeout = 15000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const ready = await page.evaluate(() => {
      return typeof DD001003SGridObj !== 'undefined' &&
             typeof DD001003SGridObj.getDataRows === 'function' &&
             DD001003SGridObj.getDataRows().length > 0;
    }).catch(() => false);
    if (ready) return true;
    await sleep(500);
  }
  return false;
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
  await dismissModalIfAny(page);
  const ready = await waitForListGrid(page);
  if (!ready) throw new Error(`페이지 ${pageNum} 로드 실패`);
  const cnt = await page.evaluate(() => DD001002QGridObj.getDataRows().length);
  console.log(`  [페이지 ${pageNum}: ${cnt}행 로드]\n`);
  return cnt;
}

async function main() {
  console.log(`=== 경북대학교병원 세부내역검토 자동 입력 ===`);
  console.log(`모드: ${SAVE_MODE ? '★ 실제 저장' : 'DRY RUN (저장 안 함)'}`);
  console.log(`시작 행: ${START_ROW}`);
  console.log(`총 ${results.length}건 (적정 ${results.filter(r => r.status === '적정').length}, 확인 ${results.filter(r => r.status === '확인').length})`);
  console.log('');

  // DRY RUN일 때는 계획만 출력
  if (!SAVE_MODE) {
    console.log('[ DRY RUN - 실행 계획 ]\n');
    for (const r of results) {
      if (r.rowNum < START_ROW) continue;
      const statusKor = r.status === '적정' ? '검토완료' : '보완요청';
      const ov = r.status === '확인' ? OVERRIDES[r.rowNum] : null;
      const pageNum = Math.ceil(r.rowNum / PAGE_SIZE);
      const gridIdx = r.rowNum - (pageNum - 1) * PAGE_SIZE - 1;
      console.log(`R${String(r.rowNum).padStart(2)} [P${pageNum}:${gridIdx}] ${r.type.padEnd(6)} ${String(r.amount.toLocaleString()).padStart(12)}원 → ${statusKor}`);
      if (ov) {
        console.log(`     불인정: ${ov.disallowed.toLocaleString()}원 | ${ov.comment}`);
      }
    }
    console.log('\n→ 실제 저장하려면: node review-knuh.js --save');
    return;
  }

  // === 실제 저장 모드 ===
  const browser = await chromium.connectOverCDP('http://localhost:9444');
  const context = browser.contexts()[0];

  // 불필요한 팝업 닫기
  for (const p of context.pages()) {
    if (p.url().includes('blank') || p.url() === 'about:blank') {
      await p.close().catch(() => {});
    }
  }

  let page = context.pages().find(p => p.url().includes('dd001'));
  if (!page) {
    console.log('ERROR: dd001 페이지를 찾을 수 없습니다.');
    return;
  }
  page.on('dialog', async d => { try { await d.accept(); } catch {} });

  await dismissModalIfAny(page);
  await sleep(500);

  // 상세 페이지에 있으면 목록으로 돌아감
  if (page.url().includes('DD001003S') || page.url().includes('dd001003')) {
    console.log('현재 상세 페이지 → 목록으로 돌아감...');
    await page.evaluate(() => f_prevPage()).catch(() => {});
    await sleep(3000);
    await dismissModalIfAny(page);
  }

  const gridReady = await waitForListGrid(page);
  if (!gridReady) {
    console.log('ERROR: 목록 그리드 데이터 없음');
    return;
  }

  let currentPage = 1;
  let processed = 0, skipped = 0, errors = 0;

  // 시작 행에 맞는 페이지로 이동
  const startPage = Math.ceil(START_ROW / PAGE_SIZE);
  if (startPage > 1) {
    await goToListPage(page, startPage);
    currentPage = startPage;
  }

  for (const r of results) {
    if (r.rowNum < START_ROW) {
      skipped++;
      continue;
    }

    // 현재 행이 속한 페이지 계산
    const targetPage = Math.ceil(r.rowNum / PAGE_SIZE);
    const gridIdx = r.rowNum - (targetPage - 1) * PAGE_SIZE - 1;  // 0-based

    // 페이지 변경 필요시
    if (targetPage !== currentPage) {
      await goToListPage(page, targetPage);
      currentPage = targetPage;
    }

    const statusKor = r.status === '적정' ? '검토완료' : '보완요청';
    const ov = r.status === '확인' ? OVERRIDES[r.rowNum] : null;

    console.log(`--- R${r.rowNum} [${r.type}] ${r.amount.toLocaleString()}원 (${r.vendor}) → ${statusKor} ---`);
    if (ov) {
      console.log(`    불인정: ${ov.disallowed.toLocaleString()}원 | 의견: ${ov.comment}`);
    }

    try {
      // ===== 1. 목록 페이지에서 행 선택 =====
      const rowInfo = await page.evaluate((idx) => {
        const grid = DD001002QGridObj;
        const rows = grid.getDataRows();
        if (idx >= rows.length) return null;
        grid.selectRow(rows[idx]);
        const rv = grid.getRowValue(rows[idx]);
        return {
          purpose: rv.excutPrposCn,
          amount: rv.excutAmount || rv.excutSumAmount,
        };
      }, gridIdx);

      if (!rowInfo) {
        console.log(`    ERROR: 그리드 인덱스 ${gridIdx} 범위 초과`);
        errors++;
        continue;
      }

      // 금액 검증
      const gridAmount = parseInt(String(rowInfo.amount).replace(/,/g, ''));
      if (gridAmount !== r.amount) {
        console.log(`    WARNING: 금액 불일치 (그리드: ${gridAmount}, 결과: ${r.amount}) — 건너뜀`);
        errors++;
        continue;
      }

      console.log(`    행 선택: ${rowInfo.purpose}`);
      await sleep(500);

      // ===== 2. 세부내역검토 클릭 → 상세 페이지 이동 =====
      await page.click('#DD001002Q_detlListExmnt');
      await sleep(3000);

      // 모달 체크 (에러)
      const modal = await page.evaluate(() => {
        const m = document.querySelector('.popupMask.on');
        return m ? (m.querySelector('.message')?.textContent?.trim() || null) : null;
      }).catch(() => null);

      if (modal) {
        console.log(`    모달 에러: ${modal}`);
        await dismissModalIfAny(page);
        await sleep(500);
        errors++;
        continue;
      }

      // 상세 그리드 대기
      const detailReady = await waitForDetailGrid(page);
      if (!detailReady) {
        console.log(`    ERROR: 상세 페이지 그리드 로드 실패`);
        errors++;
        await page.evaluate(() => f_prevPage()).catch(() => {});
        await sleep(3000);
        await dismissModalIfAny(page);
        await waitForListGrid(page);
        continue;
      }

      // ===== 3. 검토 결과 입력 =====
      if (r.status === '적정') {
        await page.evaluate(() => f_changeExmntPrgst("001"));
        console.log(`    검토완료 설정`);
      } else {
        // 보완요청: 인수를 하나의 객체로 전달
        await page.evaluate(({ disallowed, comment }) => {
          f_changeExmntPrgst("002");

          const grid = DD001003SGridObj;
          const rows = grid.getDataRows();
          const row = rows[0];
          if (disallowed > 0) {
            grid.setValue(row, "nrcgnAmount", String(disallowed));
          }

          const htmlComment = comment.replace(/\n/g, "<br>");
          grid.setValue(row, "exclexCn", htmlComment);
          grid.setValue(row, "orgExclexCn", htmlComment);
        }, { disallowed: ov.disallowed, comment: ov.comment });

        console.log(`    보완요청 설정 (불인정: ${ov.disallowed.toLocaleString()}원)`);
      }

      // ===== 4. 저장 =====
      await page.click('#DD001003S_btnSave');
      await sleep(500);

      // 확인 모달 ("등록 하시겠습니까?")
      const confirmed = await waitAndDismissModal(page, 5000);
      if (!confirmed) {
        console.log(`    WARNING: 확인 모달 미출현`);
        // 유효성 에러 모달일 수 있음
        const errMsg = await page.evaluate(() => {
          const m = document.querySelector('.popupMask.on');
          return m ? (m.querySelector('.message')?.textContent?.trim() || '') : '';
        }).catch(() => '');
        if (errMsg) {
          console.log(`    에러: ${errMsg}`);
          await dismissModalIfAny(page);
        }
        errors++;
        await page.evaluate(() => f_prevPage()).catch(() => {});
        await sleep(3000);
        await dismissModalIfAny(page);
        await waitForListGrid(page);
        continue;
      }

      // AJAX 완료 + 성공 모달
      await sleep(2000);
      const success = await waitAndDismissModal(page, 10000);
      if (success) {
        console.log(`    저장 완료`);
      } else {
        console.log(`    WARNING: 성공 모달 미출현 (AJAX 대기 초과)`);
        await dismissModalIfAny(page);
      }
      await sleep(1000);

      // ===== 5. 이전 페이지 → 목록 복귀 =====
      await page.evaluate(() => f_prevPage()).catch(async () => {
        await page.click('#DD001003S_btnPrevPage').catch(() => {});
      });
      await sleep(3000);

      // 모달 체크
      await dismissModalIfAny(page);
      await sleep(500);

      // 목록 그리드 대기
      const listReady = await waitForListGrid(page);
      if (!listReady) {
        console.log(`    WARNING: 목록 복귀 실패, 재시도...`);
        await sleep(3000);
        await dismissModalIfAny(page);
        const retry = await waitForListGrid(page, 10000);
        if (!retry) {
          console.log(`    ERROR: 목록 복귀 불가, 중단`);
          errors++;
          break;
        }
      }

      // 목록 복귀 후 다시 올바른 페이지 확인
      // (이전 페이지 복귀 시 1페이지로 돌아갈 수 있음)
      const afterRows = await page.evaluate(() => DD001002QGridObj.getDataRows().length);
      // 현재 페이지의 예상 행 수 확인
      const expectedPageRows = targetPage === 1 ? PAGE_SIZE : (results.length - PAGE_SIZE);
      if (afterRows !== expectedPageRows && targetPage > 1) {
        // 1페이지로 돌아갔을 수 있음 → 다시 올바른 페이지로
        console.log(`    [페이지 재이동: ${afterRows}행 → 페이지 ${targetPage}]`);
        await goToListPage(page, targetPage);
      }

      processed++;
      console.log(`    완료 (${processed}/${results.length - skipped})\n`);

    } catch (err) {
      console.log(`    ERROR: ${err.message}`);
      errors++;

      await dismissModalIfAny(page);
      await sleep(1000);
      try {
        if (page.url().includes('DD001003S') || page.url().includes('dd001003')) {
          await page.evaluate(() => f_prevPage()).catch(() => {});
          await sleep(3000);
          await dismissModalIfAny(page);
        }
        await waitForListGrid(page, 10000);
      } catch {}
    }
  }

  // === 결과 요약 ===
  console.log('\n=============================');
  console.log(`처리 완료: ${processed}건`);
  console.log(`건너뜀: ${skipped}건`);
  console.log(`오류: ${errors}건`);
  console.log('=============================');
}

main().catch(console.error);
