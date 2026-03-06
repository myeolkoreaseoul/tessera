const fs = require('fs');
const path = require('path');
const { connectBrowser, sleep } = require('./lib/utils');

async function clickText(page, re) {
  return page.evaluate((src) => {
    const re = new RegExp(src);
    const vis = el => {
      const r = el.getBoundingClientRect();
      const s = getComputedStyle(el);
      return r.width > 0 && r.height > 0 && s.display !== 'none' && s.visibility !== 'hidden';
    };
    const els = [...document.querySelectorAll('*')].filter(el => el.childElementCount === 0 && vis(el));
    const target = els.find(el => re.test((el.innerText || '').trim()));
    if (!target) return false;
    target.click();
    return true;
  }, re.source || String(re));
}

async function dismissAll(page, rounds = 4) {
  for (let i = 0; i < rounds; i++) {
    await page.evaluate(() => {
      const vis = el => {
        const r = el.getBoundingClientRect();
        const s = getComputedStyle(el);
        return r.width > 0 && r.height > 0 && s.display !== 'none' && s.visibility !== 'hidden';
      };
      for (const el of [...document.querySelectorAll('*')]) {
        if (el.childElementCount !== 0 || !vis(el)) continue;
        const t = (el.innerText || '').trim();
        if (t === '확인' || t === 'OK' || t === '닫기') el.click();
      }
      try {
        const pops = nexacro.getPopupFrames ? nexacro.getPopupFrames() : [];
        for (let i = pops.length - 1; i >= 0; i--) {
          const p = pops[i];
          const f = p.form;
          const btns = ['btn00','btn01','btnOk','btnOK','btnClose','btnCancel','btnYes','btnNo'];
          for (const b of btns) {
            try { if (f?.[b]?.click) f[b].click(); } catch {}
          }
          try { if (typeof f?.closeAction === 'function') f.closeAction(); } catch {}
          try { if (typeof p?.close === 'function') p.close(); } catch {}
        }
      } catch {}
    }).catch(() => {});
    await sleep(250);
  }
}

