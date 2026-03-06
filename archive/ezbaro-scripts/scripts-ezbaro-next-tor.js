const fs=require('fs');
const XLSX=require('xlsx');
const {connectBrowser,sleep}=require('./lib/utils');

const TARGET={taskNo:'RS-2025-02262990',ieNm:'토르 테라퓨틱스',year:'2025',agency:'한국보건산업진흥원'};
const ts=()=>new Date().toISOString();
const N=v=>Number(String(v||'').replace(/[^0-9-]/g,''))||0;

async function dismiss(page, rounds=8){
  for(let r=0;r<rounds;r++){
    await page.evaluate(()=>{
      const vis=el=>{const b=el.getBoundingClientRect();const s=getComputedStyle(el);return b.width>0&&b.height>0&&s.display!=='none'&&s.visibility!=='hidden';};
      for(const el of [...document.querySelectorAll('*')]){ if(el.childElementCount!==0||!vis(el)) continue; const t=(el.innerText||'').trim(); if(t==='확인'||t==='OK'||t==='닫기') el.click(); }
      try{const pf=nexacro.getPopupFrames? nexacro.getPopupFrames():null; const len=pf?.length||0; for(let i=len-1;i>=0;i--){const p=pf[i]; try{p.form?.btn00?.click?.();}catch{} try{p.form?.btnOk?.click?.();}catch{} try{p.form?.btnClose?.click?.();}catch{}} }catch{}
    }).catch(()=>{});
    await sleep(180);
  }
}

async function waitCal00202(page, timeoutMs=15000){
  const start=Date.now();
  while(Date.now()-start<timeoutMs){
    await dismiss(page, 2);
    const state=await page.evaluate(()=>{
      const app=window._application; const fr=app?.gvWorkFrame?.frames; const len=fr?.length||0;
      for(let i=0;i<len;i++){
        const f=fr[i]?.form?.divWork?.form;
        if(f?.name==='cal00202'){
          const ds=f.ds_calOrdtmChckExeList;
          return {ok:true,rowCount:ds?.getRowCount?.()||0};
        }
      }
      return {ok:false,rowCount:0};
    }).catch(()=>({ok:false,rowCount:0}));
    if(state.ok) return state;
    await sleep(500);
  }
  return {ok:false,rowCount:0};
}

async function ensureDetail(page){
  await page.evaluate(()=>{
    const app=window._application; const fr=app?.gvWorkFrame?.frames; const len=fr?.length||0;
    for(let i=0;i<len;i++){
      const f=fr[i]?.form?.divWork?.form;
      if(f?.name==='cal00202'){ try{f.btnList_onclick(f.btnList,{});}catch{try{f.btnList.click();}catch{}} }
    }
  });
  await sleep(900);
  await dismiss(page, 6);

  let open={ok:false,reason:'search0'};
  for(let attempt=0;attempt<8;attempt++){
    open=await page.evaluate(({taskNo,ieNm,year})=>{
    const app=window._application; const fr=app?.gvWorkFrame?.frames; const len=fr?.length||0;
    let f=null; for(let i=0;i<len;i++){const x=fr[i]?.form?.divWork?.form; if(x?.name==='cal00201'){f=x;break;}}
    if(!f) return {ok:false,reason:'no cal00201'};
    const s=f.divSearch?.form;
    try{s.cboTakSuCd.set_index(0);}catch{}
    try{s.cboTakCzCd.set_index(0);}catch{}
    try{s.cboCal.set_index(0);}catch{}
    try{s.cboSupl.set_index(0);}catch{}
    try{s.cboOrdtmChckF.set_index(0);}catch{}
    try{s.edtEtpCd.set_value('');}catch{}
    try{s.edtIeNm.set_value('');}catch{}
    try{s.edtTakNm.set_value('');}catch{}
    try{s.edtRseRspnber.set_value('');}catch{}
    try{s.edtAccnutIeNm.set_value('');}catch{}
    try{s.edtNewTakN.set_value(taskNo);}catch{}
    try{s.spinEtpStYs.set_value('');}catch{}
    try{s.spinEtpEdYs.set_value('');}catch{}
    try{s.chkOrdtmChckReprtCrtBjF.set_value('0');}catch{}
    try{f.divSearch_btnSearch_onclick(s.btnSearch,{});}catch{try{s.btnSearch.click();}catch{}}
    const ds=f.ds_calOrdtmChckList; const rc=ds?.getRowCount?.()||0;
    if(rc<1) return {ok:false,reason:'search0'};
    let idx=-1;
    for(let i=0;i<rc;i++){
      const t=String(ds.getColumn(i,'newTakN')||'');
      const ie=String(ds.getColumn(i,'ieNm')||'');
      const y=String(ds.getColumn(i,'etpYs')||'');
      if(t===taskNo && ie.includes(ieNm) && y===String(year)){idx=i;break;}
    }
    if(idx<0) return {ok:false,reason:'target row not found',rc};
    try{ds.set_rowposition(idx);}catch{}
    try{f.calOrdtmChckGrid_oncelldblclick(f.calOrdtmChckGrid,{row:idx,col:0});}catch{}
    try{f.gfnExeDecsnListDtail();}catch{}
    return {ok:true,idx,rc};
    },TARGET);
    if(open.ok) break;
    if(open.reason!=='search0') break;
    await sleep(500);
  }
  if(!open.ok) return open;

  for(let i=0;i<10;i++){
    const has=await page.evaluate(()=>{
      const app=window._application; const fr=app?.gvWorkFrame?.frames; const len=fr?.length||0;
      for(let i=0;i<len;i++) if((fr[i]?.form?.divWork?.form?.name||'')==='cal00202') return true;
      return false;
    }).catch(()=>false);
    if(has) return {ok:true};
    await dismiss(page, 3);
    await sleep(600);
    await page.evaluate(({taskNo,ieNm,year})=>{
      const app=window._application; const fr=app?.gvWorkFrame?.frames; const len=fr?.length||0;
      let f=null; for(let i=0;i<len;i++){const x=fr[i]?.form?.divWork?.form; if(x?.name==='cal00201'){f=x;break;}}
      if(!f) return;
      const ds=f.ds_calOrdtmChckList; const rc=ds?.getRowCount?.()||0;
      let idx=-1;
      for(let i=0;i<rc;i++){
        const t=String(ds.getColumn(i,'newTakN')||'');
        const ie=String(ds.getColumn(i,'ieNm')||'');
        const y=String(ds.getColumn(i,'etpYs')||'');
        if(t===taskNo && ie.includes(ieNm) && y===String(year)){idx=i;break;}
      }
      if(idx<0) return;
      try{ds.set_rowposition(idx);}catch{}
      try{f.calOrdtmChckGrid_oncelldblclick(f.calOrdtmChckGrid,{row:idx,col:0});}catch{}
      try{f.gfnExeDecsnListDtail();}catch{}
    },TARGET).catch(()=>{});
  }
  return {ok:false,reason:'no cal00202'};
}

