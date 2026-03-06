/**
 * e나라도움 자동 네비게이션 모듈
 *
 * 기능:
 *  1) 세션 연장 (5분마다 자동)
 *  2) 점검대상사업조회 페이지 이동
 *  3) 기관 검색 + 사업 선택
 *  4) 집행내역조회 이동 + 검색
 *  5) 정산구분 자동 설정 (사업수행중 → 중간정산)
 *
 * 사용법:
 *   const nav = require('./lib/navigate');
 *   const { page } = await nav.goToInstitution({
 *     institutionName: '바이오링크',
 *     projectKeyword: '디지털헬스케어',
 *     year: 2025,
 *   });
 */
const { sleep, connectBrowser, dismissModals, waitForGrid } = require('../../utils');

// ── 세션 연장 ──

let _keepAliveTimer = null;

/**
 * 세션 연장 버튼을 주기적으로 클릭 (5분 간격)
 */
function startKeepAlive(page, intervalMs = 5 * 60 * 1000) {
  stopKeepAlive();

  const doExtend = async () => {
    try {
      await page.evaluate(() => {
        const btn = document.getElementById('headSessionExtend');
        if (btn) btn.click();
        // 연장 확인 모달이 뜰 수 있음
        setTimeout(() => {
          const modal = document.querySelector('.popupMask.on');
          if (modal) {
            const ok = modal.querySelector('button.fn.ok, .fn.ok, footer button');
            if (ok) ok.click();
          }
        }, 1000);
      });
      console.log(`  [세션 연장 ${new Date().toLocaleTimeString()}]`);
    } catch { /* session extend failed - non-critical */ }
  };

  // 즉시 한번 실행
  doExtend();
  _keepAliveTimer = setInterval(doExtend, intervalMs);
  return _keepAliveTimer;
}

function stopKeepAlive() {
  if (_keepAliveTimer) {
    clearInterval(_keepAliveTimer);
    _keepAliveTimer = null;
  }
}

// ── 점검대상사업조회 페이지 이동 ──

/**
 * 현재 페이지가 점검대상사업조회(DD001005Q)인지 확인
 */
async function isOnInspectionPage(page) {
  return page.evaluate(() => {
    return typeof DD001005QGridObj !== 'undefined' ||
           document.getElementById('DD001005Q_selBsnsyear') !== null;
  }).catch(() => false);
}

/**
 * 현재 페이지가 사업별집행내역조회(DD001002Q)인지 확인
 */
async function isOnExecutionPage(page) {
  return page.evaluate(() => {
    return typeof DD001002QGridObj !== 'undefined';
  }).catch(() => false);
}

/**
 * 점검대상사업조회 페이지로 이동
 */
async function goToInspectionPage(page) {
  const already = await isOnInspectionPage(page);
  if (already) {
    console.log('  이미 점검대상사업조회 페이지에 있습니다.');
    return true;
  }

  console.log('  점검대상사업조회 페이지로 이동...');

  // 즐겨찾기 → 점검대상사업조회 클릭
  const redirectOk = await page.evaluate(() => {
    if (typeof f_redirectToBookmark === 'function') {
      f_redirectToBookmark("/exe/dd/dd001/getDD001005QView.do?PJTCD=EXE", "EXE");
      return true;
    }
    return false;
  }).catch(() => false);

  if (redirectOk) {
    await sleep(3000);
    await dismissModals(page);

    // 페이지 로드 대기
    for (let i = 0; i < 20; i++) {
      const on = await isOnInspectionPage(page);
      if (on) return true;
      await sleep(1000);
    }
  }

  console.log('  f_redirectToBookmark 미사용 또는 로드 실패, URL 직접 이동 시도...');
  await page.goto('https://gvs.gosims.go.kr/exe/dd/dd001/getDD001005QView.do?PJTCD=EXE', {
    waitUntil: 'domcontentloaded', timeout: 15000
  }).catch(() => {});
  await sleep(3000);

  return isOnInspectionPage(page);
}

// ── 기관 검색 ──

/**
 * 점검대상사업조회에서 기관 검색
 * @param {string} institutionName - 기관명 (e.g. '바이오링크')
 * @param {number} year - 사업연도 (e.g. 2025)
 * @returns {Array} 검색 결과 목록
 */
