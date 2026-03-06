const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');
const { connectBrowser, sleep } = require('./lib/utils');

const prev = JSON.parse(fs.readFileSync('projects/이지바로-재판정-35건-최종로그.json', 'utf-8'));
const remainRows = prev.rows.filter(r => r['실제반영'] === '미확정유지');
const REMAIN_DECSN = remainRows.map(r => String(r['결의순번'] || '')).filter(Boolean);

function toNum(v) { return Number(String(v || '').replace(/[^0-9-]/g, '')) || 0; }

function analyze(row, fileNames) {
  const joined = fileNames.join(' | ');
  const amount = toNum(row.amount);
  const orgRisk = /(국가신약개발재단|국가신약개발사업단)/.test(row.institute || '') && /(국가신약개발재단|국가신약개발사업단)/.test(row.receiver || '');

  const hasInternal = /(지출결의|품의|내부.?결재|결의서)/i.test(joined) || /지출결의서/i.test(row.title || '');
  const hasContract = /(계약서|용역.?계약|과업지시|제안서|의뢰|발주)/i.test(joined);
  const hasResult = /(결과보고|최종보고|완료보고|검수|결과서)/i.test(joined);
  const hasPay = /(세금계산서|계산서|이체|영수증|전표|거래내역|입금)/i.test(joined) || /(계산서|카드)/.test(row.proof || '');

  let verdict = '미확정';
  let reason = '핵심 증빙 부족';

  const strict = orgRisk || amount >= 20000000;
  if (strict) {
    if (hasInternal && hasContract && hasPay && hasResult) {
      verdict = '정상';
      reason = '고위험/고액 기준 충족(내부결재+계약+결제+결과)';
    } else {
      reason = '고위험/고액 기준 미충족';
    }
  } else {
    if (hasInternal && hasContract && hasPay) {
      verdict = '정상';
      reason = hasResult
        ? '기본 기준 충족(내부결재+계약+결제+결과)'
        : '기본 기준 충족(내부결재+계약+결제), 결과서 파일명 식별 불명확';
    }
  }

  return { verdict, reason, strict, orgRisk, hasInternal, hasContract, hasResult, hasPay };
}

