const fs=require('fs');
const XLSX=require('xlsx');
const { connectBrowser, sleep } = require('./lib/utils');

const TARGET_TASK='RS-2025-02220993';
const TARGET_IE='부산대학교한방병원';

async function dismiss(page, rounds=12){
  for(let r=0;r<rounds;r++){
    await page.evaluate(()=>{
      const vis=(el)=>{const b=el.getBoundingClientRect();const s=getComputedStyle(el);return b.width>0&&b.height>0&&s.display!=='none'&&s.visibility!=='hidden';};
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

  try{
    // 1) cal00201 검색 및 상세 진입
    const open=await page.evaluate(({taskNo,ieNm})=>{
      const app=window._application; const fr=app?.gvWorkFrame?.frames; const len=fr?.length||0;
      let form=null;
      for(let i=0;i<len;i++){const f=fr[i]?.form?.divWork?.form; if(f?.name==='cal00201'){form=f;break;}}
      if(!form) return {ok:false,reason:'no cal00201'};
      const s=form.divSearch?.form;
      try{s.chkOrdtmChckReprtCrtBjF.set_value('0');}catch{}
      try{s.edtNewTakN.set_value(taskNo);}catch{}
      try{s.edtIeNm.set_value('');}catch{}
      try{s.edtTakNm.set_value('');}catch{}
      try{form.divSearch_btnSearch_onclick(s.btnSearch,{});}catch{try{s.btnSearch.click();}catch{}}

      const ds=form.ds_calOrdtmChckList;
      const rc=ds?.getRowCount?.()||0;
      if(rc<1) return {ok:false,reason:'search 0'};
      let idx=-1;
      for(let i=0;i<rc;i++){
        const t=String(ds.getColumn(i,'newTakN')||'');
        const ie=String(ds.getColumn(i,'ieNm')||'');
        if(t===taskNo && ie.includes(ieNm)){idx=i;break;}
      }
      if(idx<0) idx=0;
      try{form.ds_calOrdtmChckList.set_rowposition(idx);}catch{}
      try{form.calOrdtmChckGrid_oncelldblclick(form.calOrdtmChckGrid,{row:idx,col:1});}catch(e){return {ok:false,reason:'dblclick fail '+e?.message};}
      return {ok:true,rc,idx};
    },{taskNo:TARGET_TASK,ieNm:TARGET_IE});

    await sleep(2000);

    // 2) cal00202 로딩 대기
    let ready=false;
    for(let i=0;i<40;i++){
      const ok=await page.evaluate(()=>{
        const app=window._application; const fr=app?.gvWorkFrame?.frames; const len=fr?.length||0;
        for(let i=0;i<len;i++){
          const f=fr[i]?.form?.divWork?.form;
          if(f?.name==='cal00202') return true;
        }
        return false;
      }).catch(()=>false);
      if(ok){ready=true;break;}
      await sleep(250);
    }
    if(!ready){
      throw new Error('cal00202 진입 실패');
    }

    // 3) 미확정 목록 수집
    const before=await page.evaluate(()=>{
      const app=window._application; const fr=app?.gvWorkFrame?.frames; const len=fr?.length||0;
      let f2=null;
      for(let i=0;i<len;i++){const f=fr[i]?.form?.divWork?.form; if(f?.name==='cal00202'){f2=f;break;}}
      if(!f2) return {ok:false};
      const ds=f2.ds_calOrdtmChckExeList;
      const rc=ds?.getRowCount?.()||0;
      const rows=[];
      for(let i=0;i<rc;i++){
        const status=String(ds.getColumn(i,'ordtmChckSuNm')||'');
        const cpl=String(ds.getColumn(i,'ordtmChckCplSuNm')||'');
        rows.push({
          idx:i,
          rn:String(ds.getColumn(i,'rn')||''),
          decsnSn:String(ds.getColumn(i,'decsnSn')||''),
          title:String(ds.getColumn(i,'decsnTilTt')||''),
          titNm:String(ds.getColumn(i,'titNm')||''),
          sePpoNm:String(ds.getColumn(i,'sePpoNm')||''),
          exeMt:String(ds.getColumn(i,'exeMtCNm')||ds.getColumn(i,'exeMtCCdNm')||''),
          amount:String(ds.getColumn(i,'rscpSeAt')||''),
          status,
          cpl,
        });
      }
      const unconfirmed=rows.filter(r=>r.status==='미확정');
      return {
        ok:true,
        ieNm:String(app?.gdsSelTask?.getColumn?.(0,'ieNm')||''),
        taskNo:String(app?.gdsSelTask?.getColumn?.(0,'newTakN')||''),
        total:rows.length,
        unconfirmed:unconfirmed.length,
        rows,
        unconfirmedRows:unconfirmed,
      };
    });

    // 4) 미확정 -> 정상 반영 (현물 포함 실무 규칙; 본 과제는 비영리기관)
    const apply=await page.evaluate(()=>{
      const app=window._application; const fr=app?.gvWorkFrame?.frames; const len=fr?.length||0;
      let f2=null;
      for(let i=0;i<len;i++){const f=fr[i]?.form?.divWork?.form; if(f?.name==='cal00202'){f2=f;break;}}
      if(!f2) return {ok:false,reason:'no cal00202'};
      const ds=f2.ds_calOrdtmChckExeList;
      const rc=ds?.getRowCount?.()||0;
      let selected=0;
      const picked=[];
      for(let i=0;i<rc;i++){
        const st=String(ds.getColumn(i,'ordtmChckSuNm')||'');
        const hit=st==='미확정';
        ds.setColumn(i,'gridcmmcheck',hit?'1':'0');
        if(hit){
          selected++;
          picked.push({rn:String(ds.getColumn(i,'rn')||''),decsnSn:String(ds.getColumn(i,'decsnSn')||''),st});
        }
      }
      if(selected<1) return {ok:true,selected:0,picked};
      f2.cbo01.set_value('0001');
      f2.cbo01.set_text('정상');
      f2.btnChckNotPass_onclick(f2.btnChckNotPass,{});
      f2.BtnSave_onclick(f2.BtnSave,{});
      try{f2.fnConfirmCallback('saveCallback', true);}catch{}
      return {ok:true,selected,picked};
    });

    await sleep(1300);
    await dismiss(page,12);

    // 5) 확인완료
    const confirm=await page.evaluate(()=>{
      const app=window._application; const fr=app?.gvWorkFrame?.frames; const len=fr?.length||0;
      let f2=null;
      for(let i=0;i<len;i++){const f=fr[i]?.form?.divWork?.form; if(f?.name==='cal00202'){f2=f;break;}}
      if(!f2) return {ok:false,reason:'no cal00202'};
      const ds=f2.ds_calOrdtmChckExeList;
      const rc=ds?.getRowCount?.()||0;
      let selected=0;
      for(let i=0;i<rc;i++){
        const st=String(ds.getColumn(i,'ordtmChckSuNm')||'');
        const cpl=String(ds.getColumn(i,'ordtmChckCplSuNm')||'');
        const hit=st==='정상' && cpl==='검토중';
        ds.setColumn(i,'gridcmmcheck',hit?'1':'0');
        if(hit) selected++;
      }
      if(selected>0){
        f2.BtnConfirm_onclick(f2.BtnConfirm,{});
        try{f2.fnConfirmCallback('confirmSaveCallback', true);}catch{}
      }
      return {ok:true,selected};
    });

    await sleep(1300);
    await dismiss(page,12);

    // 6) 최종 상태
    const after=await page.evaluate(()=>{
      const app=window._application; const fr=app?.gvWorkFrame?.frames; const len=fr?.length||0;
      let f2=null;
      for(let i=0;i<len;i++){const f=fr[i]?.form?.divWork?.form; if(f?.name==='cal00202'){f2=f;break;}}
      if(!f2) return {ok:false};
      const ds=f2.ds_calOrdtmChckExeList;
      const rc=ds?.getRowCount?.()||0;
      const rows=[];
      for(let i=0;i<rc;i++){
        rows.push({
          rn:String(ds.getColumn(i,'rn')||''),
          decsnSn:String(ds.getColumn(i,'decsnSn')||''),
          title:String(ds.getColumn(i,'decsnTilTt')||''),
          titNm:String(ds.getColumn(i,'titNm')||''),
          sePpoNm:String(ds.getColumn(i,'sePpoNm')||''),
          exeMt:String(ds.getColumn(i,'exeMtCNm')||ds.getColumn(i,'exeMtCCdNm')||''),
          amount:String(ds.getColumn(i,'rscpSeAt')||''),
          status:String(ds.getColumn(i,'ordtmChckSuNm')||''),
          cpl:String(ds.getColumn(i,'ordtmChckCplSuNm')||''),
        });
      }
      const sum={
        total:rows.length,
        unconfirmed:rows.filter(r=>r.status==='미확정').length,
        normal:rows.filter(r=>r.status==='정상').length,
        weak:rows.filter(r=>r.status==='미흡').length,
        reviewing:rows.filter(r=>r.cpl==='검토중').length,
        done:rows.filter(r=>r.cpl==='점검완료').length,
      };
      return {ok:true,rows,sum};
    });

    const now=new Date().toISOString().replace(/[:.]/g,'-');
    const outJson=`projects/이지바로-부산대병원-자동정산-${now}.json`;
    const outXlsx=`projects/이지바로-부산대병원-자동정산-${now}.xlsx`;

    const result={target:{taskNo:TARGET_TASK,ieNm:TARGET_IE},open,before,apply,confirm,after};
    fs.writeFileSync(outJson,JSON.stringify(result,null,2),'utf-8');
    const wb=XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb,XLSX.utils.json_to_sheet(after.rows||[]),'rows');
    XLSX.utils.book_append_sheet(wb,XLSX.utils.json_to_sheet([after.sum||{}]),'summary');
    XLSX.writeFile(wb,outXlsx);

    console.log(JSON.stringify({ok:true,outJson,outXlsx,before:before.sum||{total:before.total,unconfirmed:before.unconfirmed},apply,confirm,after:after.sum},null,2));
  } catch(e){
    console.error(JSON.stringify({ok:false,error:e.message},null,2));
    process.exit(1);
  } finally {
    await browser.close().catch(()=>{});
  }
})();