async function searchInstitution(page, institutionName, year = 2025) {
  console.log(`  사업연도 ${year}년, 기관명 "${institutionName}" 검색...`);

  // 1) 사업연도 변경
  await page.selectOption('#DD001005Q_selBsnsyear', String(year));
  await sleep(500);

  // 2) 하위보조사업자명 입력
  await page.fill('#DD001005Q_srcExcInsttNm', institutionName);
  await sleep(300);

  // 3) 검색 클릭
  await page.click('#DD001005Q_btnRetrieveChckTrgetBsnsList');
  await sleep(3000);
  await dismissModals(page);

  // 4) 결과 대기
  const hasData = await waitForGrid(page, 'DD001005QGridObj', 10000);

  // 5) 결과 추출
  const results = await page.evaluate(() => {
    const grid = window.DD001005QGridObj;
    if (!grid || typeof grid.getDataRows !== 'function') return [];
    const rows = grid.getDataRows();
    return rows.map((row, i) => {
      const rv = grid.getRowValue(row);
      return {
        index: i,
        taskNm: rv.taskNm || '',           // 사업명
        excInsttNm: rv.excInsttNm || '',     // 보조사업자(기관명)
        excutLmttResnNm: rv.excutLmttResnNm || '', // 사업상태
        bsnsyear: rv.bsnsyear || '',
        taskNo: rv.taskNo || '',
      };
    });
  });

  if (results.length === 0) {
    console.log('  검색 결과 없음');
  } else {
    console.log(`  검색 결과 ${results.length}건:`);
    for (const r of results) {
      console.log(`    [${r.index}] ${r.taskNm} | ${r.excInsttNm} | ${r.excutLmttResnNm}`);
    }
  }

  return results;
}

// ── 사업 선택 + 집행내역조회 이동 ──

/**
 * 검색 결과에서 사업명 매칭하여 선택 후 집행내역조회 이동
 * @param {string} projectKeyword - 사업명 키워드 (e.g. '디지털헬스케어')
 * @returns {object} 선택된 사업 정보
 */
async function selectProjectAndGoToExecution(page, searchResults, projectKeyword) {
  // 사업명 매칭
  let matchIdx = -1;

  if (projectKeyword) {
    // 쉼표로 구분된 복수 키워드 → 모두 포함해야 매칭 (AND 조건)
    const keywords = projectKeyword.split(',').map(k => k.trim().toLowerCase()).filter(Boolean);
    matchIdx = searchResults.findIndex(r => {
      const name = r.taskNm.toLowerCase();
      return keywords.every(kw => name.includes(kw));
    });
    if (matchIdx >= 0) {
      console.log(`  사업명 매칭 "${projectKeyword}" → [${matchIdx}] ${searchResults[matchIdx].taskNm}`);
    } else {
      console.log(`  WARNING: "${projectKeyword}" 매칭 실패 (${searchResults.length}건 중 해당 없음)`);
      for (const r of searchResults) console.log(`    - ${r.taskNm}`);
      matchIdx = -1;
    }
  } else if (searchResults.length === 1) {
    matchIdx = 0;
    console.log(`  단일 결과 → 자동 선택: ${searchResults[0].taskNm}`);
  } else {
    console.log('  WARNING: 여러 결과 + 키워드 없음 → 첫번째 선택');
    matchIdx = 0;
  }

  if (matchIdx < 0) {
    throw new Error('선택할 사업이 없습니다.');
  }

  const selected = searchResults[matchIdx];

  // 1) 그리드 행 선택 (focus 사용 - selectRow는 버그있음)
  await page.evaluate((idx) => {
    const grid = DD001005QGridObj;
    const rows = grid.getDataRows();
    if (idx < rows.length) {
      grid.focus(rows[idx]);
    }
  }, matchIdx);
  await sleep(500);

  // 2) 정산구분: run-all.js에서 DD001002Q 단계에서 처리하므로 여기선 건드리지 않음
  console.log(`  사업상태: ${selected.excutLmttResnNm}`);
  await sleep(500);

  // 3) 집행내역조회 클릭
  console.log('  집행내역조회 이동...');
  await page.click('#DD001005Q_btnExcutDetlInqire');
  await sleep(4000);
  await dismissModals(page);

  // 4) 사업별집행내역조회 페이지 대기
  for (let i = 0; i < 15; i++) {
    const on = await isOnExecutionPage(page);
    if (on) break;
    await sleep(1000);
    await dismissModals(page);
  }

  const onExec = await isOnExecutionPage(page);
  if (!onExec) {
    throw new Error('사업별집행내역조회 페이지 로드 실패');
  }

  // 5) 검색 버튼 클릭하여 집행내역 로드
  console.log('  집행내역 검색...');
  const searchBtn = await page.$('#DD001002Q_btnRetrieve');
  if (searchBtn) {
    await searchBtn.click();
  } else {
    // 검색 버튼 ID가 다를 수 있음 → 텍스트로 찾기
    await page.evaluate(() => {
      const btns = [...document.querySelectorAll('button')];
      const searchBtn = btns.find(b => b.textContent.trim() === '검색' && b.id.includes('DD001002'));
      if (searchBtn) searchBtn.click();
      else {
        // fallback: 모든 검색 버튼 중 현재 보이는 것
        const visible = btns.find(b => {
          const rect = b.getBoundingClientRect();
          return b.textContent.trim() === '검색' && rect.width > 0;
        });
        if (visible) visible.click();
      }
    });
  }

  await sleep(3000);
  await dismissModals(page);
  await waitForGrid(page, 'DD001002QGridObj', 15000);

  // 6) 결과 확인
  const gridCount = await page.evaluate(() => {
    if (typeof DD001002QGridObj === 'undefined') return 0;
    return DD001002QGridObj.getDataRows().length;
  }).catch(() => 0);

  console.log(`  집행내역 ${gridCount}건 로드 완료`);

  return { ...selected, gridCount };
}

