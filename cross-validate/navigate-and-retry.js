/**
 * navigate-and-retry.js
 * 1. 과제목록(DD001005Q)에서 대구경북재단 과제 선택
 * 2. 집행내역(DD001002Q)으로 진입
 * 3. 미처리 항목 스캔 및 처리
 */

const { sleep, connectBrowser, findEnaraPage, dismissModals, waitModal, waitForGrid } = require('../lib/utils');
const fs = require('fs');
const path = require('path');

const PAGE_SIZE = 20;

async function ensureSettlement(page, settlement) {
  const radioId = settlement === 'interim'
    ? 'DD001002Q_excclcSeCode_2'
    : 'DD001002Q_excclcSeCode_1';
  const changed = await page.evaluate((id) => {
    const radio = document.getElementById(id);
    if (radio && !radio.checked) { radio.click(); return true; }
    return false;
  }, radioId);
  if (changed) {
    console.log(`  정산구분: ${settlement === 'interim' ? '중간정산' : '최종정산'} → 재검색`);
    await page.evaluate(() => {
      const btn = document.getElementById('DD001002Q_btnRetrieve');
      if (btn) btn.click();
    });
    await sleep(4000);
    await dismissModals(page);
    await waitForGrid(page, 'DD001002QGridObj', 15000);
  }
}

