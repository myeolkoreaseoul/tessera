/**
 * 이지바로 S등급 전용: 집행내역 "미확정" 일괄 정상처리
 *
 * 동작 순서
 * 1) 정산 > 상시점검 > 상시점검 관리(MCAL010203) 진입
 * 2) 상시점검 보고서 생성대상 여부 해제 + 과제번호 조회
 * 3) 연구수행기관 행 선택 후 집행내역(cal00202) 진입
 * 4) 진행상태=미확정 행만 체크(gridcmmcheck=1)
 * 5) 드랍박스(전체)에서 정상(0001) 선택
 * 6) 일괄선택적용 -> 저장
 *
 * 주의: S등급 기관에서만 사용
 *
 * 사용 예:
 *   node lib/sgrade-batch-normal-ezbaro.js \
 *     --task=RS-2025-02304283 \
 *     --org='한국과학기술연구원' \
 *     --grade=S \
 *     --apply \
 *     --host=100.87.3.123 \
 *     --port=9446
 */
const { connectBrowser, sleep } = require('../../utils');

function getArg(name, dflt = '') {
  const p = `--${name}=`;
  const found = process.argv.find(a => a.startsWith(p));
  return found ? found.slice(p.length) : dflt;
}

function hasFlag(name) {
  return process.argv.includes(`--${name}`);
}

async function withPage(host, port) {
  process.env.CDP_HOST = host;
  const { browser, context } = await connectBrowser(Number(port));
  const page = context.pages().find(p => /ezbaro|rims/i.test(p.url())) || context.pages()[0];
  if (!page) throw new Error('이지바로 페이지를 찾지 못했습니다.');
  page.on('dialog', async d => { try { await d.accept(); } catch {} });
  return { browser, page };
}

async function dismissAlerts(page, rounds = 3) {
  for (let i = 0; i < rounds; i++) {
    await page.evaluate(() => {
      const vis = el => {
        const r = el.getBoundingClientRect();
        const s = getComputedStyle(el);
        return r.width > 0 && r.height > 0 && s.display !== 'none' && s.visibility !== 'hidden';
      };

      // DOM 기반 확인 버튼 클릭
      for (const n of [...document.querySelectorAll('button, div, span, a')].filter(vis)) {
        const t = (n.innerText || '').trim();
        if (t === '확인' || t === 'OK') n.click();
      }

      // nexacro popup frame 확인 버튼 클릭
      try {
        const pops = nexacro.getPopupFrames ? nexacro.getPopupFrames() : [];
        for (let j = pops.length - 1; j >= 0; j--) {
          const p = pops[j];
          try { p.form?.btn00?.click?.(); } catch {}
          try { p.form?.btnOk?.click?.(); } catch {}
        }
      } catch {}
    }).catch(() => {});
    await sleep(300);
  }
}

async function openMenuCal010203(page) {
  const pre = await page.evaluate(() => {
    const app = window._application;
    const frames = app?.gvWorkFrame?.frames;
    if (!frames) return { hasCal00201: false, hasCal00202: false };
    let hasCal00201 = false;
    let hasCal00202 = false;
    for (let i = 0; i < frames.length; i++) {
      const name = frames[i]?.form?.divWork?.form?.name;
      if (name === 'cal00201') hasCal00201 = true;
      if (name === 'cal00202') hasCal00202 = true;
    }
    return { hasCal00201, hasCal00202 };
  }).catch(() => ({ hasCal00201: false, hasCal00202: false }));

  if (pre.hasCal00201) return;

  if (pre.hasCal00202) {
    await page.evaluate(() => {
      const app = window._application;
      const frames = app?.gvWorkFrame?.frames;
      if (!frames) return false;
      for (let i = 0; i < frames.length; i++) {
        const form = frames[i]?.form?.divWork?.form;
        if (form?.name === 'cal00202') {
          form.btnList_onclick(form.btnList, {});
          return true;
        }
      }
      return false;
    }).catch(() => false);
  }

  const ok = await page.evaluate(() => {
    const app = window._application;
    if (!app || !app.gdsMenu || !app.gvTopFrame?.form?.fnFormOpen) return false;
    const row = app.gdsMenu.findRow('mnuId', 'MCAL010203');
    if (row < 0) return false;
    app.gvTopFrame.form.fnFormOpen(app.gdsMenu, row);
    return true;
  }).catch(() => false);

  if (!ok) throw new Error('상시점검 관리 메뉴 오픈 실패');

  for (let i = 0; i < 40; i++) {
    const ready = await page.evaluate(() => {
      const app = window._application;
      const frames = app?.gvWorkFrame?.frames;
      if (!frames) return false;
      let form = null;
      for (let j = 0; j < frames.length; j++) {
        const candidate = frames[j]?.form?.divWork?.form;
        if (!candidate) continue;
        if (candidate.name === 'cal00201') {
          form = candidate;
          break;
        }
      }
      return !!form && form.name === 'cal00201';
    }).catch(() => false);
    if (ready) return;
    await sleep(250);
  }
  throw new Error('상시점검 관리 화면 로딩 대기 시간 초과');
}

