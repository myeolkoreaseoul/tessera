/**
 * 이지바로 정산검토 통합 파이프라인 (건별 순차 처리)
 *
 * run-all.js (e나라도움)과 대칭 구조.
 * 이지바로 nexacro 기반 UI를 CDP로 제어.
 *
 * 사용법:
 *   node run-ezbaro.js --inst=기관명 --task=RS-2025-XXXXXXXX [옵션...]
 *
 * 옵션:
 *   --inst       연구수행기관명 (필수)
 *   --task       과제번호 (RS-xxxx, 필수)
 *   --project    사업 config 이름 (기본: 이지바로-공통)
 *   --dir        출력 디렉토리명 (기본: inst 기반)
 *   --dry-run    수집+분석만 (입력 안 함)
 *   --skip-judge judge 단계 건너뛰기
 *   --start=N    N번째 건부터 시작
 *   --host       Chrome CDP 호스트 (기본: 100.87.3.123)
 *   --port       Chrome CDP 포트 (기본: 9446)
 *   --staff=a,b  참여인력 이름 (자문료 중복 체크용)
 */
process.on('unhandledRejection', (err) => {
  if (err && err.message && err.message.includes('No dialog is showing')) return;
  console.error('UnhandledRejection:', err);
  // 복구 불가능한 오류 시 cleanup 후 종료
  try { require('./lib/adapters/ezbaro/navigate').stopKeepAliveEzbaro(); } catch {}
  process.exitCode = 1;
});

const fs = require('fs');
const path = require('path');
const { Reporter } = require('./lib/reporter');
const ezNav = require('./lib/adapters/ezbaro/navigate');
const ezCollect = require('./lib/adapters/ezbaro/collect');
const ezReview = require('./lib/adapters/ezbaro/review');
const { analyze: deepAnalyze, printSummary: printDeepSummary } = require('./lib/deep-analyze');
const { getConfig } = require('./lib/configs');
const { sleep } = require('./lib/utils');

// ── CLI 파싱 ──
const args = Object.fromEntries(
  process.argv.slice(2)
    .filter(a => a.startsWith('--'))
    .map(a => {
      const [k, ...v] = a.slice(2).split('=');
      return [k, v.length ? v.join('=') : true];
    })
);

const INST_NAME = args.inst;
const TASK_NO = args.task;
if (require.main === module && (!INST_NAME || !TASK_NO)) {
  console.log('사용법: node run-ezbaro.js --inst=기관명 --task=RS-2025-XXXXXXXX [옵션...]');
  console.log('  --inst         연구수행기관명 (필수)');
  console.log('  --task         과제번호 (필수)');
  console.log('  --project      사업 config 이름 (기본: 이지바로-공통)');
  console.log('  --dir          출력 디렉토리명');
  console.log('  --dry-run      수집+분석만 (입력 안 함)');
  console.log('  --skip-judge   judge 건너뛰기');
  console.log('  --start=N      N번째 건부터 시작');
  console.log('  --host         Chrome CDP 호스트');
  console.log('  --port         Chrome CDP 포트 (기본: 9446)');
  process.exit(1);
}

const PROJECT_NAME = args.project || '이지바로-공통';
const DIR_NAME = args.dir || (INST_NAME || 'ezbaro').replace(/[^가-힣a-zA-Z0-9]/g, '').substring(0, 20);
const DRY_RUN = !!args['dry-run'];
const SKIP_JUDGE = !!args['skip-judge'];
const START_ROW = Math.max(1, Math.floor(parseInt(args.start) || 1));
const STAFF = args.staff ? args.staff.split(',') : [];
const HOST = args.host || process.env.CDP_HOST || '100.87.3.123';
const PORT = parseInt(args.port) || parseInt(process.env.CDP_PORT_EZBARO || '9446');

const DATA_FILE = path.join(__dirname, `${DIR_NAME}-data.json`);
const RESULTS_FILE = path.join(__dirname, `${DIR_NAME}-results.json`);

const reporter = new Reporter({ system: 'ezbaro' });

// ── 유틸 ──
function saveIncremental(records, results) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(records, null, 2), 'utf-8');
  fs.writeFileSync(RESULTS_FILE, JSON.stringify(results, null, 2), 'utf-8');
}

/**
 * 이지바로 상세화면에서 현재 건 데이터 읽기
 * nexacro cal00202 화면의 데이터셋에서 추출
 */
