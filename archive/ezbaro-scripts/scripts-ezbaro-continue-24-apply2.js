const fs=require('fs');
const { connectBrowser, sleep } = require('./lib/utils');

(async()=>{
  const j=JSON.parse(fs.readFileSync('projects/이지바로-재판정-24건-진행로그.json','utf-8'));
  function toNum(v){return Number(String(v||'').replace(/[^0-9-]/g,''))||0;}
  const targets=[];
  for(const r of j.logs){
    const joined=(r.fileNames||[]).join(' | ');
    const hasInternal=/(지출결의|품의|내부.?결재|결의서)/i.test(joined)||/지출결의서/i.test(r.title||'');
    const hasContract=/(계약서|용역.?계약|용역|계약 체결|과업지시|제안서|의뢰|발주)/i.test(joined);
    const hasResult=/(결과보고|최종보고|완료보고|검수|결과서|최종평가회)/i.test(joined);
    const hasPay=/(세금계산서|계산서|이체|영수증|전표|거래내역|입금|송금|외화송금신청서)/i.test(joined)||/(계산서|카드)/.test(r.proof||'');
    const orgRisk=/(국가신약개발재단|국가신약개발사업단)/.test(r.institute||'')&&/(국가신약개발재단|국가신약개발사업단)/.test(r.receiver||'');
    const amount=toNum(r.amount);
    let v='미확정';
    if(orgRisk||amount>=20000000){ if(hasInternal&&hasPay&&(hasContract||hasResult)) v='정상'; }
    else { if(hasInternal&&hasPay&&(hasContract||hasResult)) v='정상'; }
    if(v==='정상') targets.push({decsnSn:String(r.decsnSn),rn:r.rn,title:r.title,reason:'정교화2차: 내부결재+결제증빙+(계약/결과)'});
  }

  async function dismiss(page, rounds=6){
    for(let r=0;r<rounds;r++){
      await page.evaluate(()=>{
        const vis=el=>{const b=el.getBoundingClientRect(); const s=getComputedStyle(el); return b.width>0&&b.height>0&&s.display!=='none'&&s.visibility!=='hidden';};
        for(const el of [...document.querySelectorAll('*')]){ if(el.childElementCount!==0||!vis(el)) continue; const t=(el.innerText||'').trim(); if(t==='확인'||t==='OK') el.click(); }
        try{const pf=nexacro.getPopupFrames? nexacro.getPopupFrames():null; const len=pf?.length||0; for(let i=len-1;i>=0;i--){const p=pf[i]; try{p.form?.btn00?.click?.();}catch{} try{p.form?.btnOk?.click?.();}catch{} }}catch{}
      }).catch(()=>{});
      await sleep(200);
    }
  }

  process.env.CDP_HOST='100.87.3.123';
  const {browser,context}=await connectBrowser(9446);
  const page=context.pages()[0];

  try {
    await page.evaluate(()=>{
      const app=window._application; const frames=app?.gvWorkFrame?.frames; let form=null;
      for(let i=0;i<(frames?.length||0);i++){const f=frames[i]?.form?.divWork?.form; if(f?.name==='cal00202'){form=f;break;}}
      if(form){
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
      }
    });
    for(let i=0;i<45;i++){
      const rc=await page.evaluate(()=>{const app=window._application; const frames=app?.gvWorkFrame?.frames; let form=null; for(let i=0;i<(frames?.length||0);i++){const f=frames[i]?.form?.divWork?.form; if(f?.name==='cal00202'){form=f;break;}} if(!form) return -1; return form.ds_calOrdtmChckExeList?.getRowCount?.() ?? -1;}).catch(()=>-1);
      if(rc>=750) break; await sleep(200);
    }

    const decsns=targets.map(t=>t.decsnSn);
    const apply=await page.evaluate((decsns)=>{
      const app=window._application; const frames=app?.gvWorkFrame?.frames; let form=null;
      for(let i=0;i<(frames?.length||0);i++){const f=frames[i]?.form?.divWork?.form; if(f?.name==='cal00202'){form=f;break;}}
      if(!form) return {ok:false,reason:'no form'};
      const ds=form.ds_calOrdtmChckExeList;
      let selected=0, found=[];
      for(let i=0;i<ds.getRowCount();i++){
        const d=String(ds.getColumn(i,'decsnSn')||'');
        const hit=decsns.includes(d);
        ds.setColumn(i,'gridcmmcheck', hit?'1':'0');
        if(hit){selected++; found.push({decsnSn:d,rn:String(ds.getColumn(i,'rn')||''),status:String(ds.getColumn(i,'ordtmChckSuNm')||'')});}
      }
      if(selected<1) return {ok:false,reason:'selected0'};
      form.cbo01.set_value('0001');
      form.cbo01.set_text('정상');
      form.btnChckNotPass_onclick(form.btnChckNotPass,{});
      form.BtnSave_onclick(form.BtnSave,{});
      try{form.fnConfirmCallback('saveCallback', true);}catch{}
      return {ok:true,selected,found};
    }, decsns);

    await sleep(1200);
    await dismiss(page,8);

    const verify=await page.evaluate((decsns)=>{
      const app=window._application; const frames=app?.gvWorkFrame?.frames; let form=null;
      for(let i=0;i<(frames?.length||0);i++){const f=frames[i]?.form?.divWork?.form; if(f?.name==='cal00202'){form=f;break;}}
      if(!form) return {ok:false};
      const ds=form.ds_calOrdtmChckExeList;
      const rows=[];
      for(let i=0;i<ds.getRowCount();i++){
        const d=String(ds.getColumn(i,'decsnSn')||'');
        if(decsns.includes(d)) rows.push({decsnSn:d,rn:String(ds.getColumn(i,'rn')||''),status:String(ds.getColumn(i,'ordtmChckSuNm')||''),cpl:String(ds.getColumn(i,'ordtmChckCplSuNm')||'')});
      }
      return {ok:true,count:rows.length,normal:rows.filter(r=>r.status==='정상').length,rows};
    }, decsns);

    const out={targets,apply,verify};
    fs.writeFileSync('projects/이지바로-재판정-24건-2차적용결과.json',JSON.stringify(out,null,2),'utf-8');
    console.log(JSON.stringify({ok:true,targetCount:targets.length,apply:apply.ok?apply.selected:0,verifyNormal:verify.normal,out:'projects/이지바로-재판정-24건-2차적용결과.json'},null,2));
  } finally {
    await browser.close().catch(()=>{});
  }
})();
