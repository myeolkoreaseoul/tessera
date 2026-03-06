const fs=require('fs');
const XLSX=require('xlsx');
const {connectBrowser,sleep}=require('./lib/utils');

const TARGET={taskNo:'RS-2025-02263117',ieNm:'진메디신',agency:'한국보건산업진흥원',year:'2025'};
const now=()=>new Date().toISOString();
const N=v=>Number(String(v||'').replace(/[^0-9-]/g,''))||0;

async function dismiss(page, rounds=10){
 for(let r=0;r<rounds;r++){
  await page.evaluate(()=>{
   const vis=el=>{const b=el.getBoundingClientRect();const s=getComputedStyle(el);return b.width>0&&b.height>0&&s.display!=='none'&&s.visibility!=='hidden';};
   for(const el of [...document.querySelectorAll('*')]){ if(el.childElementCount!==0||!vis(el)) continue; const t=(el.innerText||'').trim(); if(t==='확인'||t==='OK'||t==='닫기') el.click(); }
   try{const pf=nexacro.getPopupFrames? nexacro.getPopupFrames():null; const len=pf?.length||0; for(let i=len-1;i>=0;i--){const p=pf[i]; try{p.form?.btn00?.click?.();}catch{} try{p.form?.btnOk?.click?.();}catch{} try{p.form?.btnClose?.click?.();}catch{}} }catch{}
  }).catch(()=>{});
  await sleep(220);
 }
}

