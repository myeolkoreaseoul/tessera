const fs = require('fs');
const XLSX = require('xlsx');
const { connectBrowser, sleep } = require('./lib/utils');

const EXCEL = process.env.EXCEL_PATH || '/home/john/company-pc/cdrive/Users/정동회계법인/Documents/이지바로_과제리스트_이정승_20260218_v2.xlsx';
const SHEET = process.env.EXCEL_SHEET || '상시';
const ts = () => new Date().toISOString();
const N = (v) => Number(String(v || '').replace(/[^0-9-]/g, '')) || 0;

function cleanIeName(v) {
  return String(v || '').replace(/\([^)]*\)/g, '').replace(/\s+/g, ' ').trim();
}

async function dismiss(page, rounds = 8) {
  for (let r = 0; r < rounds; r++) {
    await page.evaluate(() => {
      const vis = (el) => {
        const b = el.getBoundingClientRect();
        const s = getComputedStyle(el);
        return b.width > 0 && b.height > 0 && s.display !== 'none' && s.visibility !== 'hidden';
      };
      for (const el of [...document.querySelectorAll('*')]) {
        if (el.childElementCount !== 0 || !vis(el)) continue;
        const t = (el.innerText || '').trim();
        if (t === '확인' || t === 'OK' || t === '닫기') el.click();
      }
      try {
        const pf = nexacro.getPopupFrames ? nexacro.getPopupFrames() : null;
        const len = pf?.length || 0;
        for (let i = len - 1; i >= 0; i--) {
          const p = pf[i];
          try { p.form?.btn00?.click?.(); } catch {}
          try { p.form?.btnOk?.click?.(); } catch {}
          try { p.form?.btnClose?.click?.(); } catch {}
        }
      } catch {}
    }).catch(() => {});
    await sleep(180);
  }
}

async function gotoList(page) {
  await page.evaluate(() => {
    const app = window._application;
    const fr = app?.gvWorkFrame?.frames;
    const len = fr?.length || 0;
    for (let i = 0; i < len; i++) {
      const f = fr[i]?.form?.divWork?.form;
      if (f?.name === 'cal00202') {
        try { f.btnList_onclick(f.btnList, {}); } catch { try { f.btnList.click(); } catch {} }
      }
    }
  }).catch(() => {});
  await sleep(1000);
  await dismiss(page, 6);
}

async function searchAndOpen(page, target) {
  await gotoList(page);
  let open = { ok: false, reason: 'search0' };
  for (let attempt = 0; attempt < 6; attempt++) {
    open = await page.evaluate(async ({ taskNo, ieNmCore }) => {
      const wait = (ms) => new Promise((r) => setTimeout(r, ms));
      const app = window._application;
      const fr = app?.gvWorkFrame?.frames;
      const len = fr?.length || 0;
      let f = null;
      for (let i = 0; i < len; i++) {
        const x = fr[i]?.form?.divWork?.form;
        if (x?.name === 'cal00201') { f = x; break; }
      }
      if (!f) return { ok: false, reason: 'no cal00201' };
      const s = f.divSearch?.form;
      try { s.cboTakSuCd.set_index(0); } catch {}
      try { s.cboTakCzCd.set_index(0); } catch {}
      try { s.cboCal.set_index(0); } catch {}
      try { s.cboSupl.set_index(0); } catch {}
      try { s.cboOrdtmChckF.set_index(0); } catch {}
      try { s.edtEtpCd.set_value(''); } catch {}
      try { s.edtIeNm.set_value(''); } catch {}
      try { s.edtTakNm.set_value(''); } catch {}
      try { s.edtRseRspnber.set_value(''); } catch {}
      try { s.edtAccnutIeNm.set_value(''); } catch {}
      try { s.edtNewTakN.set_value(taskNo); } catch {}
      try { s.chkOrdtmChckReprtCrtBjF.set_value('0'); } catch {}
      try { f.divSearch_btnSearch_onclick(s.btnSearch, {}); } catch { try { s.btnSearch.click(); } catch {} }

      let ds = f.ds_calOrdtmChckList;
      let rc = ds?.getRowCount?.() || 0;
      for (let t = 0; t < 20 && rc < 1; t++) {
        await wait(500);
        ds = f.ds_calOrdtmChckList;
        rc = ds?.getRowCount?.() || 0;
      }
      if (rc < 1) return { ok: false, reason: 'search0' };

      let idx = -1;
      for (let i = 0; i < rc; i++) {
        const t = String(ds.getColumn(i, 'newTakN') || '');
        const ie = String(ds.getColumn(i, 'ieNm') || '').replace(/\([^)]*\)/g, '').replace(/\s+/g, ' ').trim();
        if (t === taskNo && ie.includes(ieNmCore)) { idx = i; break; }
      }
      if (idx < 0) return { ok: false, reason: 'target row not found', rc };
      try { ds.set_rowposition(idx); } catch {}
      try { f.calOrdtmChckGrid_oncelldblclick(f.calOrdtmChckGrid, { row: idx, col: 0 }); } catch {}
      try { f.gfnExeDecsnListDtail(); } catch {}
      return { ok: true, idx, rc };
    }, target).catch(() => ({ ok: false, reason: 'eval fail' }));

    if (open.ok) break;
    await sleep(600);
  }

  if (!open.ok) return open;

  for (let i = 0; i < 12; i++) {
    const has = await page.evaluate(() => {
      const app = window._application;
      const fr = app?.gvWorkFrame?.frames;
      const len = fr?.length || 0;
      for (let i = 0; i < len; i++) if ((fr[i]?.form?.divWork?.form?.name || '') === 'cal00202') return true;
      return false;
    }).catch(() => false);
    if (has) return { ok: true };
    await dismiss(page, 3);
    await sleep(500);
  }
  return { ok: false, reason: 'no cal00202' };
}