async function readCurrentDetailEzbaro(page, rowIndex) {
  return page.evaluate((idx) => {
    const app = window._application;
    const frames = app?.gvWorkFrame?.frames;
    if (!frames) return null;

    let form = null;
    for (let i = 0; i < frames.length; i++) {
      const candidate = frames[i]?.form?.divWork?.form;
      if (candidate?.name === 'cal00202') {
        form = candidate;
        break;
      }
    }
    if (!form) return null;

    const ds = form.ds_calOrdtmChckExeList;
    if (!ds || idx >= ds.getRowCount()) return null;

    const get = (col) => ds.getColumn(idx, col) || '';
    const getNum = (col) => parseInt(ds.getColumn(idx, col)) || 0;

    return {
      rowNum: idx + 1,
      seq: getNum('rowNum') || (idx + 1),
      executionDate: get('exeD'),
      purpose: get('exeUsgCn'),
      budgetCategory: get('exeTpCNm'),
      subCategory: get('costItmNm'),
      itemName: get('prdlstNm') || get('exeUsgCn'),
      vendorName: get('trplNm'),
      totalAmount: getNum('exeAt'),
      evidenceType: get('pofSuNm'),
      status: get('ordtmChckSuNm'),
      progressStatus: get('ordtmChckCplSuNm'),
      remark: get('rmkCn'),
    };
  }, rowIndex);
}

/**
 * 이지바로 cal00202 데이터셋에서 전체 건수 읽기
 */
async function getTotalRowCount(page) {
  return page.evaluate(() => {
    const app = window._application;
    const frames = app?.gvWorkFrame?.frames;
    if (!frames) return 0;
    for (let i = 0; i < frames.length; i++) {
      const form = frames[i]?.form?.divWork?.form;
      if (form?.name === 'cal00202') {
        const ds = form.ds_calOrdtmChckExeList;
        return ds ? ds.getRowCount() : 0;
      }
    }
    return 0;
  }).catch(() => 0);
}

