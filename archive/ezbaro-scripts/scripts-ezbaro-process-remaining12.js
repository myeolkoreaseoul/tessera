const fs = require('fs');
const XLSX = require('xlsx');
const { connectBrowser, sleep } = require('./lib/utils');

const TARGETS = [
  { rn: '224', decsnSn: '53019592', verdict: '정상', reason: '지출결의+광고게재문서+외화송금신청서(지급증빙) 확인' },
  { rn: '254', decsnSn: '52966988', verdict: '미확정', reason: '결과보고/계약은 있으나 지급증빙 파일 식별 불충분' },
  { rn: '402', decsnSn: '53019590', verdict: '정상', reason: '지출결의+광고게재문서+외화송금신청서(지급증빙) 확인' },
  { rn: '431', decsnSn: '53009825', verdict: '미확정', reason: '원천세성 건, 지급증빙 파일 식별 불충분' },
  { rn: '477', decsnSn: '53009824', verdict: '미확정', reason: '계약/결의는 있으나 지급증빙 파일 식별 불충분' },
  { rn: '481', decsnSn: '53009893', verdict: '미확정', reason: '원천세성 건, 지급증빙 파일 식별 불충분' },
  { rn: '561', decsnSn: '53009892', verdict: '미확정', reason: '계약/결의는 있으나 지급증빙 파일 식별 불충분' },
  { rn: '567', decsnSn: '53472341', verdict: '미확정', reason: '국내외출장비 건, 현재 연구개발서비스활용비 판정 트랙 제외' },
  { rn: '593', decsnSn: '53019591', verdict: '정상', reason: '지출결의+광고게재문서+외화송금신청서(지급증빙) 확인' },
  { rn: '606', decsnSn: '52966989', verdict: '미확정', reason: '원천세성 건, 지급증빙 파일 식별 불충분' },
  { rn: '628', decsnSn: '53010309', verdict: '정상', reason: '지출결의+기사결과물+계산서(증빙열) 확인' },
  { rn: '699', decsnSn: '53009481', verdict: '미확정', reason: '고액 건으로 결과보고서 식별 전까지 보류' },
];

async function dismiss(page, rounds = 10) {
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
    await sleep(220);
  }
}

async function waitRows(page, min = 750, loops = 50) {
  for (let i = 0; i < loops; i++) {
    const rc = await page.evaluate(() => {
      const app = window._application;
      const frames = app?.gvWorkFrame?.frames;
      let form = null;
      for (let i = 0; i < (frames?.length || 0); i++) {
        const f = frames[i]?.form?.divWork?.form;
        if (f?.name === 'cal00202') { form = f; break; }
      }
      if (!form) return -1;
      return form.ds_calOrdtmChckExeList?.getRowCount?.() ?? -1;
    }).catch(() => -1);
    if (rc >= min) return rc;
    await sleep(220);
  }
  return -1;
}