async function searchTaskInCal00201(page, taskNo) {
  const ok = await page.evaluate((task) => {
    const app = window._application;
    const frames = app?.gvWorkFrame?.frames;
    if (!frames) return false;
    let form = null;
    for (let i = 0; i < frames.length; i++) {
      const candidate = frames[i]?.form?.divWork?.form;
      if (!candidate) continue;
      if (candidate.name === 'cal00201') {
        form = candidate;
        break;
      }
    }
    if (!form || form.name !== 'cal00201') return false;

    const s = form.divSearch.form;
    // "상시점검 보고서 생성대상 여부" 체크 해제
    try {
      s.chkOrdtmChckReprtCrtBjF.set_value('0');
    } catch {
      s.chkOrdtmChckReprtCrtBjF.value = '0';
    }

    // 이전 검색조건 초기화 (잔여 필터로 인한 0건 방지)
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

    // 과제번호 입력
    s.edtNewTakN.set_value(task);
    s.edtNewTakN.set_text(task);

    // 조회
    form.divSearch_btnSearch_onclick(s.btnSearch, {});
    return true;
  }, taskNo).catch(() => false);

  if (!ok) throw new Error('과제번호 조회 실행 실패');

  for (let i = 0; i < 80; i++) {
    const info = await page.evaluate(() => {
      const app = window._application;
      const frames = app?.gvWorkFrame?.frames;
      if (!frames) return { rowCount: 0 };
      let form = null;
      for (let i = 0; i < frames.length; i++) {
        const candidate = frames[i]?.form?.divWork?.form;
        if (!candidate) continue;
        if (candidate.name === 'cal00201') {
          form = candidate;
          break;
        }
      }
      if (!form || form.name !== 'cal00201') return { rowCount: 0 };
      return { rowCount: form.ds_calOrdtmChckList.getRowCount() };
    }).catch(() => ({ rowCount: 0 }));
    if (info.rowCount > 0) return info.rowCount;
    await sleep(250);
  }
  throw new Error('상시점검 관리 조회 결과가 없습니다.');
}

async function enterExecutionDetailByOrg(page, orgKeyword) {
  const ret = await page.evaluate((keyword) => {
    const app = window._application;
    const frames = app?.gvWorkFrame?.frames;
    if (!frames) return { ok: false, reason: 'no-work-frames' };
    let form = null;
    for (let i = 0; i < frames.length; i++) {
      const candidate = frames[i]?.form?.divWork?.form;
      if (!candidate) continue;
      if (candidate.name === 'cal00201') {
        form = candidate;
        break;
      }
    }
    if (!form || form.name !== 'cal00201') return { ok: false, reason: 'not-cal00201' };

    const ds = form.ds_calOrdtmChckList;
    let row = -1;
    for (let i = 0; i < ds.getRowCount(); i++) {
      const ieNm = String(ds.getColumn(i, 'ieNm') || '');
      if (ieNm.includes(keyword)) {
        row = i;
        break;
      }
    }
    if (row < 0) return { ok: false, reason: 'org-not-found' };

    // 상세 이동에 필요한 선택 과제정보 세팅
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
    form.viewMove(); // cal00202로 이동

    return {
      ok: true,
      row,
      task: app.gdsSelTask.getColumn(0, 'newTakN'),
      ieNm: app.gdsSelTask.getColumn(0, 'ieNm'),
    };
  }, orgKeyword).catch(e => ({ ok: false, reason: e.message }));

  if (!ret.ok) throw new Error(`집행내역 진입 실패: ${ret.reason}`);

  for (let i = 0; i < 60; i++) {
    const ok = await page.evaluate(() => {
      const app = window._application;
      const frames = app?.gvWorkFrame?.frames;
      if (!frames) return false;
      for (let i = 0; i < frames.length; i++) {
        const candidate = frames[i]?.form?.divWork?.form;
        if (candidate?.name === 'cal00202') return true;
      }
      return false;
    }).catch(() => false);
    if (ok) return ret;
    await sleep(250);
  }
  throw new Error('집행내역(cal00202) 화면 전환 대기 시간 초과');
}

