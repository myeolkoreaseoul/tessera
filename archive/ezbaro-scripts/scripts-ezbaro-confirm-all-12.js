const fs=require('fs');
const { connectBrowser, sleep } = require('./lib/utils');
const TARGETS=['53019592','52966988','53019590','53009825','53009824','53009893','53009892','53472341','53019591','52966989','53010309','53009481'];

async function dismiss(page, rounds=10){
 for(let r=0;r<rounds;r++){
  await page.evaluate(()=>{
   const vis=el=>{const b=el.getBoundingClientRect(); const s=getComputedStyle(el); return b.width>0&&b.height>0&&s.display!=='none'&&s.visibility!=='hidden';};
   for(const el of [...document.querySelectorAll('*')]){
    if(el.childElementCount!==0||!vis(el)) continue;
    const t=(el.innerText||'').trim();
    if(t==='확인'||t==='OK'||t==='닫기') el.click();
   }
   try{const pf=nexacro.getPopupFrames? nexacro.getPopupFrames():null; const len=pf?.length||0; for(let i=len-1;i>=0;i--){const p=pf[i]; try{p.form?.btn00?.click?.();}catch{} try{p.form?.btnOk?.click?.();}catch{} try{p.form?.btnClose?.click?.();}catch{} }}catch{}
  }).catch(()=>{});
  await sleep(200);
 }
}

async function waitRows(page,min=850,loops=70){
 for(let i=0;i<loops;i++){
  const rc=await page.evaluate(()=>{const app=window._application; const frames=app?.gvWorkFrame?.frames; let form=null; for(let i=0;i<(frames?.length||0);i++){const f=frames[i]?.form?.divWork?.form; if(f?.name==='cal00202'){form=f;break;}} if(!form) return -1; return form.ds_calOrdtmChckExeList?.getRowCount?.() ?? -1;}).catch(()=>-1);
  if(rc>=min) return rc;
  await sleep(200);
 }
 return -1;
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
  await waitRows(page,850,80);

  const tries=[];
  for(let round=1;round<=3;round++){
    const res=await page.evaluate((targets)=>{
      const app=window._application; const frames=app?.gvWorkFrame?.frames; let form=null;
      for(let i=0;i<(frames?.length||0);i++){const f=frames[i]?.form?.divWork?.form; if(f?.name==='cal00202'){form=f;break;}}
      if(!form) return {ok:false,reason:'no form'};
      const ds=form.ds_calOrdtmChckExeList;
      let selected=0; const rows=[];
      for(let i=0;i<ds.getRowCount();i++){
        const d=String(ds.getColumn(i,'decsnSn')||'');
        const st=String(ds.getColumn(i,'ordtmChckSuNm')||'');
        const cpl=String(ds.getColumn(i,'ordtmChckCplSuNm')||'');
        const hit=targets.includes(d)&&st==='정상'&&cpl!=='점검완료';
        ds.setColumn(i,'gridcmmcheck',hit?'1':'0');
        if(targets.includes(d)) rows.push({rn:String(ds.getColumn(i,'rn')||''),decsnSn:d,st,cpl});
        if(hit) selected++;
      }
      if(selected>0){
        form.BtnConfirm_onclick(form.BtnConfirm,{});
        try{form.fnConfirmCallback('confirmSaveCallback', true);}catch{}
      }
      return {ok:true,selected,rows};
    },TARGETS);

    await sleep(1300);
    await dismiss(page,10);
    tries.push({round,...res});

    if((res.selected||0)===0) break;

    await page.evaluate(()=>{
      const app=window._application; const frames=app?.gvWorkFrame?.frames; let form=null;
      for(let i=0;i<(frames?.length||0);i++){const f=frames[i]?.form?.divWork?.form; if(f?.name==='cal00202'){form=f;break;}}
      if(!form) return;
      const s=form.divSearch?.form;
      try{s.cboSupl.set_index(0);}catch{}
      try{form.divSearch_btnSearch_onclick(s.btnSearch,{});}catch{}
      try{form.btnTotSearch_onclick(form.btnTotSearch,{});}catch{}
    });
    await waitRows(page,850,70);
  }

  const final=await page.evaluate((targets)=>{
    const app=window._application; const frames=app?.gvWorkFrame?.frames; let form=null;
    for(let i=0;i<(frames?.length||0);i++){const f=frames[i]?.form?.divWork?.form; if(f?.name==='cal00202'){form=f;break;}}
    if(!form) return {ok:false};
    const ds=form.ds_calOrdtmChckExeList;
    const rows=[];
    for(let i=0;i<ds.getRowCount();i++){
      const d=String(ds.getColumn(i,'decsnSn')||'');
      if(targets.includes(d)) rows.push({rn:String(ds.getColumn(i,'rn')||''),decsnSn:d,status:String(ds.getColumn(i,'ordtmChckSuNm')||''),cpl:String(ds.getColumn(i,'ordtmChckCplSuNm')||''),title:String(ds.getColumn(i,'decsnTilTt')||'')});
    }
    rows.sort((a,b)=>Number(a.rn)-Number(b.rn));
    return {ok:true,rows};
  },TARGETS);

  const sum={
    total:final.rows.length,
    normal:final.rows.filter(r=>r.status==='정상').length,
    unconfirmed:final.rows.filter(r=>r.status==='미확정').length,
    done:final.rows.filter(r=>r.cpl==='점검완료').length,
    reviewing:final.rows.filter(r=>r.cpl==='검토중').length,
  };

  const out={tries,final,sum,executedAt:new Date().toISOString()};
  fs.writeFileSync('projects/이지바로-12건-최종확인완료결과.json',JSON.stringify(out,null,2),'utf-8');
  console.log(JSON.stringify(out,null,2));
 } finally { await browser.close().catch(()=>{}); }
})();
