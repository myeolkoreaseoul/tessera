const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');
const { connectBrowser, sleep } = require('./lib/utils');

const TARGET_RNS = ['8','9','14','79','91','182','183','204','224','254','255','259','281','334','350','358','402','417','431','466','474','477','481','553','561','562','567','575','593','606','622','623','628','689','699'];

function toNum(v){ return Number(String(v||'').replace(/[^0-9-]/g,'')) || 0; }

function analyzeFiles(fileNames, row) {
  const joined = fileNames.join(' | ');
  const hasInternal = /(지출결의|품의|내부.?결재|결의서)/i.test(joined) || /지출결의서/i.test(row.title || '');
  const hasContract = /(계약서|용역.?계약|의뢰서|과업지시|제안서|발주)/i.test(joined) || /(용역|컨설팅|지원사업|프로그램)/i.test(row.title || '');
  const hasResult = /(결과보고|최종보고|완료보고|보고서|검수|검사)/i.test(joined);
  const hasTaxOrPay = /(세금계산서|계산서|이체|거래내역|영수증|전표)/i.test(joined) || /(계산서|카드)/.test(row.proofNm || '');
  const amount = toNum(row.amount);

  let verdict = '미확정';
  let reason = '';

  // 엄격 기준: 고액은 결과서 필수, 중소액도 3종 충족 필요
  if (amount >= 30000000) {
    if (hasInternal && hasContract && hasTaxOrPay && hasResult) {
      verdict = '정상';
      reason = '고액건(3천만원 이상): 내부결재/계약·의뢰/결제증빙/결과보고 충족';
    } else {
      reason = '고액건 필수증빙(내부결재·계약·결제·결과보고) 미충족';
    }
  } else {
    if (hasInternal && hasContract && hasTaxOrPay) {
      verdict = '정상';
      reason = '내부결재/계약·의뢰/결제증빙 충족';
      if (!hasResult) reason += ' (결과보고 파일명 직접 식별은 불명확)';
    } else {
      reason = '필수증빙 3축(내부결재·계약·결제증빙) 미충족';
    }
  }

  return { verdict, reason, hasInternal, hasContract, hasResult, hasTaxOrPay };
}