async function navigateToTask(page) {
  // 현재 상태 확인
  const currentUrl = page.url();
  console.log('현재 URL:', currentUrl);

  // Step 1: DD001005Q로 이동 (f_redirectToBookmark 사용 - navigate.js와 동일)
  console.log('=== 과제목록(DD001005Q) 진입 ===');

  // f_redirectToBookmark으로 DD001005Q 진입 (navigate.js와 동일)
  // 현재 페이지 상태에 관계없이 항상 깨끗하게 DD001005Q로 이동
  console.log('f_redirectToBookmark → DD001005Q...');
  await page.evaluate(() => {
    if (typeof f_redirectToBookmark === 'function') {
      f_redirectToBookmark("/exe/dd/dd001/getDD001005QView.do?PJTCD=EXE", "EXE");
    }
  }).catch(() => {});
  await sleep(5000);
  await dismissModals(page);

  // DD001005Q 페이지 로드 대기 (최대 20초)
  // 중요: URL이 DD001005Q인지 먼저 확인하고, 그 후 grid 대기
  let onDD005 = false;
  for (let i = 0; i < 20; i++) {
    const url = page.url();
    const hasGrid = await page.evaluate(() => typeof DD001005QGridObj !== 'undefined').catch(() => false);
    if (url.includes('DD001005') && hasGrid) {
      console.log(`  DD001005Q 로드 완료 (${i}초)`);
      onDD005 = true;
      break;
    }
    await sleep(1000);
    await dismissModals(page);
  }

  if (!onDD005) {
    // fallback: page.goto로 직접 이동
    console.log('  f_redirectToBookmark 실패, page.goto 시도...');
    await page.goto('https://gvs.gosims.go.kr/exe/dd/dd001/getDD001005QView.do?PJTCD=EXE', {
      waitUntil: 'domcontentloaded', timeout: 30000
    }).catch(() => {});
    await sleep(5000);
    await dismissModals(page);
    for (let i = 0; i < 15; i++) {
      const url = page.url();
      const exists = await page.evaluate(() => typeof DD001005QGridObj !== 'undefined').catch(() => false);
      if (url.includes('DD001005') && exists) { onDD005 = true; break; }
      await sleep(1000);
      await dismissModals(page);
    }
  }

  console.log('DD001005Q URL:', page.url());
  if (!onDD005) throw new Error('DD001005Q 페이지 로드 실패');

  // Step 2: 사업연도 + 기관명 검색
  await page.selectOption('#DD001005Q_selBsnsyear', '2025').catch(() => {});
  await sleep(500);

  console.log('기관명 "대구경북" 검색...');
  await page.fill('#DD001005Q_srcExcInsttNm', '대구경북').catch(() => {});
  await sleep(300);
  await page.evaluate(() => {
    const btn = document.getElementById('DD001005Q_btnRetrieveChckTrgetBsnsList');
    if (btn) btn.click();
  });
  await sleep(5000);
  await dismissModals(page);
  const gridOk = await waitForGrid(page, 'DD001005QGridObj', 15000);
  if (!gridOk) {
    console.log('WARNING: DD001005Q 검색 결과 없음, 한번 더 시도...');
    await sleep(2000);
    await page.evaluate(() => {
      const btn = document.getElementById('DD001005Q_btnRetrieveChckTrgetBsnsList');
      if (btn) btn.click();
    });
    await sleep(5000);
    await dismissModals(page);
    await waitForGrid(page, 'DD001005QGridObj', 15000);
  }

  // Step 3: 과제 선택 (디지털헬스케어)
  const taskInfo = await page.evaluate(() => {
    const grid = DD001005QGridObj;
    const rows = grid.getDataRows();
    const results = [];
    for (let i = 0; i < rows.length; i++) {
      const rv = grid.getRowValue(rows[i]);
      results.push({
        idx: i,
        taskNm: rv.taskNm || '',
        excInsttNm: rv.excInsttNm || '',
        excutLmttResnNm: rv.excutLmttResnNm || '',
      });
    }
    let matchIdx = results.findIndex(r => /디지털헬스케어/.test(r.taskNm));
    if (matchIdx < 0 && results.length === 1) matchIdx = 0;
    if (matchIdx >= 0) grid.focus(rows[matchIdx]);
    return { results, matchIdx };
  });

  if (taskInfo.matchIdx < 0) {
    console.log('과제 목록:');
    taskInfo.results.forEach(r => console.log(`  [${r.idx}] ${r.taskNm} | ${r.excInsttNm}`));
    throw new Error('디지털헬스케어 과제를 찾을 수 없음');
  }

  const sel = taskInfo.results[taskInfo.matchIdx];
  console.log(`과제 선택: [${taskInfo.matchIdx}] ${sel.taskNm} | ${sel.excInsttNm} | ${sel.excutLmttResnNm}`);
  await sleep(500);

  // Step 4: 집행내역조회 클릭 → DD001002Q로 이동
  console.log('집행내역조회 이동...');
  await page.evaluate(() => {
    const btn = document.getElementById('DD001005Q_btnExcutDetlInqire');
    if (btn) btn.click();
  });
  await sleep(4000);
  await dismissModals(page);

  // DD001002Q 페이지 로드 대기
  console.log('DD001002Q 로드 대기...');
  for (let i = 0; i < 20; i++) {
    const exists = await page.evaluate(() => typeof DD001002QGridObj !== 'undefined').catch(() => false);
    if (exists) { console.log(`  DD001002QGridObj 발견 (${i}초)`); break; }
    await sleep(1000);
    await dismissModals(page);
  }

  // Step 5: 정산구분 중간정산 설정
  const pageUrl = page.url();
  console.log('DD001002Q URL:', pageUrl);
  const gridExists = await page.evaluate(() => typeof DD001002QGridObj !== 'undefined').catch(() => false);
  if (!gridExists) {
    const bodySnippet = await page.evaluate(() => document.body.innerText.substring(0, 300)).catch(() => '(eval failed)');
    console.log('Body:', bodySnippet);
    throw new Error('DD001002QGridObj 미발견');
  }

  await page.evaluate(() => {
    const r2 = document.getElementById('DD001002Q_excclcSeCode_2');
    if (r2 && !r2.checked) r2.click();
  });
  await sleep(500);

  // Step 6: 검색 버튼 클릭 (navigate.js 참조: DD001002Q_btnRetrieve 우선)
  console.log('집행내역 검색...');
  const searchResult = await page.evaluate(() => {
    const btn = document.getElementById('DD001002Q_btnRetrieve') ||
                document.getElementById('DD001002Q_btnRetrieveList') ||
                [...document.querySelectorAll('button')].find(b =>
                  b.textContent.trim() === '검색' && b.id.includes('DD001002') && b.offsetWidth > 0);
    if (btn) { btn.click(); return 'clicked: ' + btn.id; }
    const visible = [...document.querySelectorAll('button')].find(b =>
      b.textContent.trim() === '검색' && b.getBoundingClientRect().width > 0);
    if (visible) { visible.click(); return 'clicked fallback: ' + (visible.id || visible.textContent.trim()); }
    return 'NO SEARCH BUTTON FOUND';
  });
  console.log('  검색 버튼:', searchResult);
  await sleep(5000);
  await dismissModals(page);

  // Step 7: 그리드 데이터 대기
  const gridReady = await waitForGrid(page, 'DD001002QGridObj', 15000);
  const rowCount = await page.evaluate(() => {
    try { return DD001002QGridObj.getDataRows().length; } catch(e) { return 0; }
  });
  console.log(`집행내역 로드: ${rowCount}행\n`);

  if (rowCount === 0) {
    const btns = await page.evaluate(() => {
      return [...document.querySelectorAll('button, input[type=button]')]
        .filter(b => b.offsetWidth > 0)
        .map(b => ({ id: b.id, text: (b.textContent || b.value || '').trim().substring(0, 30) }))
        .filter(b => b.id.includes('DD001002') || /검색|조회/.test(b.text));
    });
    console.log('Available buttons:', JSON.stringify(btns));
    const radios = await page.evaluate(() => {
      return [...document.querySelectorAll('input[type=radio]')]
        .filter(r => r.id.includes('excclc'))
        .map(r => ({ id: r.id, checked: r.checked, value: r.value }));
    });
    console.log('Settlement radios:', JSON.stringify(radios));
    throw new Error('집행내역 0행 - 검색 실패');
  }
  return rowCount;
}

