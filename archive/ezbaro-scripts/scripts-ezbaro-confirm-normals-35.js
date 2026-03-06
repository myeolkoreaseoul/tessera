const fs=require('fs');
const XLSX=require('xlsx');
const { connectBrowser, sleep } = require('./lib/utils');

const TARGET_RNS=['8','9','14','79','91','182','183','204','224','254','255','259','281','334','350','358','402','417','431','466','474','477','481','553','561','562','567','575','593','606','622','623','628','689','699'];

async function dismiss(page, rounds=8){
  for(let r=0;r<rounds;r++){
    await page.evaluate(()=>{
      const vis=el=>{const b=el.getBoundingClientRect(); const s=getComputedStyle(el); return b.width>0&&b.height>0&&s.display!=='none'&&s.visibility!=='hidden';};
      for(const el of [...document.querySelectorAll('*')]){ if(el.childElementCount!==0||!vis(el)) continue; const t=(el.innerText||'').trim(); if(t==='확인'||t==='OK'||t==='닫기') el.click(); }
      try{const pf=nexacro.getPopupFrames? nexacro.getPopupFrames():null; const len=pf?.length||0; for(let i=len-1;i>=0;i--){const p=pf[i]; try{p.form?.btn00?.click?.();}catch{} try{p.form?.btnOk?.click?.();}catch{} try{p.form?.btnClose?.click?.();}catch{} }}catch{}
    }).catch(()=>{});
    await sleep(220);
  }
}