(async () => {
  process.env.CDP_HOST = '100.87.3.123';
  const { browser, context } = await connectBrowser(9446);
  const page = context.pages()[0];
  const report = [];

  try {
    await page.evaluate(() => {
      const app = window._application;
      const frames = app?.gvWorkFrame?.frames;
      let form = null;
      for (let i = 0; i < (frames?.length || 0); i++) {
        const f = frames[i]?.form?.divWork?.form;
        if (f?.name === 'cal00202') { form = f; break; }
      }
      if (form) form.btnTotSearch_onclick(form.btnTotSearch, {});
    });
    await sleep(1200);

    const row103 = await page.evaluate(() => {
      const app = window._application;
      const frames = app?.gvWorkFrame?.frames;
      let form = null;
      for (let i = 0; i < (frames?.length || 0); i++) {
        const f = frames[i]?.form?.divWork?.form;
        if (f?.name === 'cal00202') { form = f; break; }
      }
      if (!form) return { ok:false };
      const ds = form.ds_calOrdtmChckExeList;
      let idx = -1;
      for (let i = 0; i < ds.getRowCount(); i++) {
        if (String(ds.getColumn(i,'rn')||'') === '553') { idx = i; break; }
      }
      if (idx < 0) return { ok:false, reason:'rn553 not found' };
      return {
        ok:true, seq:103, rn:'553',
        title: ds.getColumn(idx,'decsnTilTt'),
        status: ds.getColumn(idx,'ordtmChckSuNm'),
        cpl: ds.getColumn(idx,'ordtmChckCplSuNm')
      };
    });
    report.push({ type:'check-103', ...row103 });

    for (let seq = 104; seq <= 113; seq++) {
      const idx = seq - 1;
      const before = await page.evaluate(({ idx, seq }) => {
        const app = window._application;
        const frames = app?.gvWorkFrame?.frames;
        let form = null;
        for (let i = 0; i < (frames?.length || 0); i++) {
          const f = frames[i]?.form?.divWork?.form;
          if (f?.name === 'cal00202') { form = f; break; }
        }
        if (!form) return { ok:false, seq, reason:'no form' };
        const ds = form.ds_calOrdtmChckExeList;
        if (idx >= ds.getRowCount()) return { ok:false, seq, reason:'idx out of range', rowCount: ds.getRowCount() };
        return {
          ok:true, seq, idx,
          rn: String(ds.getColumn(idx,'rn')||''),
          title: String(ds.getColumn(idx,'decsnTilTt')||''),
          sePpoNm: String(ds.getColumn(idx,'sePpoNm')||''),
          status: String(ds.getColumn(idx,'ordtmChckSuNm')||''),
          cpl: String(ds.getColumn(idx,'ordtmChckCplSuNm')||''),
          fileCount: String(ds.getColumn(idx,'fileCount')||'')
        };
      }, { idx, seq });

      const item = { seq, before };
      if (!before.ok) {
        report.push(item);
        continue;
      }

      const open = await page.evaluate((idx) => {
        const app = window._application;
        const frames = app?.gvWorkFrame?.frames;
        let form = null;
        for (let i = 0; i < (frames?.length || 0); i++) {
          const f = frames[i]?.form?.divWork?.form;
          if (f?.name === 'cal00202') { form = f; break; }
        }
        if (!form) return { ok:false, reason:'no form' };
        try {
          try {
            const pops = nexacro.getPopupFrames ? nexacro.getPopupFrames() : [];
            for (let i = pops.length - 1; i >= 0; i--) {
              const p = pops[i];
              if ((p.id || '').includes('filePopup')) {
                try { p.form?.btnClose?.click?.(); } catch {}
                try { p.close?.(); } catch {}
              }
            }
          } catch {}
          form.calOrdtmChckExeGrid_oncellclick(form.calOrdtmChckExeGrid,{row:idx,col:14});
          return { ok:true };
        } catch (e) {
          return { ok:false, reason:e.message };
        }
      }, idx);
      item.popupOpen = open;
      await sleep(900);

      item.bulkClicked = await clickText(page, /일괄\s*다운로드/);
      await sleep(1200);
      item.popupClosed = await clickText(page, /^닫기$/);
      await sleep(400);
      await dismissAll(page, 3);

      const apply = await page.evaluate((idx) => {
        const app = window._application;
        const frames = app?.gvWorkFrame?.frames;
        let form = null;
        for (let i = 0; i < (frames?.length || 0); i++) {
          const f = frames[i]?.form?.divWork?.form;
          if (f?.name === 'cal00202') { form = f; break; }
        }
        if (!form) return { ok:false, reason:'no form' };
        const ds = form.ds_calOrdtmChckExeList;
        if (idx >= ds.getRowCount()) return { ok:false, reason:'idx out of range', rowCount: ds.getRowCount() };
        for (let i = 0; i < ds.getRowCount(); i++) ds.setColumn(i,'gridcmmcheck','0');
        ds.setColumn(idx,'gridcmmcheck','1');
        form.cbo01.set_value('0001');
        form.cbo01.set_text('정상');
        form.btnChckNotPass_onclick(form.btnChckNotPass,{});
        form.BtnSave_onclick(form.BtnSave,{});
        try { form.fnConfirmCallback('saveCallback', true); } catch {}
        return { ok:true };
      }, idx);
      item.apply = apply;

      await sleep(1500);
      await dismissAll(page, 5);

      await page.evaluate(() => {
        const app = window._application;
        const frames = app?.gvWorkFrame?.frames;
        let form = null;
        for (let i = 0; i < (frames?.length || 0); i++) {
          const f = frames[i]?.form?.divWork?.form;
          if (f?.name === 'cal00202') { form = f; break; }
        }
        if (form) form.btnTotSearch_onclick(form.btnTotSearch,{});
      }).catch(() => {});
      await sleep(900);

      const after = await page.evaluate((rn) => {
        const app = window._application;
        const frames = app?.gvWorkFrame?.frames;
        let form = null;
        for (let i = 0; i < (frames?.length || 0); i++) {
          const f = frames[i]?.form?.divWork?.form;
          if (f?.name === 'cal00202') { form = f; break; }
        }
        if (!form) return { ok:false, reason:'no form' };
        const ds = form.ds_calOrdtmChckExeList;
        let idx = -1;
        for (let i = 0; i < ds.getRowCount(); i++) {
          if (String(ds.getColumn(i,'rn')||'') === String(rn)) { idx = i; break; }
        }
        if (idx < 0) return { ok:false, reason:'rn not found', rn };
        return {
          ok:true, idx, rn,
          status: String(ds.getColumn(idx,'ordtmChckSuNm')||''),
          statusCd: String(ds.getColumn(idx,'ordtmChckSuCd')||''),
          cpl: String(ds.getColumn(idx,'ordtmChckCplSuNm')||''),
          cplCd: String(ds.getColumn(idx,'ordtmChckCplSuCd')||''),
          each: form.eachCnt?.text || '',
          tot: form.totCnt?.text || ''
        };
      }, before.rn);
      item.after = after;
      report.push(item);
    }

    const outFile = path.join(process.cwd(), 'projects', 'ezbaro-104-113-report.json');
    fs.writeFileSync(outFile, JSON.stringify(report, null, 2), 'utf-8');
    console.log(JSON.stringify({ ok:true, outFile, count: report.length, report }, null, 2));
  } finally {
    await browser.close().catch(() => {});
  }
})().catch(e => { console.error('ERROR:', e.message); console.error(e.stack); process.exit(1); });