async function scanAllPages(page) {
  const unprocessed = [];
  for (let pg = 1; pg <= 20; pg++) {
    if (pg > 1) {
      await page.evaluate((pn) => { f_retrieveListBsnsExcutDetl(pn); }, pg);
      await sleep(3000);
      await dismissModals(page);
      const ok = await waitForGrid(page, 'DD001002QGridObj', 10000);
      if (!ok) break;
    }

    const pageData = await page.evaluate(() => {
      const grid = DD001002QGridObj;
      const dataRows = grid.getDataRows();
      return dataRows.map((row, i) => {
        const rv = grid.getRowValue(row);
        const statusNm = rv.exmntPrgstCdNm || rv.exmntPrgstNm || '';
        const statusCd = rv.exmntPrgstCd || '';
        return {
          gridIdx: i,
          amount: parseInt(String(rv.lastAmount || rv.excutSumAmount || rv.excutAmount || '0').replace(/,/g, '')),
          vendor: rv.bcncCmpnyNm || '',
          purpose: rv.excutPrposCn || '',
          statusCd,
          statusNm,
        };
      });
    });

    if (pageData.length === 0) break;

    let pageUnproc = 0;
    for (const row of pageData) {
      const isProcessed = row.statusCd === '001' || row.statusCd === '002' ||
                          /검토완료|보완요청|검토불필요/.test(row.statusNm);
      if (!isProcessed && row.amount > 0) {
        unprocessed.push({ ...row, page: pg });
        pageUnproc++;
      }
    }
    console.log(`  페이지 ${pg}: ${pageData.length}행, 미처리 ${pageUnproc}건`);
  }
  return unprocessed;
}