async function markUnconfirmedOnlyAndApplyNormal(page, doApply) {
  for (let i = 0; i < 80; i++) {
    const ready = await page.evaluate(() => {
      const app = window._application;
      const frames = app?.gvWorkFrame?.frames;
      if (!frames) return false;
      for (let j = 0; j < frames.length; j++) {
        const form = frames[j]?.form?.divWork?.form;
        if (form?.name !== 'cal00202') continue;
        const ds = form.ds_calOrdtmChckExeList;
        if (ds && ds.getRowCount() > 0) return true;
      }
      return false;
    }).catch(() => false);
    if (ready) break;
    await sleep(250);
  }

  const summaryBefore = await page.evaluate(() => {
    const app = window._application;
    const frames = app?.gvWorkFrame?.frames;
    if (!frames) return { rowCount: 0, unconfirmed: 0, checked: 0 };
    let form = null;
    for (let i = 0; i < frames.length; i++) {
      const candidate = frames[i]?.form?.divWork?.form;
      if (candidate?.name === 'cal00202') {
        form = candidate;
        break;
      }
    }
    if (!form) return { rowCount: 0, unconfirmed: 0, checked: 0 };
    const ds = form.ds_calOrdtmChckExeList;
    let unconfirmed = 0;
    let checked = 0;
    for (let i = 0; i < ds.getRowCount(); i++) {
      const st = String(ds.getColumn(i, 'ordtmChckSuNm') || '');
      const chk = String(ds.getColumn(i, 'gridcmmcheck') || '0');
      if (st === '미확정') unconfirmed += 1;
      if (chk === '1') checked += 1;
    }
    return { rowCount: ds.getRowCount(), unconfirmed, checked };
  });

  if (!doApply) return { ...summaryBefore, dryRun: true };

  const applied = await page.evaluate(() => {
    const app = window._application;
    const frames = app?.gvWorkFrame?.frames;
    if (!frames) return { ok: false, reason: 'no-work-frames' };
    let form = null;
    for (let i = 0; i < frames.length; i++) {
      const candidate = frames[i]?.form?.divWork?.form;
      if (candidate?.name === 'cal00202') {
        form = candidate;
        break;
      }
    }
    if (!form) return { ok: false, reason: 'not-cal00202' };
    const ds = form.ds_calOrdtmChckExeList;

    let unconfirmed = 0;
    for (let i = 0; i < ds.getRowCount(); i++) {
      const st = String(ds.getColumn(i, 'ordtmChckSuNm') || '');
      const shouldCheck = st === '미확정';
      ds.setColumn(i, 'gridcmmcheck', shouldCheck ? '1' : '0');
      if (shouldCheck) unconfirmed += 1;
    }
    if (unconfirmed < 1) return { ok: true, selected: 0, skipped: '미확정 행 없음' };

    // 드랍박스(전체) -> 정상(0001)
    form.cbo01.set_value('0001');
    form.cbo01.set_text('정상');

    // 일괄선택적용
    form.btnChckNotPass_onclick(form.btnChckNotPass, {});
    // 저장 + 확인
    form.BtnSave_onclick(form.BtnSave, {});
    form.fnConfirmCallback('saveCallback', true);

    return { ok: true, selected: unconfirmed };
  }).catch(e => ({ ok: false, reason: e.message }));

  if (!applied.ok) throw new Error(`일괄 정상처리 실패: ${applied.reason}`);

  await sleep(2000);
  await dismissAlerts(page, 4);

  const summaryAfter = await page.evaluate(() => {
    const app = window._application;
    const frames = app?.gvWorkFrame?.frames;
    if (!frames) return { rowCount: 0, unconfirmed: 0, normal: 0, eachCntText: '', totalText: '' };
    let form = null;
    for (let i = 0; i < frames.length; i++) {
      const candidate = frames[i]?.form?.divWork?.form;
      if (candidate?.name === 'cal00202') {
        form = candidate;
        break;
      }
    }
    if (!form) return { rowCount: 0, unconfirmed: 0, normal: 0, eachCntText: '', totalText: '' };
    const ds = form.ds_calOrdtmChckExeList;
    let unconfirmed = 0;
    let normal = 0;
    for (let i = 0; i < ds.getRowCount(); i++) {
      const st = String(ds.getColumn(i, 'ordtmChckSuNm') || '');
      if (st === '미확정') unconfirmed += 1;
      if (st === '정상') normal += 1;
    }
    return {
      rowCount: ds.getRowCount(),
      unconfirmed,
      normal,
      eachCntText: form.eachCnt?.text || '',
      totalText: form.totCnt?.text || '',
    };
  });

  return { ...summaryBefore, ...summaryAfter, applied: true };
}