(async()=>{
 process.env.CDP_HOST='100.87.3.123';
 const {browser,context}=await connectBrowser(9446);
 const page=context.pages()[0];
 try{
  const open=await ensureDetail(page);
  if(!open.ok) throw new Error(open.reason||'open fail');

  const base=await page.evaluate(()=>{
    const app=window._application; const fr=app?.gvWorkFrame?.frames; const len=fr?.length||0; let f2=null;
    for(let i=0;i<len;i++){const f=fr[i]?.form?.divWork?.form; if(f?.name==='cal00202'){f2=f;break;}}
    if(!f2) return {ok:false,reason:'no cal00202'};
    const ds=f2.ds_calOrdtmChckExeList; const rc=ds?.getRowCount?.()||0; const rows=[];
    for(let i=0;i<rc;i++) if(String(ds.getColumn(i,'ordtmChckSuNm')||'')==='미확정') rows.push({rn:String(ds.getColumn(i,'rn')||''),decsnSn:String(ds.getColumn(i,'decsnSn')||''),title:String(ds.getColumn(i,'decsnTilTt')||''),titNm:String(ds.getColumn(i,'titNm')||''),sePpoNm:String(ds.getColumn(i,'sePpoNm')||''),splAt:String(ds.getColumn(i,'splAt')||''),exeSplAt:String(ds.getColumn(i,'exeSplAt')||''),fileCount:String(ds.getColumn(i,'fileCount')||'')});
    return {ok:true,ieNm:String(app?.gdsSelTask?.getColumn?.(0,'ieNm')||''),taskNo:String(app?.gdsSelTask?.getColumn?.(0,'newTakN')||''),total:rc,rows};
  });
  if(!base.ok) throw new Error(base.reason);

  // for this institution apply clear rules only
  const forProfit=/\(주\)|주식회사/.test(base.ieNm||'');
  const normal=[]; const weak=[]; const keep=[];
  for(const r of base.rows){
    const supply=N(r.splAt), transfer=N(r.exeSplAt), fileCnt=N(r.fileCount);
    if(forProfit && supply>0 && transfer>supply) weak.push({...r,reason:'영리기관 부가세 포함 집행(연구비이체금액>공급금액)'});
    else if(fileCnt===0) weak.push({...r,reason:'증빙서류 미등록(fileCount=0)'});
    else normal.push({...r,reason:'증빙 존재 및 명시 위반사항 미발견'});
  }

  async function apply(decsns,label){
    if(decsns.length<1) return {ok:true,selected:0,label};
    const res=await page.evaluate(({decsns,label})=>{
      const app=window._application; const fr=app?.gvWorkFrame?.frames; const len=fr?.length||0; let f2=null;
      for(let i=0;i<len;i++){const f=fr[i]?.form?.divWork?.form; if(f?.name==='cal00202'){f2=f;break;}}
      if(!f2) return {ok:false};
      const ds=f2.ds_calOrdtmChckExeList; const rc=ds?.getRowCount?.()||0; let selected=0;
      for(let i=0;i<rc;i++){const d=String(ds.getColumn(i,'decsnSn')||''); const hit=decsns.includes(d); ds.setColumn(i,'gridcmmcheck',hit?'1':'0'); if(hit) selected++;}
      if(selected>0){f2.cbo01.set_text(label); f2.btnChckNotPass_onclick(f2.btnChckNotPass,{}); f2.BtnSave_onclick(f2.BtnSave,{}); try{f2.fnConfirmCallback('saveCallback', true);}catch{}}
      return {ok:true,selected,label};
    },{decsns,label});
    await sleep(700); await dismiss(page,8); return res;
  }

  const applyNormal=await apply(normal.map(x=>x.decsnSn),'정상');
  const applyWeak=await apply(weak.map(x=>x.decsnSn),'미흡');

  const confirm=await page.evaluate(()=>{
    const app=window._application; const fr=app?.gvWorkFrame?.frames; const len=fr?.length||0; let f2=null;
    for(let i=0;i<len;i++){const f=fr[i]?.form?.divWork?.form; if(f?.name==='cal00202'){f2=f;break;}}
    if(!f2) return {ok:false};
    const ds=f2.ds_calOrdtmChckExeList; const rc=ds?.getRowCount?.()||0; let selected=0;
    for(let i=0;i<rc;i++){const st=String(ds.getColumn(i,'ordtmChckSuNm')||''), c=String(ds.getColumn(i,'ordtmChckCplSuNm')||''); const hit=(st==='정상'||st==='미흡')&&c==='검토중'; ds.setColumn(i,'gridcmmcheck',hit?'1':'0'); if(hit) selected++;}
    if(selected>0){f2.BtnConfirm_onclick(f2.BtnConfirm,{}); try{f2.fnConfirmCallback('confirmSaveCallback', true);}catch{}}
    return {ok:true,selected};
  });
  await sleep(900); await dismiss(page,8);

  const after=await page.evaluate(()=>{
    const app=window._application; const fr=app?.gvWorkFrame?.frames; const len=fr?.length||0; let f2=null;
    for(let i=0;i<len;i++){const f=fr[i]?.form?.divWork?.form; if(f?.name==='cal00202'){f2=f;break;}}
    if(!f2) return {ok:false};
    const ds=f2.ds_calOrdtmChckExeList; const rc=ds?.getRowCount?.()||0; let un=0,n=0,w=0,rv=0,dn=0;
    for(let i=0;i<rc;i++){const st=String(ds.getColumn(i,'ordtmChckSuNm')||''), c=String(ds.getColumn(i,'ordtmChckCplSuNm')||''); if(st==='미확정') un++; if(st==='정상') n++; if(st==='미흡') w++; if(c==='검토중') rv++; if(c==='점검완료') dn++;}
    return {ok:true,sum:{total:rc,unconfirmed:un,normal:n,weak:w,reviewing:rv,done:dn}};
  });

  const outJson=`projects/이지바로-다음기관-토르테라퓨틱스-${ts().replace(/[:.]/g,'-')}.json`;
  const outXlsx=outJson.replace('.json','.xlsx');
  const logs=[...normal.map(r=>({...r,decision:'정상'})),...weak.map(r=>({...r,decision:'미흡'})),...keep.map(r=>({...r,decision:'미확정유지'}))];
  fs.writeFileSync(outJson,JSON.stringify({target:TARGET,resolved:{taskNo:base.taskNo,ieNm:base.ieNm},before:{total:base.total,unconfirmed:base.rows.length},plan:{normal:normal.length,weak:weak.length,keep:keep.length},applyNormal,applyWeak,confirm,after:after.sum,logs},null,2),'utf-8');
  const wb=XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb,XLSX.utils.json_to_sheet(logs.map(r=>({순번:r.rn,결의순번:r.decsnSn,결의제목:r.title,비목:r.titNm,세목:r.sePpoNm,처리결론:r.decision,처리사유:r.reason}))), '판정로그'); XLSX.utils.book_append_sheet(wb,XLSX.utils.json_to_sheet([after.sum]),'최종상태'); XLSX.writeFile(wb,outXlsx);
  console.log(JSON.stringify({ok:true,outJson,outXlsx,before:{total:base.total,unconfirmed:base.rows.length},plan:{normal:normal.length,weak:weak.length,keep:keep.length},applyNormal,applyWeak,confirm,after:after.sum},null,2));
 } finally { await browser.close().catch(()=>{});} 
})();