(async()=>{
 process.env.CDP_HOST='100.87.3.123';
 const {browser,context}=await connectBrowser(9446);
 const page=context.pages()[0];

 try {
  // clear filter + total
  await page.evaluate(()=>{
    const app=window._application; const frames=app?.gvWorkFrame?.frames; let form=null;
    for(let i=0;i<(frames?.length||0);i++){const f=frames[i]?.form?.divWork?.form; if(f?.name==='cal00202'){form=f;break;}}
    if(!form) return;
    const s=form.divSearch?.form;
    try{s.cboSupl.set_index(0);}catch{}
    try{s.cboTitCd.set_index(0);}catch{}
    try{s.cboSePpoCd.set_index(0);}catch{}
    try{s.cboAt.set_index(0);}catch{}
    try{s.cboProofCls.set_index(0);}catch{}
    try{s.cboOrdtmChckSuCd.set_index(0);}catch{}
    try{s.cboExeMtCCd.set_index(0);}catch{}
    try{s.cboDecsnSuCCd.set_index(0);}catch{}
    try{s.cboExeChgF.set_index(0);}catch{}
    try{form.divSearch_btnSearch_onclick(s.btnSearch,{});}catch{}
    try{form.btnTotSearch_onclick(form.btnTotSearch,{});}catch{}
  });
  for(let i=0;i<50;i++){
    const rc=await page.evaluate(()=>{const app=window._application; const frames=app?.gvWorkFrame?.frames; let form=null; for(let i=0;i<(frames?.length||0);i++){const f=frames[i]?.form?.divWork?.form; if(f?.name==='cal00202'){form=f;break;}} if(!form) return -1; return form.ds_calOrdtmChckExeList?.getRowCount?.() ?? -1;}).catch(()=>-1);
    if(rc>=750) break; await sleep(200);
  }

  // gather current target rows
  const snapshot=await page.evaluate((target)=>{
    const app=window._application; const frames=app?.gvWorkFrame?.frames; let form=null;
    for(let i=0;i<(frames?.length||0);i++){const f=frames[i]?.form?.divWork?.form; if(f?.name==='cal00202'){form=f;break;}}
    if(!form) return {ok:false};
    const ds=form.ds_calOrdtmChckExeList;
    const rows=[]; const seen={};
    for(let i=0;i<ds.getRowCount();i++){
      const rn=String(ds.getColumn(i,'rn')||'');
      if(!target.includes(rn)) continue;
      const key=String(ds.getColumn(i,'decsnSn')||'')||rn+'-'+String(ds.getColumn(i,'decsnTilTt')||'');
      if(seen[key]) continue; seen[key]=1;
      rows.push({idx:i,rn,decsnSn:String(ds.getColumn(i,'decsnSn')||''),title:String(ds.getColumn(i,'decsnTilTt')||''),status:String(ds.getColumn(i,'ordtmChckSuNm')||''),cpl:String(ds.getColumn(i,'ordtmChckCplSuNm')||''),titNm:String(ds.getColumn(i,'titNm')||''),sePpoNm:String(ds.getColumn(i,'sePpoNm')||''),amount:String(ds.getColumn(i,'rscpSeAt')||'')});
    }
    return {ok:true,rows};
  }, TARGET_RNS);

  const normals=snapshot.rows.filter(r=>r.status==='정상').map(r=>r.decsnSn);

  // confirm only normal items
  const confirm=await page.evaluate((decsns)=>{
    const app=window._application; const frames=app?.gvWorkFrame?.frames; let form=null;
    for(let i=0;i<(frames?.length||0);i++){const f=frames[i]?.form?.divWork?.form; if(f?.name==='cal00202'){form=f;break;}}
    if(!form) return {ok:false,reason:'no form'};

    try{ form.divSearch.form.cboSupl.set_value('0001'); form.divSearch.form.cboSupl.set_text('검토중'); form.divSearch_btnSearch_onclick(form.divSearch.form.btnSearch,{});}catch{}

    const ds=form.ds_calOrdtmChckExeList;
    let selected=0;
    for(let i=0;i<ds.getRowCount();i++){
      const d=String(ds.getColumn(i,'decsnSn')||'');
      const st=String(ds.getColumn(i,'ordtmChckSuNm')||'');
      const hit=decsns.includes(d)&&st==='정상';
      ds.setColumn(i,'gridcmmcheck', hit?'1':'0');
      if(hit) selected++;
    }
    if(selected<1) return {ok:true,selected:0};
    form.BtnConfirm_onclick(form.BtnConfirm,{});
    try{form.fnConfirmCallback('confirmSaveCallback', true);}catch{}
    return {ok:true,selected};
  }, normals);

  await sleep(1400);
  await dismiss(page,10);

  // final snapshot
  await page.evaluate(()=>{
    const app=window._application; const frames=app?.gvWorkFrame?.frames; let form=null;
    for(let i=0;i<(frames?.length||0);i++){const f=frames[i]?.form?.divWork?.form; if(f?.name==='cal00202'){form=f;break;}}
    if(!form) return;
    const s=form.divSearch?.form;
    try{s.cboSupl.set_index(0);}catch{}
    try{form.divSearch_btnSearch_onclick(s.btnSearch,{});}catch{}
    try{form.btnTotSearch_onclick(form.btnTotSearch,{});}catch{}
  });
  for(let i=0;i<40;i++){
    const rc=await page.evaluate(()=>{const app=window._application; const frames=app?.gvWorkFrame?.frames; let form=null; for(let i=0;i<(frames?.length||0);i++){const f=frames[i]?.form?.divWork?.form; if(f?.name==='cal00202'){form=f;break;}} if(!form) return -1; return form.ds_calOrdtmChckExeList?.getRowCount?.() ?? -1;}).catch(()=>-1);
    if(rc>=750) break; await sleep(200);
  }

  const final=await page.evaluate((target)=>{
    const app=window._application; const frames=app?.gvWorkFrame?.frames; let form=null;
    for(let i=0;i<(frames?.length||0);i++){const f=frames[i]?.form?.divWork?.form; if(f?.name==='cal00202'){form=f;break;}}
    if(!form) return {ok:false};
    const ds=form.ds_calOrdtmChckExeList;
    const rows=[]; const seen={};
    for(let i=0;i<ds.getRowCount();i++){
      const rn=String(ds.getColumn(i,'rn')||'');
      if(!target.includes(rn)) continue;
      const key=String(ds.getColumn(i,'decsnSn')||'')||rn+'-'+String(ds.getColumn(i,'decsnTilTt')||'');
      if(seen[key]) continue; seen[key]=1;
      rows.push({rn,decsnSn:String(ds.getColumn(i,'decsnSn')||''),title:String(ds.getColumn(i,'decsnTilTt')||''),titNm:String(ds.getColumn(i,'titNm')||''),sePpoNm:String(ds.getColumn(i,'sePpoNm')||''),amount:String(ds.getColumn(i,'rscpSeAt')||''),status:String(ds.getColumn(i,'ordtmChckSuNm')||''),cpl:String(ds.getColumn(i,'ordtmChckCplSuNm')||''),chckD:String(ds.getColumn(i,'ordtmChckD')||'')});
    }
    rows.sort((a,b)=>Number(a.rn)-Number(b.rn));
    return {ok:true,rows,sum:{total:rows.length,normal:rows.filter(r=>r.status==='정상').length,unconfirmed:rows.filter(r=>r.status==='미확정').length,done:rows.filter(r=>r.cpl==='점검완료').length,reviewing:rows.filter(r=>r.cpl==='검토중').length},each:form.eachCnt?.text||'',tot:form.totCnt?.text||''};
  }, TARGET_RNS);

  const wb=XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(final.rows), '재판정35_최종상태');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(final.rows.slice(0,10)), '샘플10건');
  const outXlsx='projects/이지바로-재판정-35건-최종상태.xlsx';
  const outJson='projects/이지바로-재판정-35건-최종상태.json';
  XLSX.writeFile(wb,outXlsx);
  fs.writeFileSync(outJson, JSON.stringify({snapshot,confirm,final},null,2),'utf-8');

  console.log(JSON.stringify({ok:true,confirm,sum:final.sum,outXlsx,outJson,each:final.each,tot:final.tot},null,2));
 } finally {
  await browser.close().catch(()=>{});
 }
})();