async function confirmAllReviewedRows(page, doApply) {
  // 진행상태(검토중) 필터 조회
  const filtered = await page.evaluate(() => {
    const app = window._application;
    const frames = app?.gvWorkFrame?.frames;
    if (!frames) return { ok: false, reason: 'no-work-frames' };
    let form = null;
    for (let i = 0; i < frames.length; i++) {
      const candidate = frames[i]?.form?.divWork?.form;
      if (candidate?.name === 'cal00202') {
        form = candidate;
        break;
      }
    }
    if (!form) return { ok: false, reason: 'not-cal00202' };

    // 진행상태: 검토중(0001)
    form.divSearch.form.cboSupl.set_value('0001');
    form.divSearch.form.cboSupl.set_text('검토중');
    form.divSearch_btnSearch_onclick(form.divSearch.form.btnSearch, {});
    return { ok: true };
  }).catch(e => ({ ok: false, reason: e.message }));

  if (!filtered.ok) throw new Error(`검토중 조회 실패: ${filtered.reason}`);

  for (let i = 0; i < 80; i++) {
    const ready = await page.evaluate(() => {
      const app = window._application;
      const frames = app?.gvWorkFrame?.frames;
      if (!frames) return false;
      for (let j = 0; j < frames.length; j++) {
        const form = frames[j]?.form?.divWork?.form;
        if (form?.name !== 'cal00202') continue;
        const ds = form.ds_calOrdtmChckExeList;
        if (!ds) continue;
        // 조회 결과가 0이어도 ready 로 처리 (이미 검토중 없음)
        return true;
      }
      return false;
    }).catch(() => false);
    if (ready) break;
    await sleep(250);
  }

  const before = await page.evaluate(() => {
    const app = window._application;
    const frames = app?.gvWorkFrame?.frames;
    if (!frames) return { rowCount: 0, reviewing: 0 };
    let form = null;
    for (let i = 0; i < frames.length; i++) {
      const candidate = frames[i]?.form?.divWork?.form;
      if (candidate?.name === 'cal00202') {
        form = candidate;
        break;
      }
    }
    if (!form) return { rowCount: 0, reviewing: 0 };
    const ds = form.ds_calOrdtmChckExeList;
    let reviewing = 0;
    for (let i = 0; i < ds.getRowCount(); i++) {
      const cpl = String(ds.getColumn(i, 'ordtmChckCplSuCd') || '');
      if (cpl === '0001') reviewing += 1;
    }
    return {
      rowCount: ds.getRowCount(),
      reviewing,
      reviewingTotalCount: Number(form.dsPagingInfo?.getColumn?.(0, 'totalCount') || 0),
      eachCntText: form.eachCnt?.text || '',
      totalText: form.totCnt?.text || '',
    };
  });

  if (!doApply) return { ...before, dryRun: true };
  if (before.rowCount < 1) return { ...before, applied: true };

  const applied = await page.evaluate(() => {
    const app = window._application;
    const frames = app?.gvWorkFrame?.frames;
    if (!frames) return { ok: false, reason: 'no-work-frames' };
    let form = null;
    for (let i = 0; i < frames.length; i++) {
      const candidate = frames[i]?.form?.divWork?.form;
      if (candidate?.name === 'cal00202') {
        form = candidate;
        break;
      }
    }
    if (!form) return { ok: false, reason: 'not-cal00202' };

    const ds = form.ds_calOrdtmChckExeList;
    let selected = 0;
    for (let i = 0; i < ds.getRowCount(); i++) {
      ds.setColumn(i, 'gridcmmcheck', '1');
      selected += 1;
    }
    if (selected < 1) return { ok: true, selected: 0 };

    // 확인완료 + 확인팝업 승인
    form.BtnConfirm_onclick(form.BtnConfirm, {});
    form.fnConfirmCallback('confirmSaveCallback', true);
    return { ok: true, selected };
  }).catch(e => ({ ok: false, reason: e.message }));

  if (!applied.ok) throw new Error(`확인완료 처리 실패: ${applied.reason}`);

  await sleep(2000);
  await dismissAlerts(page, 4);

  const after = await page.evaluate(() => {
    const app = window._application;
    const frames = app?.gvWorkFrame?.frames;
    if (!frames) return { rowCount: 0, reviewing: 0, done: 0 };
    let form = null;
    for (let i = 0; i < frames.length; i++) {
      const candidate = frames[i]?.form?.divWork?.form;
      if (candidate?.name === 'cal00202') {
        form = candidate;
        break;
      }
    }
    if (!form) return { rowCount: 0, reviewing: 0, done: 0 };
    const ds = form.ds_calOrdtmChckExeList;
    let reviewing = 0;
    let done = 0;
    for (let i = 0; i < ds.getRowCount(); i++) {
      const cpl = String(ds.getColumn(i, 'ordtmChckCplSuCd') || '');
      if (cpl === '0001') reviewing += 1; // 검토중
      if (cpl === '0005') done += 1; // 점검완료(확인완료 처리 상태)
    }
    return {
      rowCount: ds.getRowCount(),
      reviewing,
      done,
      reviewingTotalCount: Number(form.dsPagingInfo?.getColumn?.(0, 'totalCount') || 0),
      eachCntText: form.eachCnt?.text || '',
      totalText: form.totCnt?.text || '',
    };
  });

  return { ...before, ...after, applied: true };
}

