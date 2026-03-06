const { connectBrowser, sleep } = require('./lib/utils');

const TARGET_RNS = ['8','9','14','79','91','182','183','204','224','254','255','259','281','334','350','358','402','417','431','466','474','477','481','553','561','562','567','575','593','606','622','623','628','689','699'];

async function dismiss(page, rounds=8){
  for(let r=0;r<rounds;r++){
    await page.evaluate(()=>{
      const vis=el=>{const b=el.getBoundingClientRect(); const s=getComputedStyle(el); return b.width>0&&b.height>0&&s.display!=='none'&&s.visibility!=='hidden';};
      for(const el of [...document.querySelectorAll('*')]){
        if(el.childElementCount!==0||!vis(el)) continue;
        const t=(el.innerText||'').trim();
        if(t==='확인'||t==='OK'||t==='닫기') el.click();
      }
      try{
        const pops=nexacro.getPopupFrames? nexacro.getPopupFrames():[];
        for(let i=pops.length-1;i>=0;i--){
          const p=pops[i];
          try{p.form?.btn00?.click?.();}catch{}
          try{p.form?.btnOk?.click?.();}catch{}
          try{p.form?.btnClose?.click?.();}catch{}
        }
      }catch{}
    }).catch(()=>{});
    await sleep(220);
  }
}

(async()=>{
  process.env.CDP_HOST='100.87.3.123';
  const {browser,context}=await connectBrowser(9446);
  const page=context.pages()[0];

  const prep = await page.evaluate(()=>{
    const app=window._application; const frames=app?.gvWorkFrame?.frames; let form=null;
    for(let i=0;i<(frames?.length||0);i++){const f=frames[i]?.form?.divWork?.form; if(f?.name==='cal00202'){form=f;break;}}
    if(!form) return {ok:false,reason:'cal00202 not found'};
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
    return {ok:true};
  });
  await sleep(1400);

  const applied = await page.evaluate((targetRns)=>{
    const app=window._application; const frames=app?.gvWorkFrame?.frames; let form=null;
    for(let i=0;i<(frames?.length||0);i++){const f=frames[i]?.form?.divWork?.form; if(f?.name==='cal00202'){form=f;break;}}
    if(!form) return {ok:false,reason:'cal00202 not found'};
    const ds=form.ds_calOrdtmChckExeList;
    let selected=0;
    const found=[];

    for(let i=0;i<ds.getRowCount();i++){
      const rn=String(ds.getColumn(i,'rn')||'');
      const hit=targetRns.includes(rn);
      ds.setColumn(i,'gridcmmcheck', hit?'1':'0');
      if(hit){
        selected++;
        found.push({rn,title:String(ds.getColumn(i,'decsnTilTt')||''),status:String(ds.getColumn(i,'ordtmChckSuNm')||''),cpl:String(ds.getColumn(i,'ordtmChckCplSuNm')||'')});
      }
    }

    if(selected<1) return {ok:false,reason:'targets not found',selected,foundCount:found.length};

    form.cbo01.set_value('0003');
    form.cbo01.set_text('미확정');
    form.btnChckNotPass_onclick(form.btnChckNotPass,{});
    form.BtnSave_onclick(form.BtnSave,{});
    try{form.fnConfirmCallback('saveCallback', true);}catch{}

    return {ok:true,selected,found};
  }, TARGET_RNS);

  await sleep(1700);
  await dismiss(page,10);

  const verify = await page.evaluate((targetRns)=>{
    const app=window._application; const frames=app?.gvWorkFrame?.frames; let form=null;
    for(let i=0;i<(frames?.length||0);i++){const f=frames[i]?.form?.divWork?.form; if(f?.name==='cal00202'){form=f;break;}}
    if(!form) return {ok:false,reason:'cal00202 not found'};
    try{form.btnTotSearch_onclick(form.btnTotSearch,{});}catch{}
    const ds=form.ds_calOrdtmChckExeList;
    const rows=[];
    for(let i=0;i<ds.getRowCount();i++){
      const rn=String(ds.getColumn(i,'rn')||'');
      if(targetRns.includes(rn)) rows.push({rn,status:String(ds.getColumn(i,'ordtmChckSuNm')||''),cpl:String(ds.getColumn(i,'ordtmChckCplSuNm')||'')});
    }
    const bad=rows.filter(r=>r.status!=='미확정');
    return {ok:true,count:rows.length,badCount:bad.length,bad,rows};
  }, TARGET_RNS);

  console.log(JSON.stringify({prep,applied,verify},null,2));
  await browser.close().catch(()=>{});
})();