(async()=>{
 process.env.CDP_HOST='100.87.3.123';
 const {browser,context}=await connectBrowser(9446);
 const page=context.pages()[0];
 try{
  // if detail open -> list
  await page.evaluate(()=>{
    const app=window._application; const fr=app?.gvWorkFrame?.frames; const len=fr?.length||0;
    for(let i=0;i<len;i++){
      const f=fr[i]?.form?.divWork?.form;
      if(f?.name==='cal00202'){
        try{f.btnList_onclick(f.btnList,{});}catch{try{f.btnList.click();}catch{}}
      }
    }
  });
  await sleep(1200);

  // cal00201: taskNo only search, then pick ie row in list
  const open=await page.evaluate(({taskNo,ieNm,year})=>{
    const app=window._application; const fr=app?.gvWorkFrame?.frames; const len=fr?.length||0;
    let f=null;
    for(let i=0;i<len;i++){const x=fr[i]?.form?.divWork?.form; if(x?.name==='cal00201'){f=x;break;}}
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
    // 사업연도 필터(시작/종료 동일 연도)
    try{s.spinEtpStYs.set_value(year);}catch{}
    try{s.spinEtpEdYs.set_value(year);}catch{}
    try{s.chkOrdtmChckReprtCrtBjF.set_value('0');}catch{}

    try{f.divSearch_btnSearch_onclick(s.btnSearch,{});}catch{try{s.btnSearch.click();}catch{}}

    const ds=f.ds_calOrdtmChckList;
    const rc=ds?.getRowCount?.()||0;
    if(rc<1) return {ok:false,reason:'search0'};

    let idx=-1;
    for(let i=0;i<rc;i++){
      const ie=String(ds.getColumn(i,'ieNm')||'');
      const y=String(ds.getColumn(i,'etpYs')||'');
      if(ie.includes(ieNm) && y===String(year)) {idx=i;break;}
    }
    if(idx<0) return {ok:false,reason:'target ie/year not found',rc};

    try{ds.set_rowposition(idx);}catch{}
    try{f.calOrdtmChckGrid_oncelldblclick(f.calOrdtmChckGrid,{row:idx,col:0});}catch{}
    try{f.gfnExeDecsnListDtail();}catch{}
    return {
      ok:true,
      rc,
      idx,
      selected:{
        ieNm:String(ds.getColumn(idx,'ieNm')||''),
        taskNo:String(ds.getColumn(idx,'newTakN')||''),
        year:String(ds.getColumn(idx,'etpYs')||'')
      }
    };
  },TARGET);

  await sleep(1200);

  // cal00202 진입 재시도 (타이밍 이슈 대응)
  let entered = false;
  for (let t = 0; t < 6; t++) {
    const ok = await page.evaluate(() => {
      const app=window._application; const fr=app?.gvWorkFrame?.frames; const len=fr?.length||0;
      for (let i=0;i<len;i++) {
        const nm = fr[i]?.form?.divWork?.form?.name || '';
        if (nm === 'cal00202') return true;
      }
      return false;
    }).catch(() => false);
    if (ok) { entered = true; break; }

    await page.evaluate(({taskNo,ieNm,year}) => {
      const app=window._application; const fr=app?.gvWorkFrame?.frames; const len=fr?.length||0;
      let f=null;
      for(let i=0;i<len;i++){const x=fr[i]?.form?.divWork?.form; if(x?.name==='cal00201'){f=x;break;}}
      if(!f) return;
      const ds=f.ds_calOrdtmChckList; const rc=ds?.getRowCount?.()||0;
      let idx=-1;
      for(let i=0;i<rc;i++){
        const tNo=String(ds.getColumn(i,'newTakN')||'');
        const ie=String(ds.getColumn(i,'ieNm')||'');
        const y=String(ds.getColumn(i,'etpYs')||'');
        if(tNo===String(taskNo) && ie.includes(ieNm) && y===String(year)){idx=i;break;}
      }
      if(idx<0) return;
      try{ds.set_rowposition(idx);}catch{}
      try{f.calOrdtmChckGrid_oncelldblclick(f.calOrdtmChckGrid,{row:idx,col:0});}catch{}
      try{f.gfnExeDecsnListDtail();}catch{}
    }, TARGET).catch(()=>{});
    await sleep(900);
  }
  if (!entered) throw new Error('no cal00202');

  const before=await page.evaluate((year)=>{
    const app=window._application; const fr=app?.gvWorkFrame?.frames; const len=fr?.length||0;
    let f2=null; for(let i=0;i<len;i++){const x=fr[i]?.form?.divWork?.form; if(x?.name==='cal00202'){f2=x;break;}}
    if(!f2) return {ok:false,reason:'no cal00202'};
    const ds=f2.ds_calOrdtmChckExeList; const rc=ds?.getRowCount?.()||0;
    const rows=[];
    for(let i=0;i<rc;i++) rows.push({
      rn:String(ds.getColumn(i,'rn')||''),
      decsnSn:String(ds.getColumn(i,'decsnSn')||''),
      title:String(ds.getColumn(i,'decsnTilTt')||''),
      titNm:String(ds.getColumn(i,'titNm')||''),
      sePpoNm:String(ds.getColumn(i,'sePpoNm')||''),
      exeMt:String(ds.getColumn(i,'exeMtCCd')||''),
      proofNm:String(ds.getColumn(i,'proofNm')||''),
      fileCount:String(ds.getColumn(i,'fileCount')||''),
      splAt:String(ds.getColumn(i,'splAt')||''),
      exeSplAt:String(ds.getColumn(i,'exeSplAt')||''),
      vat:String(ds.getColumn(i,'vat')||''),
      exeVat:String(ds.getColumn(i,'exeVat')||''),
      status:String(ds.getColumn(i,'ordtmChckSuNm')||''),
      cpl:String(ds.getColumn(i,'ordtmChckCplSuNm')||''),
    });
    const sum={total:rows.length,unconfirmed:rows.filter(r=>r.status==='미확정').length,normal:rows.filter(r=>r.status==='정상').length,weak:rows.filter(r=>r.status==='미흡').length,reviewing:rows.filter(r=>r.cpl==='검토중').length,done:rows.filter(r=>r.cpl==='점검완료').length};
    return {
      ok:true,
      taskNo:String(app?.gdsSelTask?.getColumn?.(0,'newTakN')||''),
      ieNm:String(app?.gdsSelTask?.getColumn?.(0,'ieNm')||''),
      etpYs:String(app?.gdsSelTask?.getColumn?.(0,'etpYs')||''),
      rows,sum
    };
  }, TARGET.year);
  if(!before.ok) throw new Error(before.reason);
  if (String(before.taskNo)!==String(TARGET.taskNo)) throw new Error(`task mismatch: ${before.taskNo}`);
  if (!(String(before.ieNm).includes(TARGET.ieNm))) throw new Error(`ie mismatch: ${before.ieNm}`);

  const isForProfit=/\(주\)|주식회사/.test(before.ieNm||'');
  const targets=before.rows.filter(r=>r.status==='미확정');
  const normal=[],weak=[],keep=[];

  for(const r of targets){
    const inKind=/현물/.test(r.exeMt||'');
    const fileCnt=N(r.fileCount);
    const supply=N(r.splAt);
    const transfer=N(r.exeSplAt);

    if(inKind){
      normal.push({...r,decision:'정상',reason:'집행방법 현물 규칙 적용(증빙 부재 허용)'});
      continue;
    }

    if(isForProfit && supply>0 && transfer>0 && transfer>supply){
      weak.push({...r,decision:'미흡',reason:'영리기관 부가세 포함 집행(연구비이체금액>공급금액)'});
      continue;
    }

    if(fileCnt===0){
      weak.push({...r,decision:'미흡',reason:'증빙서류 미등록(fileCount=0)으로 필수 증빙 확인 불가'});
      continue;
    }

    keep.push({...r,decision:'미확정유지',reason:'명확한 미흡 사유 부재(인적검토 필요)'});
  }

  async function applyStatus(decsns,label){
    if(decsns.length<1) return {ok:true,selected:0,label};
    const res=await page.evaluate(({decsns,label})=>{
      const app=window._application; const fr=app?.gvWorkFrame?.frames; const len=fr?.length||0;
      let f2=null; for(let i=0;i<len;i++){const x=fr[i]?.form?.divWork?.form; if(x?.name==='cal00202'){f2=x;break;}}
      if(!f2) return {ok:false,reason:'no cal00202'};
      const ds=f2.ds_calOrdtmChckExeList; const rc=ds?.getRowCount?.()||0; let selected=0;
      for(let i=0;i<rc;i++){ const d=String(ds.getColumn(i,'decsnSn')||''); const hit=decsns.includes(d); ds.setColumn(i,'gridcmmcheck',hit?'1':'0'); if(hit) selected++; }
      if(selected>0){
        f2.cbo01.set_text(label);
        f2.btnChckNotPass_onclick(f2.btnChckNotPass,{});
        f2.BtnSave_onclick(f2.BtnSave,{});
        try{f2.fnConfirmCallback('saveCallback', true);}catch{}
      }
      return {ok:true,selected,label};
    },{decsns,label});
    await sleep(900); await dismiss(page,8);
    return res;
  }

  const applyNormal=await applyStatus(normal.map(x=>x.decsnSn),'정상');
  const applyWeak=await applyStatus(weak.map(x=>x.decsnSn),'미흡');

  const confirm=await page.evaluate(()=>{
    const app=window._application; const fr=app?.gvWorkFrame?.frames; const len=fr?.length||0;
    let f2=null; for(let i=0;i<len;i++){const x=fr[i]?.form?.divWork?.form; if(x?.name==='cal00202'){f2=x;break;}}
    if(!f2) return {ok:false,reason:'no cal00202'};
    const ds=f2.ds_calOrdtmChckExeList; const rc=ds?.getRowCount?.()||0; let selected=0;
    for(let i=0;i<rc;i++){
      const st=String(ds.getColumn(i,'ordtmChckSuNm')||'');
      const cpl=String(ds.getColumn(i,'ordtmChckCplSuNm')||'');
      const hit=(st==='정상'||st==='미흡')&&cpl==='검토중';
      ds.setColumn(i,'gridcmmcheck',hit?'1':'0');
      if(hit) selected++;
    }
    if(selected>0){ f2.BtnConfirm_onclick(f2.BtnConfirm,{}); try{f2.fnConfirmCallback('confirmSaveCallback', true);}catch{} }
    return {ok:true,selected};
  });

  await sleep(1200); await dismiss(page,10);

  const after=await page.evaluate(()=>{
    const app=window._application; const fr=app?.gvWorkFrame?.frames; const len=fr?.length||0;
    let f2=null; for(let i=0;i<len;i++){const x=fr[i]?.form?.divWork?.form; if(x?.name==='cal00202'){f2=x;break;}}
    if(!f2) return {ok:false,reason:'no cal00202'};
    const ds=f2.ds_calOrdtmChckExeList; const rc=ds?.getRowCount?.()||0;
    const rows=[];
    for(let i=0;i<rc;i++) rows.push({rn:String(ds.getColumn(i,'rn')||''),decsnSn:String(ds.getColumn(i,'decsnSn')||''),title:String(ds.getColumn(i,'decsnTilTt')||''),status:String(ds.getColumn(i,'ordtmChckSuNm')||''),cpl:String(ds.getColumn(i,'ordtmChckCplSuNm')||''),fileCount:String(ds.getColumn(i,'fileCount')||'')});
    const sum={total:rows.length,unconfirmed:rows.filter(r=>r.status==='미확정').length,normal:rows.filter(r=>r.status==='정상').length,weak:rows.filter(r=>r.status==='미흡').length,reviewing:rows.filter(r=>r.cpl==='검토중').length,done:rows.filter(r=>r.cpl==='점검완료').length};
    return {ok:true,sum,rows};
  });

  const stamp=now().replace(/[:.]/g,'-');
  const base=`projects/이지바로-진메디신-자동정산-${stamp}`;
  const outJson=`${base}.json`; const outXlsx=`${base}.xlsx`;

  const logRows=[...normal,...weak,...keep].map(r=>({전문기관:TARGET.agency,과제번호:TARGET.taskNo,수행기관:before.ieNm,순번:r.rn,결의순번:r.decsnSn,결의제목:r.title,비목:r.titNm,세목:r.sePpoNm,증빙유형:r.proofNm,fileCount:r.fileCount,공급금액:r.splAt,연구비이체금액:r.exeSplAt,처리결론:r.decision,처리사유:r.reason,처리시각:now()}));

  const result={target:TARGET,resolvedIeNm:before.ieNm,open,before:before.sum,plan:{normal:normal.length,weak:weak.length,keep:keep.length},applyNormal,applyWeak,confirm,after:after.sum,logs:logRows};
  fs.writeFileSync(outJson,JSON.stringify(result,null,2),'utf-8');
  const wb=XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb,XLSX.utils.json_to_sheet(logRows),'판정로그');
  XLSX.utils.book_append_sheet(wb,XLSX.utils.json_to_sheet([result.plan]),'판정요약');
  XLSX.utils.book_append_sheet(wb,XLSX.utils.json_to_sheet([after.sum]),'최종상태');
  XLSX.writeFile(wb,outXlsx);

  console.log(JSON.stringify({ok:true,outJson,outXlsx,result:{before:before.sum,plan:result.plan,applyNormal,applyWeak,confirm,after:after.sum}},null,2));

 } finally { await browser.close().catch(()=>{});} 
})();