async function readSummary(page) {
  return page.evaluate(() => {
    const app = window._application;
    const fr = app?.gvWorkFrame?.frames;
    const len = fr?.length || 0;
    let f2 = null;
    for (let i = 0; i < len; i++) {
      const f = fr[i]?.form?.divWork?.form;
      if (f?.name === 'cal00202') { f2 = f; break; }
    }
    if (!f2) return { ok: false, reason: 'no cal00202' };
    const ds = f2.ds_calOrdtmChckExeList;
    const rc = ds?.getRowCount?.() || 0;
    let un = 0, n = 0, w = 0, rv = 0, dn = 0;
    const rows = [];
    for (let i = 0; i < rc; i++) {
      const st = String(ds.getColumn(i, 'ordtmChckSuNm') || '');
      const c = String(ds.getColumn(i, 'ordtmChckCplSuNm') || '');
      if (st === '미확정') {
        rows.push({
          idx: i,
          rn: String(ds.getColumn(i, 'rn') || ''),
          decsnSn: String(ds.getColumn(i, 'decsnSn') || ''),
          title: String(ds.getColumn(i, 'decsnTilTt') || ''),
          titNm: String(ds.getColumn(i, 'titNm') || ''),
          sePpoNm: String(ds.getColumn(i, 'sePpoNm') || ''),
          exeMt: String(ds.getColumn(i, 'exeMtCCd') || ''),
          fileCount: String(ds.getColumn(i, 'fileCount') || ''),
          splAt: String(ds.getColumn(i, 'splAt') || ''),
          exeSplAt: String(ds.getColumn(i, 'exeSplAt') || ''),
        });
      }
      if (st === '미확정') un++;
      if (st === '정상') n++;
      if (st === '미흡') w++;
      if (c === '검토중') rv++;
      if (c === '점검완료') dn++;
    }
    return {
      ok: true,
      taskNo: String(app?.gdsSelTask?.getColumn?.(0, 'newTakN') || ''),
      ieNm: String(app?.gdsSelTask?.getColumn?.(0, 'ieNm') || ''),
      sum: { total: rc, unconfirmed: un, normal: n, weak: w, reviewing: rv, done: dn },
      rows,
    };
  }).catch(() => ({ ok: false, reason: 'eval fail' }));
}

async function collectFiles(page, idx) {
  await page.evaluate((rowIdx) => {
    const app = window._application;
    const fr = app?.gvWorkFrame?.frames;
    const len = fr?.length || 0;
    let f2 = null;
    for (let i = 0; i < len; i++) {
      const f = fr[i]?.form?.divWork?.form;
      if (f?.name === 'cal00202') { f2 = f; break; }
    }
    if (!f2) return;
    try { f2.calOrdtmChckExeGrid_oncellclick(f2.calOrdtmChckExeGrid, { row: rowIdx, col: 14 }); } catch {}
  }, idx).catch(() => {});
  await sleep(550);

  const names = await page.evaluate(() => {
    const vis = (el) => {
      const b = el.getBoundingClientRect();
      const s = getComputedStyle(el);
      return b.width > 0 && b.height > 0 && s.display !== 'none' && s.visibility !== 'hidden';
    };
    const arr = [...document.querySelectorAll('*')]
      .filter((el) => el.childElementCount === 0 && vis(el))
      .map((el) => (el.innerText || '').trim())
      .filter((t) => /\.(pdf|hwp|hwpx|doc|docx|xls|xlsx|jpg|png|zip)$/i.test(t));
    return [...new Set(arr)];
  }).catch(() => []);

  await page.evaluate(() => {
    const vis = (el) => {
      const b = el.getBoundingClientRect();
      const s = getComputedStyle(el);
      return b.width > 0 && b.height > 0 && s.display !== 'none' && s.visibility !== 'hidden';
    };
    const btn = [...document.querySelectorAll('*')].find((el) => el.childElementCount === 0 && vis(el) && /^닫기$/.test((el.innerText || '').trim()));
    if (btn) btn.click();
  }).catch(() => {});
  await sleep(220);

  return names;
}

