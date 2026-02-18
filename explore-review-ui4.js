/**
 * 그리드 컬럼 구조 및 편집 가능 여부 확인
 * + 행 더블클릭 시 동작 확인
 */
const { chromium } = require('playwright');

process.on('unhandledRejection', (err) => {
  if (err && err.message && err.message.includes('No dialog is showing')) return;
});

async function main() {
  const browser = await chromium.connectOverCDP('http://localhost:9444');
  const context = browser.contexts()[0];
  const page = context.pages().find(p => p.url().includes('dd001'));
  if (!page) { console.log('dd001 페이지 없음'); return; }
  page.on('dialog', async d => { try { await d.accept(); } catch {} });

  // 모달 닫기
  await page.evaluate(() => {
    document.querySelectorAll('.popupMask.on .fn.ok').forEach(b => b.click());
  });
  await new Promise(r => setTimeout(r, 500));

  // 1. 그리드 컬럼 정보
  const colInfo = await page.evaluate(() => {
    const grid = DD001002QGridObj;
    // 헤더 행의 컬럼 정보
    const headers = grid.getHeaderRows();
    const cols = [];
    if (headers && headers.length > 0) {
      for (let c = 0; c < 30; c++) {
        try {
          const val = grid.getValue(headers[0], c);
          if (val) cols.push({ idx: c, header: String(val).substring(0, 20) });
        } catch {}
      }
    }

    // 데이터 행의 값 (첫 행)
    const dataRows = grid.getDataRows();
    const firstRowVals = {};
    if (dataRows.length > 0) {
      const rv = grid.getRowValue(dataRows[0]);
      for (const [k, v] of Object.entries(rv)) {
        if (v !== null && v !== undefined && v !== '') {
          firstRowVals[k] = String(v).substring(0, 50);
        }
      }
    }

    return { cols, firstRowVals };
  });
  console.log('=== 헤더 컬럼 ===');
  colInfo.cols.forEach(c => console.log(`  Col${c.idx}: ${c.header}`));
  console.log('\n=== 첫 행 데이터 키 (값 있는 것만) ===');
  for (const [k, v] of Object.entries(colInfo.firstRowVals)) {
    console.log(`  ${k}: ${v}`);
  }

  // 2. 검토 관련 필드 확인 (excclcSeCode 라디오, 상태 드롭다운 등)
  const reviewFields = await page.evaluate(() => {
    const radios = document.querySelectorAll('input[name="excclcSeCode"]');
    const radioInfo = Array.from(radios).map(r => ({ value: r.value, label: (r.nextSibling?.textContent || r.parentElement?.textContent || '').trim().substring(0, 20), checked: r.checked }));

    const statusSel = document.getElementById('DD001002Q_excutLmttSttusCode');
    const statusOpts = statusSel ? Array.from(statusSel.options).map(o => ({ value: o.value, text: o.text })) : [];

    const resnSel = document.getElementById('DD001002Q_excutLmttResnCode');
    const resnOpts = resnSel ? Array.from(resnSel.options).map(o => ({ value: o.value, text: o.text })) : [];

    // exmntPrgstCode 관련
    const prgstSel = document.querySelector('[name="exmntPrgstCode"], #exmntPrgstCode');
    const prgstOpts = prgstSel ? Array.from(prgstSel.options).map(o => ({ value: o.value, text: o.text })) : [];

    // 검토의견 textarea
    const textareas = document.querySelectorAll('textarea');
    const taInfo = Array.from(textareas).map(t => ({ id: t.id, name: t.name, placeholder: t.placeholder, value: t.value.substring(0, 50) }));

    return { radioInfo, statusOpts, resnOpts, prgstOpts, taInfo };
  });
  console.log('\n=== 정산구분코드 라디오 ===');
  reviewFields.radioInfo.forEach(r => console.log(`  ${r.value}: ${r.label} ${r.checked ? '✓' : ''}`));
  console.log('\n=== 집행제한상태코드 ===');
  reviewFields.statusOpts.forEach(o => console.log(`  ${o.value}: ${o.text}`));
  console.log('\n=== 집행제한사유코드 ===');
  reviewFields.resnOpts.forEach(o => console.log(`  ${o.value}: ${o.text}`));
  console.log('\n=== 검토진행상태코드 ===');
  reviewFields.prgstOpts.forEach(o => console.log(`  ${o.value}: ${o.text}`));
  console.log('\n=== textarea ===');
  reviewFields.taInfo.forEach(t => console.log(`  id=${t.id} name=${t.name}`));

  // 3. 그리드에서 불인정금액/검토의견 편집 가능 여부
  const editableCheck = await page.evaluate(() => {
    const grid = DD001002QGridObj;
    const dataRows = grid.getDataRows();
    if (dataRows.length === 0) return 'no data rows';

    // nrcgnAmount (불인정금액) 셀 편집 시도
    try {
      const rv = grid.getRowValue(dataRows[0]);
      const origNrcgn = rv.nrcgnAmount;

      // setRowValue로 변경 가능한지
      grid.setRowValue(dataRows[0], { nrcgnAmount: 12345 });
      const afterSet = grid.getRowValue(dataRows[0]).nrcgnAmount;

      // 원복
      grid.setRowValue(dataRows[0], { nrcgnAmount: origNrcgn || '' });

      return { nrcgnEdit: 'setRowValue works', before: origNrcgn, after: afterSet };
    } catch (e) {
      return { error: e.message };
    }
  });
  console.log('\n=== 불인정금액 편집 테스트 ===');
  console.log(JSON.stringify(editableCheck));

  // 4. 행 더블클릭 시 동작 확인을 위한 이벤트 핸들러
  const dblClickHandler = await page.evaluate(() => {
    const grid = DD001002QGridObj;
    // SBGrid 이벤트 확인
    const events = {};
    for (const key of ['onDblClick', 'ondblclick', 'OnDblClick', 'onCellDblClick', 'OnCellDblClick']) {
      if (grid[key]) events[key] = String(grid[key]).substring(0, 200);
    }
    // SBGrid 이벤트 시스템
    if (typeof grid.getEventHandler === 'function') {
      try { events.dblclick = String(grid.getEventHandler('dblclick')).substring(0, 200); } catch {}
    }
    return events;
  });
  console.log('\n=== 더블클릭 이벤트 ===');
  console.log(JSON.stringify(dblClickHandler, null, 2));

  // 5. 검토완료처리 함수 전체 코드
  const batchFnFull = await page.evaluate(() => {
    return typeof f_registExcclcExmntBatch === 'function' ? f_registExcclcExmntBatch.toString() : 'not found';
  });
  console.log('\n=== f_registExcclcExmntBatch 전문 ===');
  console.log(batchFnFull.substring(0, 1500));
}

main().catch(console.error);