// ── 통합 함수 ──

/**
 * 기관 페이지로 한번에 이동
 * @param {object} opts
 * @param {string} opts.institutionName - 기관명
 * @param {string} opts.projectKeyword - 사업명 키워드 (부분 매칭)
 * @param {number} opts.year - 사업연도 (기본 2025)
 * @param {number} opts.port - Chrome 디버그 포트 (기본 9444)
 */
async function goToInstitution(opts) {
  const {
    institutionName,
    projectKeyword = '',
    year = 2025,
    port = 9444,
  } = opts;

  console.log(`\n=== e나라도움 네비게이션 ===`);
  console.log(`기관: ${institutionName}`);
  console.log(`사업 키워드: ${projectKeyword || '(없음)'}`);
  console.log(`사업연도: ${year}\n`);

  // 1) 브라우저 연결
  const { browser, context } = await connectBrowser(port);
  let page = context.pages().find(p => p.url().includes('gosims'));
  if (!page) {
    throw new Error('e나라도움 페이지를 찾을 수 없습니다. Chrome에서 e나라도움에 로그인해주세요.');
  }
  page.on('dialog', async d => { try { await d.accept(); } catch {} });

  // 2) 세션 연장 시작
  startKeepAlive(page);

  // 3) 점검대상사업조회 이동
  const onInspection = await goToInspectionPage(page);
  if (!onInspection) {
    throw new Error('점검대상사업조회 페이지로 이동할 수 없습니다.');
  }

  // 4) 기관 검색
  const results = await searchInstitution(page, institutionName, year);
  if (results.length === 0) {
    throw new Error(`"${institutionName}" 검색 결과가 없습니다. 기관명을 확인해주세요.`);
  }

  // 5) 사업 선택 + 집행내역조회
  const selected = await selectProjectAndGoToExecution(page, results, projectKeyword);

  console.log(`\n=== 네비게이션 완료 ===`);
  console.log(`사업: ${selected.taskNm}`);
  console.log(`기관: ${selected.excInsttNm}`);
  console.log(`상태: ${selected.excutLmttResnNm}`);
  console.log(`집행건수: ${selected.gridCount}건\n`);

  return { page, context, browser, selected };
}

module.exports = {
  startKeepAlive,
  stopKeepAlive,
  isOnInspectionPage,
  isOnExecutionPage,
  goToInspectionPage,
  searchInstitution,
  selectProjectAndGoToExecution,
  goToInstitution,
};

// ── CLI ──
if (require.main === module) {
  const args = process.argv.slice(2);
  const getArg = (prefix) => {
    const a = args.find(x => x.startsWith(prefix));
    return a ? a.substring(prefix.length) : null;
  };

  const name = getArg('--name=') || args[0];
  const keyword = getArg('--project=') || '';
  const year = parseInt(getArg('--year=') || '2025');

  if (!name) {
    console.log('사용법: node lib/navigate.js --name=바이오링크 [--project=디지털헬스케어] [--year=2025]');
    process.exit(1);
  }

  goToInstitution({ institutionName: name, projectKeyword: keyword, year })
    .then(({ selected }) => {
      console.log('완료:', JSON.stringify(selected, null, 2));
      // 세션 연장은 계속 유지 (Ctrl+C로 종료)
    })
    .catch(e => {
      console.error('ERROR:', e.message);
      stopKeepAlive();
      process.exit(1);
    });
}
