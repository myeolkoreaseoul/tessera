/**
 * f_clickExclex, f_gridFocusout 함수 확인
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

  const fns = await page.evaluate(() => {
    const result = {};
    const names = [
      'f_clickExclex', 'f_gridFocusout', 'f_retrieveExcutRequst',
      'f_retrieveExcutInfoMove', 'f_isEmpty',
    ];
    for (const n of names) {
      if (typeof window[n] === 'function') {
        result[n] = window[n].toString();
      }
    }

    // 목록 페이지의 그리드 데이터(DD001002Q)에서 현재 행 순서 확인
    if (typeof DD001002QGridData !== 'undefined') {
      result.listGridRowCount = DD001002QGridData.length;
      result.firstRow = DD001002QGridData[0] ? {
        excutPrposCn: DD001002QGridData[0].excutPrposCn,
        excutAmount: DD001002QGridData[0].excutAmount,
      } : null;
    }

    // 이전/다음 버튼의 moveChk 변수
    result.moveChk = typeof moveChk !== 'undefined' ? moveChk : 'undefined';

    // exmntPrgst 히든필드
    const exmntPrgst = document.getElementById('DD001003S_exmntPrgst');
    result.exmntPrgst = exmntPrgst ? exmntPrgst.value : 'element not found';

    // histSn
    const histSn = document.getElementById('DD001003S_histSn');
    result.histSn = histSn ? histSn.value : 'element not found';

    return result;
  });

  for (const [k, v] of Object.entries(fns)) {
    console.log(`\n=== ${k} ===`);
    console.log(typeof v === 'string' ? v : JSON.stringify(v, null, 2));
  }
}

main().catch(console.error);