(async () => {
  process.env.CDP_HOST = '100.87.3.123';
  const { browser, context } = await connectBrowser(9446);
  const page = context.pages()[0];
  const logs = [];

  try {
    await page.evaluate(() => {
      const app = window._application;
      const frames = app?.gvWorkFrame?.frames;
      let form = null;
      for (let i = 0; i < (frames?.length || 0); i++) {
        const f = frames[i]?.form?.divWork?.form;
        if (f?.name === 'cal00202') { form = f; break; }
      }
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

    await waitRows(page, 750, 60);

    const toNormal = TARGETS.filter(t => t.verdict === '정상');

    for (const t of toNormal) {
      const applied = await page.evaluate((target) => {
        const app = window._application;
        const frames = app?.gvWorkFrame?.frames;
        let form = null;
        for (let i = 0; i < (frames?.length || 0); i++) {
          const f = frames[i]?.form?.divWork?.form;
          if (f?.name === 'cal00202') { form = f; break; }
        }
        if (!form) return { ok: false, reason: 'no form' };
        const ds = form.ds_calOrdtmChckExeList;
        let idx = -1;
        for (let i = 0; i < ds.getRowCount(); i++) {
          if (String(ds.getColumn(i, 'decsnSn') || '') === String(target.decsnSn)) { idx = i; break; }
        }
        if (idx < 0) return { ok: false, reason: 'not found' };

        for (let i = 0; i < ds.getRowCount(); i++) ds.setColumn(i, 'gridcmmcheck', '0');
        ds.setColumn(idx, 'gridcmmcheck', '1');
        form.cbo01.set_value('0001');
        form.cbo01.set_text('정상');
        form.btnChckNotPass_onclick(form.btnChckNotPass, {});
        form.BtnSave_onclick(form.BtnSave, {});
        try { form.fnConfirmCallback('saveCallback', true); } catch {}

        return {
          ok: true,
          rn: String(ds.getColumn(idx, 'rn') || ''),
          decsnSn: String(ds.getColumn(idx, 'decsnSn') || ''),
          title: String(ds.getColumn(idx, 'decsnTilTt') || ''),
          before: String(ds.getColumn(idx, 'ordtmChckSuNm') || ''),
          cpl: String(ds.getColumn(idx, 'ordtmChckCplSuNm') || ''),
        };
      }, t).catch(() => ({ ok: false, reason: 'eval error' }));

      await sleep(1000);
      await dismiss(page, 8);
      logs.push({ ...t, step: '정상반영', applied });
    }

    // 정상 반영 후 확인완료
    const confirmResult = await page.evaluate((normalDecsn) => {
      const app = window._application;
      const frames = app?.gvWorkFrame?.frames;
      let form = null;
      for (let i = 0; i < (frames?.length || 0); i++) {
        const f = frames[i]?.form?.divWork?.form;
        if (f?.name === 'cal00202') { form = f; break; }
      }
      if (!form) return { ok: false, reason: 'no form' };
      try {
        form.divSearch.form.cboSupl.set_value('0001');
        form.divSearch.form.cboSupl.set_text('검토중');
        form.divSearch_btnSearch_onclick(form.divSearch.form.btnSearch, {});
      } catch {}

      const ds = form.ds_calOrdtmChckExeList;
      let selected = 0;
      for (let i = 0; i < ds.getRowCount(); i++) {
        const d = String(ds.getColumn(i, 'decsnSn') || '');
        const st = String(ds.getColumn(i, 'ordtmChckSuNm') || '');
        const hit = normalDecsn.includes(d) && st === '정상';
        ds.setColumn(i, 'gridcmmcheck', hit ? '1' : '0');
        if (hit) selected++;
      }
      if (selected > 0) {
        form.BtnConfirm_onclick(form.BtnConfirm, {});
        try { form.fnConfirmCallback('confirmSaveCallback', true); } catch {}
      }
      return { ok: true, selected };
    }, toNormal.map(t => t.decsnSn)).catch(() => ({ ok: false, reason: 'eval error' }));

    await sleep(1200);
    await dismiss(page, 10);

    // 최종 전체조회 후 12건 스냅샷
    await page.evaluate(() => {
      const app = window._application;
      const frames = app?.gvWorkFrame?.frames;
      let form = null;
      for (let i = 0; i < (frames?.length || 0); i++) {
        const f = frames[i]?.form?.divWork?.form;
        if (f?.name === 'cal00202') { form = f; break; }
      }
      if (!form) return;
      const s = form.divSearch?.form;
      try { s.cboSupl.set_index(0); } catch {}
      try { form.divSearch_btnSearch_onclick(s.btnSearch, {}); } catch {}
      try { form.btnTotSearch_onclick(form.btnTotSearch, {}); } catch {}
    });

    await waitRows(page, 750, 60);

    const finalRows = await page.evaluate((targets) => {
      const set = new Set(targets.map(t => t.decsnSn));
      const app = window._application;
      const frames = app?.gvWorkFrame?.frames;
      let form = null;
      for (let i = 0; i < (frames?.length || 0); i++) {
        const f = frames[i]?.form?.divWork?.form;
        if (f?.name === 'cal00202') { form = f; break; }
      }
      if (!form) return { ok: false, rows: [] };
      const ds = form.ds_calOrdtmChckExeList;
      const rows = [];
      for (let i = 0; i < ds.getRowCount(); i++) {
        const decsnSn = String(ds.getColumn(i, 'decsnSn') || '');
        if (!set.has(decsnSn)) continue;
        rows.push({
          rn: String(ds.getColumn(i, 'rn') || ''),
          decsnSn,
          title: String(ds.getColumn(i, 'decsnTilTt') || ''),
          titNm: String(ds.getColumn(i, 'titNm') || ''),
          sePpoNm: String(ds.getColumn(i, 'sePpoNm') || ''),
          amount: String(ds.getColumn(i, 'rscpSeAt') || ''),
          proof: String(ds.getColumn(i, 'proofNm') || ''),
          status: String(ds.getColumn(i, 'ordtmChckSuNm') || ''),
          cpl: String(ds.getColumn(i, 'ordtmChckCplSuNm') || ''),
        });
      }
      rows.sort((a, b) => Number(a.rn) - Number(b.rn));
      return { ok: true, rows };
    }, TARGETS).catch(() => ({ ok: false, rows: [] }));

    const joined = finalRows.rows.map(r => {
      const t = TARGETS.find(x => x.decsnSn === r.decsnSn) || {};
      return { ...r, 판정계획: t.verdict || '', 판정사유: t.reason || '' };
    });

    const sum = {
      total: joined.length,
      normal: joined.filter(r => r.status === '정상').length,
      unconfirmed: joined.filter(r => r.status === '미확정').length,
      done: joined.filter(r => r.cpl === '점검완료').length,
      reviewing: joined.filter(r => r.cpl === '검토중').length,
    };

    const outJson = 'projects/이지바로-미확정12-처리결과.json';
    const outXlsx = 'projects/이지바로-미확정12-처리결과.xlsx';
    fs.writeFileSync(outJson, JSON.stringify({ targets: TARGETS, logs, confirmResult, sum, rows: joined }, null, 2), 'utf-8');
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(joined), 'result');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet([sum]), 'summary');
    XLSX.writeFile(wb, outXlsx);

    console.log(JSON.stringify({ ok: true, confirmResult, sum, outJson, outXlsx }, null, 2));
  } finally {
    await browser.close().catch(() => {});
  }
})();
