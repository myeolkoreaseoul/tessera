const fs=require('fs');
const { connectBrowser, sleep } = require('./lib/utils');
const TARGETS=['53010309','53019590','53019591','53019592'];

async function dismiss(page, rounds=10){
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
 try{
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
  for(let i=0;i<60;i++){
   const rc=await page.evaluate(()=>{const app=window._application; const frames=app?.gvWorkFrame?.frames; let form=null; for(let i=0;i<(frames?.length||0);i++){const f=frames[i]?.form?.divWork?.form; if(f?.name==='cal00202'){form=f;break;}} if(!form) return -1; return form.ds_calOrdtmChckExeList?.getRowCount?.() ?? -1;}).catch(()=>-1);
   if(rc>=850) break; await sleep(200);
  }

  const confirm=await page.evaluate((targets)=>{
   const app=window._application; const frames=app?.gvWorkFrame?.frames; let form=null;
   for(let i=0;i<(frames?.length||0);i++){const f=frames[i]?.form?.divWork?.form; if(f?.name==='cal00202'){form=f;break;}}
   if(!form) return {ok:false,reason:'no form'};
   const ds=form.ds_calOrdtmChckExeList;
   let selected=0; const found=[];
   for(let i=0;i<ds.getRowCount();i++){
    const d=String(ds.getColumn(i,'decsnSn')||'');
    const st=String(ds.getColumn(i,'ordtmChckSuNm')||'');
    const hit=targets.includes(d)&&st==='정상';
    ds.setColumn(i,'gridcmmcheck', hit?'1':'0');
    if(hit){selected++; found.push({rn:String(ds.getColumn(i,'rn')||''),decsnSn:d,st,cpl:String(ds.getColumn(i,'ordtmChckCplSuNm')||'')});}
   }
   if(selected<1) return {ok:true,selected:0,found};
   form.BtnConfirm_onclick(form.BtnConfirm,{});
   try{form.fnConfirmCallback('confirmSaveCallback', true);}catch{}
   return {ok:true,selected,found};
  },TARGETS);

  await sleep(1300);
  await dismiss(page,10);

  const snap=await page.evaluate((targets)=>{
   const app=window._application; const frames=app?.gvWorkFrame?.frames; let form=null;
   for(let i=0;i<(frames?.length||0);i++){const f=frames[i]?.form?.divWork?.form; if(f?.name==='cal00202'){form=f;break;}}
   if(!form) return {ok:false};
   const ds=form.ds_calOrdtmChckExeList;
   const rows=[];
   for(let i=0;i<ds.getRowCount();i++){
    const d=String(ds.getColumn(i,'decsnSn')||'');
    if(targets.includes(d)) rows.push({rn:String(ds.getColumn(i,'rn')||''),decsnSn:d,status:String(ds.getColumn(i,'ordtmChckSuNm')||''),cpl:String(ds.getColumn(i,'ordtmChckCplSuNm')||'')});
   }
   return {ok:true,rows};
  },TARGETS);

  const out={confirm,snap};
  fs.writeFileSync('projects/이지바로-미확정12-정상4-확인완료결과.json',JSON.stringify(out,null,2),'utf-8');
  console.log(JSON.stringify(out,null,2));
 } finally { await browser.close().catch(()=>{}); }
})();