async function main() {
  const host = getArg('host', process.env.CDP_HOST || '100.87.3.123');
  const port = Number(getArg('port', process.env.CDP_PORT || '9446'));
  const task = getArg('task', '');
  const org = getArg('org', '');
  const grade = String(getArg('grade', '')).trim().toUpperCase();
  const doApply = hasFlag('apply');

  if (!task || !org) {
    console.log('사용법: node lib/sgrade-batch-normal-ezbaro.js --task=RS-... --org=\"한국과학기술연구원\" --grade=S [--apply] [--host=100.87.3.123] [--port=9446]');
    process.exit(1);
  }
  if (grade !== 'S') {
    console.error(`중단: S등급 전용 스크립트입니다. 입력 grade=${grade || '(empty)'}`);
    process.exit(2);
  }

  const { browser, page } = await withPage(host, port);
  try {
    await openMenuCal010203(page);
    const rowCount = await searchTaskInCal00201(page, task);
    const entered = await enterExecutionDetailByOrg(page, org);
    const summary = await markUnconfirmedOnlyAndApplyNormal(page, doApply);
    const confirmSummary = await confirmAllReviewedRows(page, doApply);

    console.log(JSON.stringify({
      mode: doApply ? 'APPLY' : 'DRY_RUN',
      task,
      orgKeyword: org,
      grade,
      searchRowCount: rowCount,
      entered,
      summary,
      confirmSummary,
    }, null, 2));
  } finally {
    await browser.close().catch(() => {});
  }
}

main().catch(err => {
  console.error('ERROR:', err.message);
  process.exit(1);
});