async function applyStatus(page, decsns, label) {
  if (decsns.length < 1) return { ok: true, selected: 0, label };
  const res = await page.evaluate(({ decsns, label }) => {
    const app = window._application;
    const fr = app?.gvWorkFrame?.frames;
    const len = fr?.length || 0;
    let f2 = null;
    for (let i = 0; i < len; i++) {
      const f = fr[i]?.form?.divWork?.form;
      if (f?.name === 'cal00202') { f2 = f; break; }
    }
    if (!f2) return { ok: false, reason: 'no cal00202' };
    const ds = f2.ds_calOrdtmChckExeList;
    const rc = ds?.getRowCount?.() || 0;
    let selected = 0;
    for (let i = 0; i < rc; i++) {
      const d = String(ds.getColumn(i, 'decsnSn') || '');
      const hit = decsns.includes(d);
      ds.setColumn(i, 'gridcmmcheck', hit ? '1' : '0');
      if (hit) selected++;
    }
    if (selected > 0) {
      f2.cbo01.set_text(label);
      f2.btnChckNotPass_onclick(f2.btnChckNotPass, {});
      f2.BtnSave_onclick(f2.BtnSave, {});
      try { f2.fnConfirmCallback('saveCallback', true); } catch {}
    }
    return { ok: true, selected, label };
  }, { decsns, label }).catch(() => ({ ok: false, selected: 0, label }));
  await sleep(850);
  await dismiss(page, 10);
  return res;
}

async function confirmDone(page) {
  const res = await page.evaluate(() => {
    const app = window._application;
    const fr = app?.gvWorkFrame?.frames;
    const len = fr?.length || 0;
    let f2 = null;
    for (let i = 0; i < len; i++) {
      const f = fr[i]?.form?.divWork?.form;
      if (f?.name === 'cal00202') { f2 = f; break; }
    }
    if (!f2) return { ok: false, reason: 'no cal00202' };
    const ds = f2.ds_calOrdtmChckExeList;
    const rc = ds?.getRowCount?.() || 0;
    let selected = 0;
    for (let i = 0; i < rc; i++) {
      const st = String(ds.getColumn(i, 'ordtmChckSuNm') || '');
      const c = String(ds.getColumn(i, 'ordtmChckCplSuNm') || '');
      const hit = (st === '정상' || st === '미흡') && c === '검토중';
      ds.setColumn(i, 'gridcmmcheck', hit ? '1' : '0');
      if (hit) selected++;
    }
    if (selected > 0) {
      f2.BtnConfirm_onclick(f2.BtnConfirm, {});
      try { f2.fnConfirmCallback('confirmSaveCallback', true); } catch {}
    }
    return { ok: true, selected };
  }).catch(() => ({ ok: false, selected: 0 }));

  await sleep(900);
  await dismiss(page, 10);
  return res;
}

