/**
 * 핵심 함수 전문 확인
 */
const { chromium } = require('playwright');

process.on('unhandledRejection', (err) => {
  if (err && err.message && err.message.includes('No dialog is showing')) return;
});

async function main() {
  const browser = await chromium.connectOverCDP('http://localhost:9444');
  const context = browser.contexts()[0];
  let page = context.pages().find(p => p.url().includes('DD001003S') || p.url().includes('dd001003'));
  if (!page) page = context.pages().find(p => p.url().includes('dd001'));
  if (!page) { console.log('페이지 없음'); return; }
  page.on('dialog', async d => { try { await d.accept(); } catch {} });
  await page.evaluate(() => {
    document.querySelectorAll('.popupMask.on .fn.ok').forEach(b => b.click());
  });
  await new Promise(r => setTimeout(r, 300));

  // 1. f_changeExmntPrgst 전문
  console.log('=== f_changeExmntPrgst ===');
  const fn1 = await page.evaluate(() => {
    return typeof f_changeExmntPrgst === 'function' ? f_changeExmntPrgst.toString() : 'not found';
  });
  console.log(fn1);

  // 2. f_exclexRegist 전문 (저장 버튼)
  console.log('\n=== f_exclexRegist ===');
  const fn2 = await page.evaluate(() => {
    return typeof f_exclexRegist === 'function' ? f_exclexRegist.toString() : 'not found';
  });
  console.log(fn2);

  // 3. 그리드 생성 함수 (셀 클릭 이벤트 바인딩 포함)
  console.log('\n=== f_createGridDD001003S ===');
  const fn3 = await page.evaluate(() => {
    return typeof f_createGridDD001003S === 'function' ? f_createGridDD001003S.toString() : 'not found';
  });
  console.log(fn3);

  // 4. f_onloadDD001003S 전문
  console.log('\n=== f_onloadDD001003S ===');
  const fn4 = await page.evaluate(() => {
    return typeof f_onloadDD001003S === 'function' ? f_onloadDD001003S.toString() : 'not found';
  });
  console.log(fn4);

  // 5. 그리드 내 [등록] 클릭 이벤트 - IBSheet OnCellClick
  console.log('\n=== 그리드 OnCellClick 핸들러 탐색 ===');
  const clickHandler = await page.evaluate(() => {
    const grid = DD001003SGridObj;
    // IBSheet/SBGrid 이벤트 시스템
    const handlers = {};
    // 프로퍼티 순회
    for (const key of Object.getOwnPropertyNames(Object.getPrototypeOf(grid))) {
      if (key.toLowerCase().includes('click') || key.toLowerCase().includes('cell')) {
        try {
          const val = grid[key];
          if (typeof val === 'function') handlers[key] = val.toString().substring(0, 200);
        } catch {}
      }
    }
    // 직접 바인딩된 이벤트
    for (const key of Object.keys(grid)) {
      if (key.toLowerCase().includes('click') || key.toLowerCase().includes('event')) {
        try {
          const val = grid[key];
          if (typeof val === 'function') handlers['own_' + key] = val.toString().substring(0, 200);
          else if (val) handlers['own_' + key] = String(val).substring(0, 100);
        } catch {}
      }
    }
    return handlers;
  });
  console.log(JSON.stringify(clickHandler, null, 2));

  // 6. 불인정금액(nrcgnAmount) 입력 방법
  console.log('\n=== nrcgnAmount 편집 테스트 ===');
  const nrcgnTest = await page.evaluate(() => {
    const grid = DD001003SGridObj;
    const rows = grid.getDataRows();
    if (rows.length === 0) return 'no rows';
    const row0 = rows[0];
    const before = grid.getRowValue(row0);
    const origNrcgn = before.nrcgnAmount;
    try {
      grid.setRowValue(row0, { nrcgnAmount: 12345 });
      const after = grid.getRowValue(row0).nrcgnAmount;
      grid.setRowValue(row0, { nrcgnAmount: origNrcgn || 0 });
      return { before: origNrcgn, setTo: 12345, after, success: String(after) === '12345' };
    } catch (e) {
      return { error: e.message };
    }
  });
  console.log(JSON.stringify(nrcgnTest));

  // 7. 검토상태 변경 후 UI 변화 테스트 (실제로 변경하지 않고 확인만)
  console.log('\n=== pfrsChckSttusCode 값 매핑 ===');
  const codeMap = await page.evaluate(() => {
    // 콤보박스 데이터 확인
    if (typeof f_createPfrsChckSttusCodeCombo === 'function') {
      return f_createPfrsChckSttusCodeCombo.toString();
    }
    return 'not found';
  });
  console.log(codeMap.substring(0, 800));
}

main().catch(console.error);