async function dismiss(page, rounds = 6) {
  for (let r = 0; r < rounds; r++) {
    await page.evaluate(() => {
      const vis = el => {
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
    await sleep(220);
  }
}

async function clickText(page, pattern) {
  return page.evaluate((src) => {
    const re = new RegExp(src);
    const vis = el => {
      const b = el.getBoundingClientRect();
      const s = getComputedStyle(el);
      return b.width > 0 && b.height > 0 && s.display !== 'none' && s.visibility !== 'hidden';
    };
    const el = [...document.querySelectorAll('*')].find(x => x.childElementCount === 0 && vis(x) && re.test((x.innerText || '').trim()));
    if (!el) return false;
    el.click();
    return true;
  }, pattern.source || String(pattern));
}

(async () => {
  process.env.CDP_HOST = '100.87.3.123';
  const { browser, context } = await connectBrowser(9446);
  const page = context.pages()[0];
  const logs = [];

  try {
    await page.evaluate(() => {
      const app = window._application; const frames = app?.gvWorkFrame?.frames; let form = null;
      for (let i = 0; i < (frames?.length || 0); i++) { const f = frames[i]?.form?.divWork?.form; if (f?.name === 'cal00202') { form = f; break; } }
      if (!form) return;
      const s = form.divSearch?.form;
      try { s.cboSupl.set_index(0); } catch {}
      try { s.cboTitCd.set_index(0); } catch {}
      try { s.cboSePpoCd.set_index(0); } catch {}
      try { s.cboAt.set_index(0); } catch {}
      try { s.cboProofCls.set_index(0); } catch {}
      try { s.cboOrdtmChckSuCd.set_index(0); } catch {}
      try { s.cboExeMtCCd.set_index(0); } catch {}
      try { s.cboDecsnSuCCd.set_index(0); } catch {}
      try { s.cboExeChgF.set_index(0); } catch {}
      try { form.divSearch_btnSearch_onclick(s.btnSearch, {}); } catch {}
      try { form.btnTotSearch_onclick(form.btnTotSearch, {}); } catch {}
    });

    for (let i = 0; i < 40; i++) {
      const rc = await page.evaluate(() => {
        const app = window._application; const frames = app?.gvWorkFrame?.frames; let form = null;
        for (let i = 0; i < (frames?.length || 0); i++) { const f = frames[i]?.form?.divWork?.form; if (f?.name === 'cal00202') { form = f; break; } }
        if (!form) return -1;
        return form.ds_calOrdtmChckExeList?.getRowCount?.() ?? -1;
      }).catch(() => -1);
      if (rc >= 750) break;
      await sleep(200);
    }

    for (const decsnSn of REMAIN_DECSN) {
      const row = await page.evaluate((target) => {
        const app = window._application; const frames = app?.gvWorkFrame?.frames; let form = null;
        for (let i = 0; i < (frames?.length || 0); i++) { const f = frames[i]?.form?.divWork?.form; if (f?.name === 'cal00202') { form = f; break; } }
        if (!form) return { ok: false, reason: 'no form' };
        const ds = form.ds_calOrdtmChckExeList;
        let idx = -1;
        for (let i = 0; i < ds.getRowCount(); i++) {
          if (String(ds.getColumn(i, 'decsnSn') || '') === String(target)) { idx = i; break; }
        }
        if (idx < 0) return { ok: false, reason: 'not found' };
        return {
          ok: true,
          idx,
          decsnSn: String(ds.getColumn(idx, 'decsnSn') || ''),
          rn: String(ds.getColumn(idx, 'rn') || ''),
          title: String(ds.getColumn(idx, 'decsnTilTt') || ''),
          titNm: String(ds.getColumn(idx, 'titNm') || ''),
          sePpoNm: String(ds.getColumn(idx, 'sePpoNm') || ''),
          amount: String(ds.getColumn(idx, 'rscpSeAt') || ''),
          proof: String(ds.getColumn(idx, 'proofNm') || ''),
          status: String(ds.getColumn(idx, 'ordtmChckSuNm') || ''),
          cpl: String(ds.getColumn(idx, 'ordtmChckCplSuNm') || ''),
          institute: String(app?.gdsSelTask?.getColumn?.(0, 'ieNm') || ''),
          receiver: String(ds.getColumn(idx, 'rcverNm') || ''),
        };
      }, decsnSn);

      if (!row.ok) {
        logs.push({ decsnSn, error: row.reason, verdict: '미확정', applied: false });
        continue;
      }

      await page.evaluate((idx) => {
        const app = window._application; const frames = app?.gvWorkFrame?.frames; let form = null;
        for (let i = 0; i < (frames?.length || 0); i++) { const f = frames[i]?.form?.divWork?.form; if (f?.name === 'cal00202') { form = f; break; } }
        if (!form) return;
        try {
          const pf = nexacro.getPopupFrames ? nexacro.getPopupFrames() : null;
          const len = pf?.length || 0;
          for (let i = len - 1; i >= 0; i--) {
            const p = pf[i];
            if ((p.id || '').includes('filePopup')) {
              try { p.form?.btnClose?.click?.(); } catch {}
              try { p.close?.(); } catch {}
            }
          }
        } catch {}
        try { form.calOrdtmChckExeGrid_oncellclick(form.calOrdtmChckExeGrid, { row: idx, col: 14 }); } catch {}
      }, row.idx);

      await sleep(650);
      const fileNames = await page.evaluate(() => {
        const vis = el => {
          const b = el.getBoundingClientRect();
          const s = getComputedStyle(el);
          return b.width > 0 && b.height > 0 && s.display !== 'none' && s.visibility !== 'hidden';
        };
        const names = [...document.querySelectorAll('*')]
          .filter(el => el.childElementCount === 0 && vis(el))
          .map(el => (el.innerText || '').trim())
          .filter(t => /\.(pdf|hwp|hwpx|xlsx|xls|doc|docx|zip)$/i.test(t));
        const out = [];
        const seen = new Set();
        for (const n of names) { if (!seen.has(n)) { seen.add(n); out.push(n); } }
        return out;
      }).catch(() => []);

      const bulkClicked = await clickText(page, /일괄\s*다운로드/);
      await sleep(900);
      await clickText(page, /^닫기$/);
      await dismiss(page, 4);

      const analysis = analyze(row, fileNames);
      let applied = false;

      if (analysis.verdict === '정상') {
        const ap = await page.evaluate((target) => {
          const app = window._application; const frames = app?.gvWorkFrame?.frames; let form = null;
          for (let i = 0; i < (frames?.length || 0); i++) { const f = frames[i]?.form?.divWork?.form; if (f?.name === 'cal00202') { form = f; break; } }
          if (!form) return { ok: false, reason: 'no form' };
          const ds = form.ds_calOrdtmChckExeList;
          let idx = -1;
          for (let i = 0; i < ds.getRowCount(); i++) {
            if (String(ds.getColumn(i, 'decsnSn') || '') === String(target)) { idx = i; break; }
          }
          if (idx < 0) return { ok: false, reason: 'row not found for apply' };
          for (let i = 0; i < ds.getRowCount(); i++) ds.setColumn(i, 'gridcmmcheck', '0');
          ds.setColumn(idx, 'gridcmmcheck', '1');
          form.cbo01.set_value('0001');
          form.cbo01.set_text('정상');
          form.btnChckNotPass_onclick(form.btnChckNotPass, {});
          form.BtnSave_onclick(form.BtnSave, {});
          try { form.fnConfirmCallback('saveCallback', true); } catch {}
          return { ok: true };
        }, decsnSn).catch(() => ({ ok: false }));

        applied = !!ap.ok;
        await sleep(650);
        await dismiss(page, 5);
      }

      logs.push({
        ts: new Date().toISOString(),
        decsnSn,
        rn: row.rn,
        title: row.title,
        titNm: row.titNm,
        sePpoNm: row.sePpoNm,
        institute: row.institute,
        receiver: row.receiver,
        amount: row.amount,
        proof: row.proof,
        fileNames,
        bulkClicked,
        ...analysis,
        applied,
      });
    }

    const outJson = 'projects/이지바로-재판정-24건-진행로그.json';
    const outXlsx = 'projects/이지바로-재판정-24건-진행로그.xlsx';
    const rows = logs.map((r, i) => ({
      순번: i + 1,
      RN: r.rn,
      결의순번: r.decsnSn,
      결의제목: r.title,
      비목: r.titNm,
      사용용도: r.sePpoNm,
      기관: r.institute,
      수령처: r.receiver,
      금액: r.amount,
      증빙구분: r.proof,
      파일명요약: (r.fileNames || []).join(' | ').slice(0, 1000),
      고위험기준: r.strict ? 'Y' : 'N',
      내부결재: r.hasInternal ? 'Y' : 'N',
      계약의뢰: r.hasContract ? 'Y' : 'N',
      결과서: r.hasResult ? 'Y' : 'N',
      결제증빙: r.hasPay ? 'Y' : 'N',
      재판정: r.verdict,
      반영여부: r.applied ? '정상반영' : '미반영',
      사유: r.reason,
      일괄다운로드클릭: r.bulkClicked ? 'Y' : 'N',
    }));

    fs.writeFileSync(outJson, JSON.stringify({ summary: {
      total: logs.length,
      normal: logs.filter(x => x.verdict === '정상').length,
      applied: logs.filter(x => x.applied).length,
    }, logs }, null, 2), 'utf-8');

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), '재판정24건');
    XLSX.writeFile(wb, outXlsx);

    console.log(JSON.stringify({ ok: true, outJson, outXlsx, total: logs.length, normal: logs.filter(x => x.verdict === '정상').length, applied: logs.filter(x => x.applied).length }, null, 2));
  } finally {
    await browser.close().catch(() => {});
  }
})();