// ══════════════════════════════════════
//  메인 파이프라인
// ══════════════════════════════════════
async function main() {
  const t0 = Date.now();
  const projectConfig = getConfig(PROJECT_NAME, {
    institutionName: INST_NAME,
    staff: STAFF,
  });

  reporter.phaseChange(0, '이지바로 파이프라인 시작');
  console.log('╔══════════════════════════════════════════════════╗');
  console.log(`║  이지바로 정산검토`);
  console.log(`║  기관: ${INST_NAME}`);
  console.log(`║  과제: ${TASK_NO}`);
  console.log(`║  사업: ${PROJECT_NAME}`);
  console.log(`║  ${DRY_RUN ? 'DRY-RUN' : 'SAVE'} start=${START_ROW}`);
  console.log('╚══════════════════════════════════════════════════╝\n');

  // 기존 data/results 로드 (이어하기용)
  let records = [];
  let results = [];
  if (fs.existsSync(DATA_FILE)) {
    try {
      records = JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8'));
      console.log(`  기존 data 로드: ${records.length}건`);
    } catch {}
  }
  if (fs.existsSync(RESULTS_FILE)) {
    try {
      results = JSON.parse(fs.readFileSync(RESULTS_FILE, 'utf-8'));
      console.log(`  기존 results 로드: ${results.length}건`);
    } catch {}
  }

  // ════════ Phase 0: 네비게이션 ════════
  reporter.phaseChange(0, '네비게이션 — 상시점검 관리 진입');
  console.log('\n[Phase 0] 이지바로 연결 + 상시점검 관리 진입...');

  process.env.CDP_HOST = HOST;
  const { connectBrowser } = require('./lib/utils');
  const { browser, context } = await connectBrowser(PORT);
  const pages = context.pages();
  const page = pages.find(p => /ezbaro|rcms|iris|ernd|rnd/i.test(p.url())) || pages[0];
  if (!page) throw new Error('이지바로 페이지를 찾지 못했습니다.');

  page.on('dialog', async d => { try { await d.accept(); } catch {} });

  // nexacro 앱 확인
  const hasApp = await page.evaluate(() => !!window._application).catch(() => false);
  if (!hasApp) throw new Error('nexacro _application 객체를 찾지 못했습니다. 이지바로 로그인 상태를 확인하세요.');

  console.log(`  연결 성공: ${HOST}:${PORT}`);

  // ════════ Phase 1: 과제 검색 + 집행내역 진입 ════════
  reporter.phaseChange(1, '과제 검색 + 기관 선택');
  console.log('\n[Phase 1] 과제 검색 + 기관 선택...');

  // sgrade-batch에서 사용하는 것과 동일한 nexacro API 활용
  // 상시점검 관리 메뉴 오픈
  const menuOpened = await page.evaluate(() => {
    const app = window._application;
    if (!app || !app.gdsMenu || !app.gvTopFrame?.form?.fnFormOpen) return false;
    const row = app.gdsMenu.findRow('mnuId', 'MCAL010203');
    if (row < 0) return false;
    app.gvTopFrame.form.fnFormOpen(app.gdsMenu, row);
    return true;
  }).catch(() => false);

  if (!menuOpened) throw new Error('상시점검 관리 메뉴 오픈 실패');

  // cal00201 화면 로딩 대기
  for (let i = 0; i < 40; i++) {
    const ready = await page.evaluate(() => {
      const app = window._application;
      const frames = app?.gvWorkFrame?.frames;
      if (!frames) return false;
      for (let j = 0; j < frames.length; j++) {
        if (frames[j]?.form?.divWork?.form?.name === 'cal00201') return true;
      }
      return false;
    }).catch(() => false);
    if (ready) break;
    await sleep(250);
  }

  // 과제번호 조회
  const searchOk = await page.evaluate((taskNo) => {
    const app = window._application;
    const frames = app?.gvWorkFrame?.frames;
    if (!frames) return false;
    let form = null;
    for (let i = 0; i < frames.length; i++) {
      const candidate = frames[i]?.form?.divWork?.form;
      if (candidate?.name === 'cal00201') { form = candidate; break; }
    }
    if (!form) return false;

    const s = form.divSearch.form;
    try { s.chkOrdtmChckReprtCrtBjF.set_value('0'); } catch {}
    try { s.edtIeNm.set_value(''); s.edtIeNm.set_text(''); } catch {}
    try { s.edtTakNm.set_value(''); s.edtTakNm.set_text(''); } catch {}
    try { s.edtRseRspnber.set_value(''); s.edtRseRspnber.set_text(''); } catch {}
    try { s.edtEtpCd.set_value(''); s.edtEtpCd.set_text(''); } catch {}
    try { s.edtAccnutIeNm.set_value(''); s.edtAccnutIeNm.set_text(''); } catch {}
    try { s.cboTakSuCd.set_index(0); } catch {}
    try { s.cboTakCzCd.set_index(0); } catch {}
    try { s.cboSupl.set_index(0); } catch {}
    try { s.spinEtpStYs.set_value('2020'); } catch {}
    try { s.spinEtpEdYs.set_value('2026'); } catch {}
    s.edtNewTakN.set_value(taskNo);
    s.edtNewTakN.set_text(taskNo);
    form.divSearch_btnSearch_onclick(s.btnSearch, {});
    return true;
  }, TASK_NO).catch(() => false);

  if (!searchOk) throw new Error('과제번호 조회 실행 실패');

  // 조회 결과 대기
  for (let i = 0; i < 80; i++) {
    const count = await page.evaluate(() => {
      const app = window._application;
      const frames = app?.gvWorkFrame?.frames;
      if (!frames) return 0;
      for (let j = 0; j < frames.length; j++) {
        const form = frames[j]?.form?.divWork?.form;
        if (form?.name === 'cal00201') {
          return form.ds_calOrdtmChckList?.getRowCount() || 0;
        }
      }
      return 0;
    }).catch(() => 0);
    if (count > 0) break;
    await sleep(250);
  }

  // 기관 선택 → 집행내역(cal00202) 진입
  const entered = await page.evaluate((keyword) => {
    const app = window._application;
    const frames = app?.gvWorkFrame?.frames;
    if (!frames) return { ok: false, reason: 'no-frames' };
    let form = null;
    for (let i = 0; i < frames.length; i++) {
      const candidate = frames[i]?.form?.divWork?.form;
      if (candidate?.name === 'cal00201') { form = candidate; break; }
    }
    if (!form) return { ok: false, reason: 'not-cal00201' };

    const ds = form.ds_calOrdtmChckList;
    let row = -1;
    for (let i = 0; i < ds.getRowCount(); i++) {
      const ieNm = String(ds.getColumn(i, 'ieNm') || '');
      if (ieNm.includes(keyword)) { row = i; break; }
    }
    if (row < 0) return { ok: false, reason: `기관 "${keyword}" 미발견` };

    // 선택 과제정보 세팅
    const cols = [
      'takN', 'spcltyIeCd', 'spcltyIeNm', 'likF', 'etpYs', 'spcltyIeTakN', 'takNm',
      'takCzCd', 'takCzNm', 'ieNm', 'ftF', 'exeFtF', 'etpCd', 'etpNm', 'takSuCd',
      'takSuNm', 'rsrchrNm', 'cyrYsRscp', 'exeCnt', 'exeAt', 'exeBal', 'cyrYsSrD',
      'cyrYsEdD', 'exeTpCCd', 'exeTpCNm', 'upTakN', 'cnvMfDn', 'cnvMfSuCd', 'cnvMfSuCdNm',
      'calTakRegYn', 'mtyrCnvCCd', 'mtyrCnvCNm', 'ordtmChckPgsSuCd', 'ordtmChckPgsSuNm',
      'newTakN', 'cnvStg', 'cnvAnul'
    ];
    for (const c of cols) {
      try { app.gdsSelTask.setColumn(0, c, ds.getColumn(row, c)); } catch {}
    }

    form.globalRowCal00201 = row;
    form.viewMove();
    return { ok: true, row, ieNm: ds.getColumn(row, 'ieNm'), takNm: ds.getColumn(row, 'takNm') };
  }, INST_NAME).catch(e => ({ ok: false, reason: e.message }));

  if (!entered.ok) throw new Error(`집행내역 진입 실패: ${entered.reason}`);

  console.log(`  과제: ${entered.takNm || TASK_NO}`);
  console.log(`  기관: ${entered.ieNm || INST_NAME}`);

  // cal00202 화면 전환 대기
  for (let i = 0; i < 60; i++) {
    const ready = await page.evaluate(() => {
      const app = window._application;
      const frames = app?.gvWorkFrame?.frames;
      if (!frames) return false;
      for (let j = 0; j < frames.length; j++) {
        if (frames[j]?.form?.divWork?.form?.name === 'cal00202') return true;
      }
      return false;
    }).catch(() => false);
    if (ready) break;
    await sleep(250);
  }

  // 데이터셋 로딩 대기
  for (let i = 0; i < 80; i++) {
    const count = await getTotalRowCount(page);
    if (count > 0) break;
    await sleep(250);
  }

  const totalCount = await getTotalRowCount(page);
  console.log(`  총 ${totalCount}건\n`);
  reporter.progress(0, totalCount, '집행내역 로딩 완료');

  // ════════ Phase 2: 건별 루프 ════════
  reporter.phaseChange(2, '건별 처리');
  console.log('[Phase 2] 건별 처리 시작...');
  let processed = 0, skipped = 0, reviewed = 0;

  for (let rowIdx = START_ROW - 1; rowIdx < totalCount; rowIdx++) {
    const itemT0 = Date.now();
    const rowNum = rowIdx + 1;

    // 세션 연장
    await ezNav.startKeepAliveEzbaro(page, 4 * 60 * 1000);

    // ── 2a: 현재 건 데이터 읽기 ──
    const detail = await readCurrentDetailEzbaro(page, rowIdx);
    if (!detail) {
      console.log(`  [R${rowNum}/${totalCount}] 데이터 읽기 실패 — 스킵`);
      skipped++;
      continue;
    }

    const rec = {
      rowNum,
      seq: detail.seq,
      executionDate: detail.executionDate || '',
      purpose: detail.purpose || '',
      budgetCategory: detail.budgetCategory || '',
      subCategory: detail.subCategory || '',
      itemName: detail.itemName || '',
      vendorName: detail.vendorName || '',
      totalAmount: detail.totalAmount || 0,
      evidenceType: detail.evidenceType || '',
      reviewStatus: detail.status || '',
      progressStatus: detail.progressStatus || '',
      files: [],
    };

    console.log(`  [R${rowNum}/${totalCount}] ${rec.itemName || rec.purpose || '-'} | ${rec.vendorName || '-'} | ${rec.totalAmount}원`);
    reporter.progress(rowNum, totalCount, `${rec.itemName || rec.purpose || '-'}`);

    // ── 2b: 0원 건 처리 ──
    if (rec.totalAmount === 0) {
      console.log(`    0원 건 — 스킵`);
      rec.analysis = { flags: [{ id: 'SKIP_0원', description: '0원 (취소전표)' }] };
      const existIdx = records.findIndex(r => r.rowNum === rowNum);
      if (existIdx >= 0) records[existIdx] = rec;
      else records.push(rec);
      const skipResult = { rowNum, status: 'SKIP', comment: '0원 (취소전표)', disallowedAmount: 0 };
      const resIdx = results.findIndex(r => r.rowNum === rowNum);
      if (resIdx >= 0) results[resIdx] = skipResult;
      else results.push(skipResult);
      processed++;
      continue;
    }

    // ── 2c: 심층분석 (단건) ──
    const enriched = deepAnalyze([rec], projectConfig);
    const enrichedRec = enriched[0];
    const flagCount = enrichedRec.analysis ? enrichedRec.analysis.flags.length : 0;
    if (flagCount > 0) {
      console.log(`    분석: ${flagCount}개 플래그 — ${enrichedRec.analysis.flags.map(f => f.id || f).join(', ')}`);
    }

    // records 배열에 추가/갱신
    const existIdx = records.findIndex(r => r.rowNum === rowNum);
    if (existIdx >= 0) records[existIdx] = enrichedRec;
    else records.push(enrichedRec);

    // ── 2d: 판정 ──
    let resultItem = null;
    if (!SKIP_JUDGE) {
      const flags = (enrichedRec.analysis && enrichedRec.analysis.flags) || [];
      const flagIds = flags.map(f => f.id || f);

      if (flagIds.some(id => id.includes('SKIP_0원') || id.includes('zero_amount'))) {
        resultItem = { rowNum, status: 'SKIP', comment: '0원 (취소전표)', disallowedAmount: 0 };
      } else {
        const activeFlags = flags.filter(f => {
          const id = f.id || f;
          return !id.includes('정보성');
        });
        if (activeFlags.length > 0) {
          const flagDescs = activeFlags.map(f => f.description || f.id || f).join('; ');
          resultItem = { rowNum, status: '확인', comment: flagDescs.substring(0, 200), disallowedAmount: 0 };
        } else {
          resultItem = { rowNum, status: '적정', comment: '적정', disallowedAmount: 0 };
        }
      }
      console.log(`    판정: ${resultItem.status} ${resultItem.comment !== '적정' ? '— ' + resultItem.comment.substring(0, 50) : ''}`);
      reporter.itemComplete(
        `R${rowNum} ${rec.itemName || ''}`,
        resultItem.status,
        Date.now() - itemT0
      );
    }

    // results 배열에 추가/갱신
    if (resultItem) {
      const resIdx = results.findIndex(r => r.rowNum === rowNum);
      if (resIdx >= 0) results[resIdx] = resultItem;
      else results.push(resultItem);
    }

    processed++;

    // ── 2e: 점진적 저장 (매 10건) ──
    if (processed % 10 === 0) {
      saveIncremental(records, results);
      console.log(`    [저장] ${processed}건 처리 (data: ${records.length}건, results: ${results.length}건)`);
    }

    const itemElapsed = ((Date.now() - itemT0) / 1000).toFixed(1);
    console.log(`    ${itemElapsed}s`);
  }

  ezNav.stopKeepAliveEzbaro();

  // ════════ 최종 저장 ════════
  saveIncremental(records, results);

  // 심층분석 요약 출력
  if (records.length > 0 && records[0].analysis) {
    console.log('\n[심층분석 요약]');
    printDeepSummary(records);
  }

  // ════════ 최종 요약 ════════
  const ok = results.filter(r => r.status === '적정').length;
  const ng = results.filter(r => r.status === '확인' || r.status === '보완요청').length;
  const elapsed = ((Date.now() - t0) / 60000).toFixed(1);
  console.log('\n╔══════════════════════════════════════════════════╗');
  console.log(`║  ${INST_NAME} (이지바로) 완료`);
  console.log(`║  처리: ${processed}건, 스킵: ${skipped}건`);
  console.log(`║  적정: ${ok} / 확인: ${ng}`);
  console.log(`║  소요시간: ${elapsed}분`);
  console.log(`║  data: ${DATA_FILE}`);
  console.log(`║  results: ${RESULTS_FILE}`);
  console.log('╚══════════════════════════════════════════════════╝');

  reporter.done({
    system: 'ezbaro',
    institution: INST_NAME,
    processed,
    skipped,
    ok,
    ng,
    elapsed: `${elapsed}분`,
  });
}

module.exports = { main };

if (require.main === module) {
  main().catch(err => {
    console.error('\n!! 파이프라인 오류 !!');
    console.error(err);
    process.exitCode = 1;
  }).finally(() => {
    ezNav.stopKeepAliveEzbaro();
  });
}