async function processOne(page, item, results, listUrl) {
  // Match against results
  let targetStatus = '확인';
  let issues = ['매칭 없음'];
  for (const r of results) {
    if (r.amount === item.amount) {
      const venMatch = r.vendor && item.vendor.includes(r.vendor.substring(0, Math.min(5, r.vendor.length)));
      if (venMatch || item.purpose.includes(r.vendor.substring(0, 3))) {
        targetStatus = r.status;
        issues = r.issues || [];
        break;
      }
    }
  }

  const statusKor = targetStatus === '적정' ? '검토완료' : '보완요청';
  console.log(`  [${item.purpose.substring(0, 25)}] ${item.amount.toLocaleString()}원 → ${statusKor}`);

  // Navigate to the right page
  if (item.page > 1) {
    await page.evaluate((pn) => { f_retrieveListBsnsExcutDetl(pn); }, item.page);
    await sleep(3000);
    await dismissModals(page);
    await waitForGrid(page, 'DD001002QGridObj', 10000);
  }

  // Focus the row (find by amount + vendor + purpose, excluding processed)
  const focused = await page.evaluate(({ amt, ven, pur }) => {
    const grid = DD001002QGridObj;
    const rows = grid.getDataRows();
    for (let i = 0; i < rows.length; i++) {
      const rv = grid.getRowValue(rows[i]);
      const rowAmt = parseInt(String(rv.lastAmount || rv.excutSumAmount || rv.excutAmount || '0').replace(/,/g, ''));
      if (rowAmt !== amt) continue;
      const statusCd = rv.exmntPrgstCd || '';
      const statusNm = rv.exmntPrgstCdNm || '';
      if (statusCd === '001' || statusCd === '002' || /검토완료|보완요청/.test(statusNm)) continue;
      const rowPur = rv.excutPrposCn || '';
      if (pur && rowPur.includes(pur.substring(0, Math.min(10, pur.length)))) {
        grid.focus(rows[i]);
        return rv.excutPrposCn;
      }
      // Fallback: vendor match
      const rowVen = rv.bcncCmpnyNm || '';
      if (ven && rowVen.includes(ven.substring(0, Math.min(5, ven.length)))) {
        grid.focus(rows[i]);
        return rv.excutPrposCn;
      }
    }
    // Last resort: just match amount and unprocessed
    for (let i = 0; i < rows.length; i++) {
      const rv = grid.getRowValue(rows[i]);
      const rowAmt = parseInt(String(rv.lastAmount || rv.excutSumAmount || rv.excutAmount || '0').replace(/,/g, ''));
      if (rowAmt !== amt) continue;
      const statusCd = rv.exmntPrgstCd || '';
      if (statusCd === '001' || statusCd === '002') continue;
      grid.focus(rows[i]);
      return rv.excutPrposCn;
    }
    return null;
  }, { amt: item.amount, ven: item.vendor, pur: item.purpose });

  if (!focused) {
    console.log(`    행 선택 실패`);
    return false;
  }
  console.log(`    행: ${focused}`);
  await sleep(500);

  // 세부내역검토 클릭
  await page.click('#DD001002Q_detlListExmnt');
  await sleep(3000);

  const modalText = await page.evaluate(() => {
    const m = document.querySelector('.popupMask.on');
    return m ? m.textContent.trim() : null;
  }).catch(() => null);
  if (modalText && /선택/.test(modalText)) {
    await dismissModals(page);
    console.log(`    선택 모달 → 실패`);
    return false;
  }
  if (modalText) await dismissModals(page);

  const detailReady = await waitForGrid(page, 'DD001003SGridObj', 20000);
  if (!detailReady) {
    console.log(`    상세 페이지 로드 실패`);
    await page.evaluate(() => f_prevPage()).catch(() => {});
    await sleep(3000);
    await dismissModals(page);
    return false;
  }

  // 검토 결과 입력
  if (targetStatus === '적정') {
    await page.evaluate(() => f_changeExmntPrgst("001"));
  } else {
    const comment = issues.join('; ') || '추가 확인 필요';
    await page.evaluate(({ cmt }) => {
      f_changeExmntPrgst("002");
      const grid = DD001003SGridObj;
      const rows = grid.getDataRows();
      if (rows.length > 0) {
        grid.setValue(rows[0], "nrcgnAmount", "0");
        const htmlComment = cmt.replace(/\n/g, "<br>");
        grid.setValue(rows[0], "exclexCn", htmlComment);
        grid.setValue(rows[0], "orgExclexCn", htmlComment);
      }
    }, { cmt: comment });
  }

  // 저장
  await page.click('#DD001003S_btnSave');
  await sleep(500);

  const confirmed = await waitModal(page, 5000);
  if (!confirmed) {
    console.log(`    저장 확인 모달 미출현`);
    await dismissModals(page);
    await page.evaluate(() => f_prevPage()).catch(() => {});
    await sleep(3000);
    await dismissModals(page);
    return false;
  }

  await sleep(2000);
  const success = await waitModal(page, 10000);
  if (success) console.log(`    저장 완료`);
  else { console.log(`    성공 모달 미출현`); await dismissModals(page); }
  await sleep(1000);

  // 목록 복귀
  await page.evaluate(() => f_prevPage()).catch(() => {});
  await sleep(3000);
  await dismissModals(page);
  await waitForGrid(page, 'DD001002QGridObj', 10000);
  await ensureSettlement(page, 'interim');

  return true;
}

