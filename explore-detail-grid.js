/**
 * 상세 페이지(DD001003S) 그리드 구조 심층 탐색
 * - 검토상태 드롭다운 조작 방법
 * - [등록] 링크 동작
 * - textarea + 보완요청내용 반영 메커니즘
 */
const { chromium } = require('playwright');

process.on('unhandledRejection', (err) => {
  if (err && err.message && err.message.includes('No dialog is showing')) return;
});

async function main() {
  const browser = await chromium.connectOverCDP('http://localhost:9444');
  const context = browser.contexts()[0];

  // 현재 페이지 확인 (상세 페이지인지 목록 페이지인지)
  let page = context.pages().find(p => p.url().includes('DD001003S') || p.url().includes('dd001003'));
  if (!page) {
    page = context.pages().find(p => p.url().includes('dd001'));
  }
  if (!page) { console.log('dd001 페이지 없음'); return; }
  page.on('dialog', async d => { try { await d.accept(); } catch {} });

  // 모달 닫기
  await page.evaluate(() => {
    document.querySelectorAll('.popupMask.on .fn.ok').forEach(b => b.click());
  });
  await new Promise(r => setTimeout(r, 500));

  const url = page.url();
  console.log('현재 URL:', url);

  // 목록 페이지면 상세로 이동
  if (!url.includes('DD001003S') && !url.includes('dd001003')) {
    console.log('목록 페이지 → 상세 페이지 이동 중...');
    await page.evaluate(() => {
      const grid = DD001002QGridObj;
      const rows = grid.getDataRows();
      if (rows.length > 0) grid.selectRow(rows[0]);
    });
    await new Promise(r => setTimeout(r, 500));
    await page.click('#DD001002Q_detlListExmnt');
    await new Promise(r => setTimeout(r, 3000));

    // 모달 체크
    const modal = await page.evaluate(() => {
      const mask = document.querySelector('.popupMask.on');
      return mask ? (mask.querySelector('.message')?.textContent?.trim() || 'modal') : null;
    });
    if (modal) {
      console.log('모달:', modal);
      await page.evaluate(() => {
        document.querySelectorAll('.popupMask.on .fn.ok').forEach(b => b.click());
      });
    }

    await page.waitForLoadState('domcontentloaded', { timeout: 10000 }).catch(() => {});
    await new Promise(r => setTimeout(r, 2000));
    console.log('상세 URL:', page.url());
  }

  // === 1. DD001003SGridObj 컬럼 구조 ===
  console.log('\n=== 1. DD001003SGridObj 컬럼/데이터 ===');
  const gridInfo = await page.evaluate(() => {
    if (typeof DD001003SGridObj === 'undefined') return 'DD001003SGridObj not found';
    const grid = DD001003SGridObj;
    const rows = grid.getDataRows();
    const result = { rowCount: rows.length, rows: [] };

    for (let i = 0; i < Math.min(rows.length, 5); i++) {
      const rv = grid.getRowValue(rows[i]);
      result.rows.push(rv);
    }

    // 컬럼 이름들
    const headers = grid.getHeaderRows();
    const cols = [];
    if (headers && headers.length > 0) {
      for (let c = 0; c < 40; c++) {
        try {
          const val = grid.getValue(headers[0], c);
          if (val) cols.push({ idx: c, name: String(val).substring(0, 30) });
        } catch {}
      }
    }
    result.cols = cols;
    return result;
  });
  console.log('행수:', typeof gridInfo === 'string' ? gridInfo : gridInfo.rowCount);
  if (typeof gridInfo === 'object') {
    console.log('\n컬럼:');
    (gridInfo.cols || []).forEach(c => console.log(`  Col${c.idx}: ${c.name}`));
    console.log('\n행 데이터 (주요 필드):');
    gridInfo.rows.forEach((rv, i) => {
      const keys = Object.keys(rv).filter(k => rv[k] !== null && rv[k] !== undefined && rv[k] !== '');
      console.log(`  Row${i}:`, JSON.stringify(
        Object.fromEntries(keys.map(k => [k, String(rv[k]).substring(0, 40)])),
        null, 2
      ));
    });
  }

  // === 2. 검토상태 관련 필드 탐색 ===
  console.log('\n=== 2. 검토상태(exmnt) 관련 ===');
  const exmntInfo = await page.evaluate(() => {
    const grid = DD001003SGridObj;
    const rows = grid.getDataRows();
    if (rows.length === 0) return 'no rows';

    const rv = grid.getRowValue(rows[0]);
    // exmnt 관련 키 찾기
    const exmntKeys = Object.keys(rv).filter(k =>
      k.toLowerCase().includes('exmnt') || k.toLowerCase().includes('prgst') ||
      k.toLowerCase().includes('status') || k.toLowerCase().includes('sttu')
    );

    // 그리드 내 select(콤보) 컬럼 찾기
    const comboInfo = [];
    try {
      // SBGrid에서 콤보 컬럼 확인
      for (let c = 0; c < 30; c++) {
        try {
          const type = grid.getColumnType ? grid.getColumnType(c) : null;
          const prop = grid.getColumnProperty ? grid.getColumnProperty(c) : null;
          if (type || prop) comboInfo.push({ col: c, type, prop: String(prop).substring(0, 50) });
        } catch {}
      }
    } catch {}

    return { exmntKeys, exmntValues: exmntKeys.map(k => ({ key: k, val: rv[k] })), comboInfo };
  });
  console.log(JSON.stringify(exmntInfo, null, 2));

  // === 3. setRowValue로 검토상태 변경 가능 여부 ===
  console.log('\n=== 3. setRowValue 테스트 ===');
  const setTest = await page.evaluate(() => {
    const grid = DD001003SGridObj;
    const rows = grid.getDataRows();
    if (rows.length === 0) return 'no rows';
    const row0 = rows[0];
    const rv = grid.getRowValue(row0);

    // 검토상태 관련 필드 찾기
    const stFields = Object.keys(rv).filter(k =>
      k.toLowerCase().includes('exmnt') || k.toLowerCase().includes('prgst')
    );

    const results = {};
    for (const f of stFields) {
      const orig = rv[f];
      try {
        const testVal = orig === '001' ? '002' : '001';
        grid.setRowValue(row0, { [f]: testVal });
        const after = grid.getRowValue(row0)[f];
        grid.setRowValue(row0, { [f]: orig }); // 원복
        results[f] = { orig, testVal, after, success: after === testVal };
      } catch (e) {
        results[f] = { orig, error: e.message };
      }
    }
    return results;
  });
  console.log(JSON.stringify(setTest, null, 2));

  // === 4. [등록] TD 요소 상세 ===
  console.log('\n=== 4. [등록] 요소 상세 ===');
  const regInfo = await page.evaluate(() => {
    // IBTextUnderline 클래스를 가진 TD 중 "등록" 텍스트
    const tds = document.querySelectorAll('td.IBTextUnderline, td[class*="IBTextUnderline"]');
    const found = [];
    tds.forEach(td => {
      if (td.textContent.trim().includes('등록')) {
        found.push({
          text: td.textContent.trim(),
          id: td.id,
          className: td.className.substring(0, 80),
          onclick: td.getAttribute('onclick') || '',
          parentId: td.parentElement?.id || '',
          parentClass: td.parentElement?.className?.substring(0, 40) || '',
          // 인근 셀 확인
          prevSibling: td.previousElementSibling?.textContent?.trim()?.substring(0, 30) || '',
          nextSibling: td.nextElementSibling?.textContent?.trim()?.substring(0, 30) || '',
          rowIndex: td.closest('tr')?.rowIndex,
        });
      }
    });

    // 그리드 내 등록 셀 찾기 (SBGrid)
    const gridCells = [];
    const allTds = document.querySelectorAll('#DD001003SGridObj td, [id*="DD001003S"] td');
    allTds.forEach(td => {
      if (td.textContent.trim() === '등록') {
        gridCells.push({
          text: td.textContent.trim(),
          id: td.id,
          className: td.className.substring(0, 80),
          parentId: td.parentElement?.id || '',
        });
      }
    });

    return { underlineTds: found, gridCells };
  });
  console.log(JSON.stringify(regInfo, null, 2));

  // === 5. 일괄 검토완료/보완요청 함수 ===
  console.log('\n=== 5. 일괄 처리 함수 ===');
  const batchFns = await page.evaluate(() => {
    const result = {};
    // 일괄 검토완료 버튼의 onclick
    const btn1 = document.getElementById('DD001003S_btnExmntPrgst001');
    if (btn1) result.btn검토완료 = { text: btn1.textContent.trim(), onclick: btn1.getAttribute('onclick') || '' };

    // 일괄 보완요청
    const btn2 = document.getElementById('DD001003S_btnExmntPrgst002');
    if (btn2) result.btn보완요청 = { text: btn2.textContent.trim(), onclick: btn2.getAttribute('onclick') || '' };

    // 보완요청내용 반영
    const btn3 = document.getElementById('DD001003S_btnExclexCnApply');
    if (btn3) result.btn반영 = { text: btn3.textContent.trim(), onclick: btn3.getAttribute('onclick') || '' };

    // 관련 JS 함수
    const fnNames = ['f_exmntPrgst', 'f_registExmntPrgst', 'f_exclexCnApply', 'f_saveDD001003S',
      'f_registExcclcExmntBatch', 'f_registExcclcExmntSplemnt'];
    for (const fn of fnNames) {
      if (typeof window[fn] === 'function') {
        result[fn] = window[fn].toString().substring(0, 500);
      }
    }

    return result;
  });
  console.log(JSON.stringify(batchFns, null, 2));

  // === 6. textarea 상태 ===
  console.log('\n=== 6. textarea 상태 ===');
  const taInfo = await page.evaluate(() => {
    const ta1 = document.getElementById('DD001003S_exclexCn');
    const ta2 = document.getElementById('DD001003S_lwprtexclexCn');
    return {
      exclexCn: ta1 ? {
        visible: ta1.offsetHeight > 0,
        disabled: ta1.disabled,
        readOnly: ta1.readOnly,
        value: ta1.value.substring(0, 100),
        display: ta1.style.display,
        parentDisplay: ta1.parentElement?.style?.display || '',
      } : 'not found',
      lwprtexclexCn: ta2 ? {
        visible: ta2.offsetHeight > 0,
        disabled: ta2.disabled,
        readOnly: ta2.readOnly,
        value: ta2.value.substring(0, 100),
      } : 'not found',
    };
  });
  console.log(JSON.stringify(taInfo, null, 2));

  // === 7. 저장/이전페이지 함수 ===
  console.log('\n=== 7. 저장/이전페이지 함수 ===');
  const navFns = await page.evaluate(() => {
    const result = {};
    const fnNames = ['f_save', 'f_saveDD001003S', 'f_prevPage', 'f_btnPrevPage', 'f_btnSave'];
    for (const fn of fnNames) {
      if (typeof window[fn] === 'function') {
        result[fn] = window[fn].toString().substring(0, 300);
      }
    }
    // 버튼 onclick 직접 확인
    const saveBtn = document.getElementById('DD001003S_btnSave');
    if (saveBtn) result.saveBtnOnclick = saveBtn.getAttribute('onclick') || 'no onclick attr';
    const prevBtn = document.getElementById('DD001003S_btnPrevPage');
    if (prevBtn) result.prevBtnOnclick = prevBtn.getAttribute('onclick') || 'no onclick attr';
    return result;
  });
  console.log(JSON.stringify(navFns, null, 2));
}

main().catch(console.error);
