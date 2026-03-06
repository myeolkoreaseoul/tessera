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
    const target = [...document.querySelectorAll('*')].find(el => el.childElementCount === 0 && vis(el) && re.test((el.innerText || '').trim()));
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
          for (const b of ['btn00','btn01','btnOk','btnOK','btnClose','btnCancel','btnYes','btnNo']) {
            try { if (f?.[b]?.click) f[b].click(); } catch {}
          }
          try { if (typeof f?.closeAction === 'function') f.closeAction(); } catch {}
          try { if (typeof p?.close === 'function') p.close(); } catch {}
        }
      } catch {}
    }).catch(()=>{});
    await sleep(250);
  }
}

async function ensureFullList(page) {
  for (let t = 0; t < 8; t++) {
    await page.evaluate(() => {
      const app = window._application;
      const frames = app?.gvWorkFrame?.frames;
      let form = null;
      for (let i = 0; i < (frames?.length || 0); i++) {
        const f = frames[i]?.form?.divWork?.form;
        if (f?.name === 'cal00202') { form = f; break; }
      }
      if (form) {
        try { form.btnTotSearch_onclick(form.btnTotSearch, {}); } catch {}
      }
    }).catch(()=>{});
    await sleep(900);
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
    }).catch(()=>-1);
    if (rc >= 300) return rc;
    await dismissAll(page, 2);
  }
  return -1;
}

(async()=>{
  process.env.CDP_HOST = '100.87.3.123';
  const { browser, context } = await connectBrowser(9446);
  const page = context.pages()[0];
  const report = [];
  try {
    await dismissAll(page, 3);
    const rc = await ensureFullList(page);
    report.push({type:'init', rowCount: rc});

    for (let seq = 108; seq <= 113; seq++) {
      const idx = seq - 1;
      const before = await page.evaluate((idx)=>{
        const app=window._application; const frames=app?.gvWorkFrame?.frames; let form=null;
        for(let i=0;i<(frames?.length||0);i++){const f=frames[i]?.form?.divWork?.form; if(f?.name==='cal00202'){form=f;break;}}
        if(!form) return {ok:false, reason:'no form'};
        const ds=form.ds_calOrdtmChckExeList;
        const rc=ds.getRowCount();
        if(idx>=rc) return {ok:false, reason:'idx out', rc};
        return {
          ok:true, idx,
          rn:String(ds.getColumn(idx,'rn')||''),
          title:String(ds.getColumn(idx,'decsnTilTt')||''),
          sePpoNm:String(ds.getColumn(idx,'sePpoNm')||''),
          status:String(ds.getColumn(idx,'ordtmChckSuNm')||''),
          cpl:String(ds.getColumn(idx,'ordtmChckCplSuNm')||''),
          fileCount:String(ds.getColumn(idx,'fileCount')||'')
        };
      }, idx).catch(e=>({ok:false, reason:e.message}));

      const item={seq,before};
      if(!before.ok){
        await dismissAll(page,3);
        await ensureFullList(page);
        report.push(item);
        continue;
      }

      const open = await page.evaluate((idx)=>{
        const app=window._application; const frames=app?.gvWorkFrame?.frames; let form=null;
        for(let i=0;i<(frames?.length||0);i++){const f=frames[i]?.form?.divWork?.form; if(f?.name==='cal00202'){form=f;break;}}
        if(!form) return {ok:false, reason:'no form'};
        try {
          const pops=nexacro.getPopupFrames? nexacro.getPopupFrames():[];
          for(let i=pops.length-1;i>=0;i--){const p=pops[i]; if((p.id||'').includes('filePopup')){ try{p.form?.btnClose?.click?.();}catch{} try{p.close?.();}catch{} }}
        } catch {}
        try { form.calOrdtmChckExeGrid_oncellclick(form.calOrdtmChckExeGrid,{row:idx,col:14}); return {ok:true}; }
        catch(e){ return {ok:false, reason:e.message}; }
      }, idx);
      item.popupOpen=open;
      await sleep(900);
      item.bulkClicked = await clickText(page,/일괄\s*다운로드/);
      await sleep(1200);
      item.popupClosed = await clickText(page,/^닫기$/);
      await sleep(400);
      await dismissAll(page,3);

      item.apply = await page.evaluate((idx)=>{
        const app=window._application; const frames=app?.gvWorkFrame?.frames; let form=null;
        for(let i=0;i<(frames?.length||0);i++){const f=frames[i]?.form?.divWork?.form; if(f?.name==='cal00202'){form=f;break;}}
        if(!form) return {ok:false, reason:'no form'};
        const ds=form.ds_calOrdtmChckExeList;
        if(idx>=ds.getRowCount()) return {ok:false, reason:'idx out apply', rc:ds.getRowCount()};
        for(let i=0;i<ds.getRowCount();i++) ds.setColumn(i,'gridcmmcheck','0');
        ds.setColumn(idx,'gridcmmcheck','1');
        form.cbo01.set_value('0001');
        form.cbo01.set_text('정상');
        form.btnChckNotPass_onclick(form.btnChckNotPass,{});
        form.BtnSave_onclick(form.BtnSave,{});
        try{form.fnConfirmCallback('saveCallback', true);}catch{}
        return {ok:true};
      }, idx);

      await sleep(1400);
      await dismissAll(page,5);
      await ensureFullList(page);

      item.after = await page.evaluate((rn)=>{
        const app=window._application; const frames=app?.gvWorkFrame?.frames; let form=null;
        for(let i=0;i<(frames?.length||0);i++){const f=frames[i]?.form?.divWork?.form; if(f?.name==='cal00202'){form=f;break;}}
        if(!form) return {ok:false, reason:'no form'};
        const ds=form.ds_calOrdtmChckExeList;
        let idx=-1;
        for(let i=0;i<ds.getRowCount();i++){if(String(ds.getColumn(i,'rn')||'')===String(rn)){idx=i;break;}}
        if(idx<0) return {ok:false, reason:'rn not found', rn};
        return {
          ok:true, idx, rn,
          status:String(ds.getColumn(idx,'ordtmChckSuNm')||''),
          cpl:String(ds.getColumn(idx,'ordtmChckCplSuNm')||''),
          each: form.eachCnt?.text || '',
          tot: form.totCnt?.text || ''
        };
      }, before.rn);

      report.push(item);
    }

    const outFile = path.join(process.cwd(),'projects','ezbaro-108-113-report.json');
    fs.writeFileSync(outFile, JSON.stringify(report,null,2),'utf-8');
    console.log(JSON.stringify({ok:true,outFile,report},null,2));
  } finally {
    await browser.close().catch(()=>{});
  }
})();