async function main() {
  const resultsFile = path.join(__dirname, '..', '대구경북재단-results-final.json');
  const results = JSON.parse(fs.readFileSync(resultsFile, 'utf-8'));
  console.log(`results: ${results.length}건\n`);

  const { context } = await connectBrowser();
  let page = await findEnaraPage(context);
  if (!page) { console.log('ERROR: e나라도움 없음'); return; }
  await dismissModals(page);

  // 1. 과제목록에서 진입
  await navigateToTask(page);
  const listUrl = page.url();

  // 2. 미처리 스캔
  console.log('=== 미처리 스캔 ===\n');
  // First go to page 1
  await page.evaluate(() => { f_retrieveListBsnsExcutDetl(1); });
  await sleep(3000);
  await dismissModals(page);
  await waitForGrid(page, 'DD001002QGridObj', 10000);

  const unprocessed = await scanAllPages(page);
  console.log(`\n미처리 총: ${unprocessed.length}건\n`);

  if (unprocessed.length === 0) {
    console.log('미처리 없음!');
    return;
  }

  // 3. 순서대로 처리
  console.log('=== 처리 시작 ===\n');
  let ok = 0, fail = 0;

  for (let i = 0; i < unprocessed.length; i++) {
    console.log(`[${i + 1}/${unprocessed.length}]`);
    try {
      // 매번 페이지 1로 돌아가서 시작 (처리 후 그리드 변경 대응)
      await page.evaluate(() => { f_retrieveListBsnsExcutDetl(1); });
      await sleep(2000);
      await dismissModals(page);
      await waitForGrid(page, 'DD001002QGridObj', 10000);

      // 현재 그리드에서 미처리 항목 찾기 (amount+purpose 기준)
      const item = unprocessed[i];
      const success = await processOne(page, item, results, listUrl);
      if (success) { ok++; console.log(`    ✓ (${ok}/${unprocessed.length})`); }
      else { fail++; console.log(`    ✗ 실패`); }
    } catch (err) {
      console.log(`    ERROR: ${err.message}`);
      fail++;
      await dismissModals(page).catch(() => {});
      await sleep(2000);
    }
  }

  console.log(`\n=============================`);
  console.log(`처리 성공: ${ok}건`);
  console.log(`실패: ${fail}건`);
  console.log(`=============================`);

  // 최종 확인
  if (fail > 0) {
    console.log('\n=== 잔여 미처리 확인 ===');
    await page.evaluate(() => { f_retrieveListBsnsExcutDetl(1); });
    await sleep(3000);
    await dismissModals(page);
    await waitForGrid(page, 'DD001002QGridObj', 10000);
    const remaining = await scanAllPages(page);
    console.log(`잔여 미처리: ${remaining.length}건`);
  }
}

main().catch(err => { console.error('FATAL:', err); process.exit(1); });