(async () => {
  process.env.CDP_HOST = '100.87.3.123';

  const wb = XLSX.readFile(EXCEL);
  const ws = wb.Sheets[SHEET] || wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(ws, { defval: '' });
  const candidates = rows
    .map((r, i) => ({
      row: i + 1,
      no: N(r['순번']),
      agency: String(r['전문기관'] || '').trim(),
      taskNo: String(r['과제번호'] || '').trim(),
      ieNmRaw: String(r['연구수행기관'] || '').trim(),
      ieNmCore: cleanIeName(r['연구수행기관'] || ''),
      unconfirmedHint: N(r['미확정']),
    }))
    .filter((x) => x.taskNo && x.ieNmCore && x.unconfirmedHint > 0);

  const stamp = ts().replace(/[:.]/g, '-');
  const summaryPath = `projects/이지바로-v2-단일세션-요약-${stamp}.json`;
  const summary = { startedAt: ts(), total: candidates.length, done: 0, success: 0, skipped: 0, failed: 0, items: [] };

  const { browser, context } = await connectBrowser(9446);
  const page = context.pages()[0];

  try {
    for (let i = 0; i < candidates.length; i++) {
      const c = candidates[i];
      console.log(`[START ${i + 1}/${candidates.length}] ${c.taskNo} / ${c.ieNmRaw}`);
      let status = 'failed';
      let payload = {};
      const started = ts();

      try {
        const opened = await searchAndOpen(page, c);
        if (!opened.ok) {
          status = 'failed';
          payload = { ok: false, stage: 'open', opened };
        } else {
          await dismiss(page, 8);
          const before = await readSummary(page);
          if (!before.ok) {
            status = 'failed';
            payload = { ok: false, stage: 'summary', before };
          } else if (before.sum.unconfirmed < 1) {
            status = 'skipped';
            payload = { ok: true, msg: '처리 가능한 미확정 대상 없음', before: before.sum };
          } else {
            const forProfit = /\(주\)|주식회사/.test(before.ieNm || c.ieNmRaw);
            const normal = [];
            const weak = [];
            const logs = [];

            for (const r of before.rows) {
              const fileNames = await collectFiles(page, r.idx);
              const joined = fileNames.join(' | ');
              const hasReq = /(구매의뢰|지출결의|결의서|품의)/.test(joined);
              const hasStmt = /(거래명세|세금계산서|계산서|영수증|이체)/.test(joined);
              const hasInspect = /(검수확인|검수|검수조서|납품확인|입고확인)/.test(joined);
              const inKind = /현물/.test(r.exeMt || '');
              const supply = N(r.splAt);
              const transfer = N(r.exeSplAt);
              const fileCnt = N(r.fileCount);
              const isMat = String(r.titNm || '').includes('연구재료비');

              let decision = '정상';
              let reason = '증빙 존재 및 명시 위반사항 미발견';

              if (inKind) {
                decision = '정상';
                reason = '집행방법 현물 규칙 적용';
              } else if (forProfit && supply > 0 && transfer > supply) {
                decision = '미흡';
                reason = '영리기관 부가세 포함 집행(연구비이체금액>공급금액)';
              } else if (isMat) {
                if (hasReq && hasStmt && hasInspect) {
                  decision = '정상';
                  reason = '연구재료비 필수서류(구매의뢰/거래증빙/검수확인) 확인';
                } else {
                  decision = '미흡';
                  reason = '연구재료비 필수서류 일부 누락';
                }
              } else if (fileCnt === 0) {
                decision = '미흡';
                reason = '증빙서류 미등록(fileCount=0)';
              }

              if (decision === '정상') normal.push(r.decsnSn);
              else weak.push(r.decsnSn);
              logs.push({ ...r, fileNames, decision, reason });
            }

            const applyNormal = await applyStatus(page, normal, '정상');
            const applyWeak = await applyStatus(page, weak, '미흡');
            const confirm = await confirmDone(page);
            const after = await readSummary(page);

            status = 'success';
            payload = {
              ok: true,
              target: { taskNo: before.taskNo, ieNm: before.ieNm },
              before: before.sum,
              plan: { normal: normal.length, weak: weak.length },
              applyNormal,
              applyWeak,
              confirm,
              after: after.sum,
            };

            const outJson = `projects/이지바로-자동다음-${before.taskNo}-${cleanIeName(before.ieNm || c.ieNmCore)}-${ts().replace(/[:.]/g, '-')}.json`;
            const outXlsx = outJson.replace('.json', '.xlsx');
            fs.writeFileSync(outJson, JSON.stringify({ ...payload, logs }, null, 2), 'utf-8');
            const wb2 = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(wb2, XLSX.utils.json_to_sheet(logs.map((x) => ({
              순번: x.rn,
              결의순번: x.decsnSn,
              결의제목: x.title,
              비목: x.titNm,
              세목: x.sePpoNm,
              fileCount: x.fileCount,
              처리결론: x.decision,
              처리사유: x.reason,
            }))), '판정로그');
            XLSX.utils.book_append_sheet(wb2, XLSX.utils.json_to_sheet([before.sum]), '처리전');
            XLSX.utils.book_append_sheet(wb2, XLSX.utils.json_to_sheet([after.sum]), '처리후');
            XLSX.writeFile(wb2, outXlsx);
            payload.outJson = outJson;
            payload.outXlsx = outXlsx;
          }
        }
      } catch (e) {
        status = 'failed';
        payload = { ok: false, error: e.message };
      }

      summary.done += 1;
      if (status === 'success') summary.success += 1;
      else if (status === 'skipped') summary.skipped += 1;
      else summary.failed += 1;
      summary.items.push({ row: c.row, no: c.no, taskNo: c.taskNo, ieNm: c.ieNmRaw, unconfirmedHint: c.unconfirmedHint, started, ended: ts(), status, payload });
      fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2), 'utf-8');
      console.log(`[${summary.done}/${summary.total}] ${c.taskNo} / ${c.ieNmRaw} => ${status}`);
    }
  } finally {
    summary.finishedAt = ts();
    fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2), 'utf-8');
    await browser.close().catch(() => {});
  }

  console.log(JSON.stringify({ ok: true, summaryPath, total: summary.total, success: summary.success, skipped: summary.skipped, failed: summary.failed }, null, 2));
})();
