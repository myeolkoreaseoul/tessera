const { connectBrowser, sleep } = require('./lib/utils');

const TARGETS=['53019592','52966988','53019590','53009825','53009824','53009893','53009892','53472341','53019591','52966989','53010309','53009481'];

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
    if(rc>=750) break;
    await sleep(200);
  }
  const out=await page.evaluate((targets)=>{
    const app=window._application; const frames=app?.gvWorkFrame?.frames; let form=null;
    for(let i=0;i<(frames?.length||0);i++){const f=frames[i]?.form?.divWork?.form; if(f?.name==='cal00202'){form=f;break;}}
    if(!form) return {ok:false};
    const ds=form.ds_calOrdtmChckExeList;
    const rows=[];
    for(let i=0;i<ds.getRowCount();i++){
      const d=String(ds.getColumn(i,'decsnSn')||'');
      if(targets.includes(d)) rows.push({idx:i,rn:String(ds.getColumn(i,'rn')||''),decsnSn:d,status:String(ds.getColumn(i,'ordtmChckSuNm')||''),cpl:String(ds.getColumn(i,'ordtmChckCplSuNm')||'')});
    }
    return {ok:true,rowCount:ds.getRowCount(),rows};
  },TARGETS);
  console.log(JSON.stringify(out,null,2));
 } finally { await browser.close().catch(()=>{}); }
})();