async function dismiss(page, rounds=6){
  for(let r=0;r<rounds;r++){
    await page.evaluate(()=>{
      const vis=el=>{const b=el.getBoundingClientRect(); const s=getComputedStyle(el); return b.width>0&&b.height>0&&s.display!=='none'&&s.visibility!=='hidden';};
      for(const el of [...document.querySelectorAll('*')]){
        if(el.childElementCount!==0||!vis(el)) continue;
        const t=(el.innerText||'').trim();
        if(t==='확인'||t==='OK'||t==='닫기') el.click();
      }
      try{
        const pf=nexacro.getPopupFrames? nexacro.getPopupFrames():null;
        const len=pf?.length||0;
        for(let i=len-1;i>=0;i--){
          const p=pf[i];
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

  const logs=[];

  try {
    // clear filters + total search
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

    for(let i=0;i<40;i++){
      const rc=await page.evaluate(()=>{
        const app=window._application; const frames=app?.gvWorkFrame?.frames; let form=null;
        for(let i=0;i<(frames?.length||0);i++){const f=frames[i]?.form?.divWork?.form; if(f?.name==='cal00202'){form=f;break;}}
        if(!form) return -1;
        return form.ds_calOrdtmChckExeList?.getRowCount?.() ?? -1;
      }).catch(()=>-1);
      if(rc>=750) break;
      await sleep(250);
    }

    const candidates = await page.evaluate((targetRns)=>{
      const app=window._application; const frames=app?.gvWorkFrame?.frames; let form=null;
      for(let i=0;i<(frames?.length||0);i++){const f=frames[i]?.form?.divWork?.form; if(f?.name==='cal00202'){form=f;break;}}
      if(!form) return [];
      const ds=form.ds_calOrdtmChckExeList;
      const rows=[];
      const seen = new Set();
      for(let i=0;i<ds.getRowCount();i++){
        const rn=String(ds.getColumn(i,'rn')||'');
        if(!targetRns.includes(rn)) continue;
        const decsnSn=String(ds.getColumn(i,'decsnSn')||'');
        const key = decsnSn || `${rn}-${String(ds.getColumn(i,'decsnTilTt')||'')}`;
        if(seen.has(key)) continue;
        seen.add(key);
        rows.push({
          idx:i,
          rn,
          decsnSn,
          title:String(ds.getColumn(i,'decsnTilTt')||''),
          titNm:String(ds.getColumn(i,'titNm')||''),
          sePpoNm:String(ds.getColumn(i,'sePpoNm')||''),
          proofNm:String(ds.getColumn(i,'proofNm')||''),
          amount:String(ds.getColumn(i,'rscpSeAt')||''),
          status:String(ds.getColumn(i,'ordtmChckSuNm')||''),
          cpl:String(ds.getColumn(i,'ordtmChckCplSuNm')||''),
          fileCount:String(ds.getColumn(i,'fileCount')||''),
        });
      }
      rows.sort((a,b)=>Number(a.rn)-Number(b.rn));
      return rows;
    }, TARGET_RNS);

    for (const row of candidates) {
      // open popup
      await page.evaluate((idx)=>{
        const app=window._application; const frames=app?.gvWorkFrame?.frames; let form=null;
        for(let i=0;i<(frames?.length||0);i++){const f=frames[i]?.form?.divWork?.form; if(f?.name==='cal00202'){form=f;break;}}
        if(!form) return;
        try{
          const pf=nexacro.getPopupFrames? nexacro.getPopupFrames():null;
          const len=pf?.length||0;
          for(let i=len-1;i>=0;i--){const p=pf[i]; if((p.id||'').includes('filePopup')){ try{p.form?.btnClose?.click?.();}catch{} try{p.close?.();}catch{} }}
        }catch{}
        try{form.calOrdtmChckExeGrid_oncellclick(form.calOrdtmChckExeGrid,{row:idx,col:14});}catch{}
      }, row.idx);

      await sleep(700);

      const fileInfo = await page.evaluate(()=>{
        const vis=el=>{const b=el.getBoundingClientRect(); const s=getComputedStyle(el); return b.width>0&&b.height>0&&s.display!=='none'&&s.visibility!=='hidden';};
        const names=[...document.querySelectorAll('*')]
          .filter(el=>el.childElementCount===0 && vis(el))
          .map(el=>(el.innerText||'').trim())
          .filter(t=>/\.(pdf|hwp|hwpx|xlsx|xls|doc|docx|zip)$/i.test(t));
        const uniq=[]; const s=new Set();
        for(const n of names){ if(!s.has(n)){ s.add(n); uniq.push(n); } }
        return { fileNames: uniq };
      }).catch(()=>({fileNames:[]}));

      // close popup + dismiss alerts
      await page.evaluate(()=>{
        const vis=el=>{const b=el.getBoundingClientRect(); const s=getComputedStyle(el); return b.width>0&&b.height>0&&s.display!=='none'&&s.visibility!=='hidden';};
        const close=[...document.querySelectorAll('*')].find(el=>el.childElementCount===0&&vis(el)&&((el.innerText||'').trim()==='닫기'));
        if(close) close.click();
      }).catch(()=>{});
      await dismiss(page,3);

      const analysis = analyzeFiles(fileInfo.fileNames, row);

      let applied = false;
      if (analysis.verdict === '정상') {
        const res = await page.evaluate((idx)=>{
          const app=window._application; const frames=app?.gvWorkFrame?.frames; let form=null;
          for(let i=0;i<(frames?.length||0);i++){const f=frames[i]?.form?.divWork?.form; if(f?.name==='cal00202'){form=f;break;}}
          if(!form) return {ok:false,reason:'no form'};
          const ds=form.ds_calOrdtmChckExeList;
          for(let i=0;i<ds.getRowCount();i++) ds.setColumn(i,'gridcmmcheck','0');
          ds.setColumn(idx,'gridcmmcheck','1');
          form.cbo01.set_value('0001');
          form.cbo01.set_text('정상');
          form.btnChckNotPass_onclick(form.btnChckNotPass,{});
          form.BtnSave_onclick(form.BtnSave,{});
          try{form.fnConfirmCallback('saveCallback', true);}catch{}
          return {ok:true};
        }, row.idx).catch(e=>({ok:false,reason:e.message}));
        applied = !!res.ok;
        await sleep(700);
        await dismiss(page,5);
      }

      logs.push({
        ts: new Date().toISOString(),
        rn: row.rn,
        decsnSn: row.decsnSn,
        title: row.title,
        titNm: row.titNm,
        sePpoNm: row.sePpoNm,
        amount: row.amount,
        proofNm: row.proofNm,
        fileCountField: row.fileCount,
        fileNames: fileInfo.fileNames,
        ...analysis,
        applied,
      });
    }

    const outJson = path.join(process.cwd(), 'projects', '이지바로-재판정-35건-상세로그.json');
    const outXlsx = path.join(process.cwd(), 'projects', '이지바로-재판정-35건-상세로그.xlsx');

    const rows = logs.map((r, i)=>(
      {
        순번:i+1,
        RN:r.rn,
        결의순번:r.decsnSn,
        결의제목:r.title,
        비목:r.titNm,
        사용용도:r.sePpoNm,
        금액:r.amount,
        증빙구분:r.proofNm,
        파일수_필드:r.fileCountField,
        파일명_요약:r.fileNames.join(' | ').slice(0,1000),
        내부결재식별:r.hasInternal?'Y':'N',
        계약의뢰식별:r.hasContract?'Y':'N',
        결과서식별:r.hasResult?'Y':'N',
        결제증빙식별:r.hasTaxOrPay?'Y':'N',
        판정:r.verdict,
        판정사유:r.reason,
        화면반영:r.applied?'Y':'N',
      }
    ));

    fs.writeFileSync(outJson, JSON.stringify({summary:{total:logs.length,normal:logs.filter(x=>x.verdict==='정상').length,applied:logs.filter(x=>x.applied).length}, logs}, null, 2), 'utf-8');
    const wb=XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), '재판정35건');
    XLSX.writeFile(wb, outXlsx);

    console.log(JSON.stringify({ok:true,total:logs.length,normal:logs.filter(x=>x.verdict==='정상').length,applied:logs.filter(x=>x.applied).length,outJson,outXlsx},null,2));
  } finally {
    await browser.close().catch(()=>{});
  }
})();
