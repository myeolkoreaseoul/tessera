/**
 * 세부내역검토 버튼 클릭 후 열리는 화면 분석
 */
const { chromium } = require('playwright');

process.on('unhandledRejection', (err) => {
  if (err && err.message && err.message.includes('No dialog is showing')) return;
  console.error('Unhandled:', err.message);
});

async function main() {
  const browser = await chromium.connectOverCDP('http://localhost:9444');
  const context = browser.contexts()[0];
  const page = context.pages().find(p => p.url().includes('dd001'));
  if (!page) { console.log('dd001 페이지 없음'); return; }

  // 1. 세부내역검토 관련 함수 소스코드 확인
  const fnSrc = await page.evaluate(() => {
    const results = {};
    // 세부내역검토 버튼 onclick
    const btn = document.getElementById('DD001002Q_detlListExmnt');
    if (btn) {
      results.btnOnclick = btn.getAttribute('onclick') || '(no onclick attr)';
      // 이벤트 리스너 확인을 위해 클릭 동작 추적
    }
    // goDetailDetlBsnsInqire 함수
    if (typeof f_pjt_goDetailDetlBsnsInqire === 'function') {
      results.goDetail = f_pjt_goDetailDetlBsnsInqire.toString().substring(0, 500);
    }
    // goDetailDetlBsnsForm
    if (typeof goDetailDetlBsnsForm === 'function') {
      results.goForm = goDetailDetlBsnsForm.toString().substring(0, 500);
    }
    // f_pjt_goDetailDetlBsnsCallBack
    if (typeof f_pjt_goDetailDetlBsnsCallBack === 'function') {
      results.callBack = f_pjt_goDetailDetlBsnsCallBack.toString().substring(0, 500);
    }
    // 검토완료 처리
    if (typeof f_registExcclcExmntBatch === 'function') {
      results.exmntBatch = f_registExcclcExmntBatch.toString().substring(0, 500);
    }
    // 보완요청 처리
    if (typeof f_registExcclcExmntSplemnt === 'function') {
      results.splemnt = f_registExcclcExmntSplemnt.toString().substring(0, 500);
    }
    return results;
  });

  console.log('=== 세부내역검토 관련 함수 ===');
  for (const [k, v] of Object.entries(fnSrc)) {
    console.log(`\n--- ${k} ---`);
    console.log(v);
  }

  // 2. 그리드 첫 번째 행 선택 (클릭 시뮬레이션)
  console.log('\n=== 그리드 행 선택 시도 ===');
  const selectResult = await page.evaluate(() => {
    const grid = window.DD001002QGridObj;
    if (!grid) return 'grid not found';
    const rows = grid.getDataRows();
    if (rows.length === 0) return 'no rows';
    // 첫 번째 행 선택
    if (typeof grid.setSelectRow === 'function') {
      grid.setSelectRow(rows[0]);
      return 'setSelectRow called on row 0';
    }
    if (typeof grid.selectRow === 'function') {
      grid.selectRow(rows[0]);
      return 'selectRow called on row 0';
    }
    // SBGrid 방식
    const methods = Object.getOwnPropertyNames(Object.getPrototypeOf(grid)).filter(m => m.includes('select') || m.includes('Select') || m.includes('focus') || m.includes('Focus'));
    return 'select methods: ' + methods.join(', ');
  });
  console.log(selectResult);

  // 3. 그리드 선택 관련 메서드 확인
  const gridMethods = await page.evaluate(() => {
    const grid = window.DD001002QGridObj;
    if (!grid) return [];
    const proto = Object.getPrototypeOf(grid);
    return Object.getOwnPropertyNames(proto).filter(m =>
      m.includes('Row') || m.includes('row') || m.includes('select') || m.includes('click') ||
      m.includes('Cell') || m.includes('cell') || m.includes('check') || m.includes('Check')
    ).sort();
  });
  console.log('\n=== 그리드 Row/Select 메서드 ===');
  gridMethods.forEach(m => console.log('  ' + m));
}

main().catch(console.error);
