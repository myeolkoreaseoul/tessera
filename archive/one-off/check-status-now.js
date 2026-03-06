const { chromium } = require('playwright');
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function main() {
  const browser = await chromium.connectOverCDP('http://localhost:9444');
  const context = browser.contexts()[0];
  const pages = context.pages();
  console.log(`탭: ${pages.length}개`);
  pages.forEach((p, i) => console.log(`  [${i}] ${p.url().substring(0, 80)}`));

  const page = pages.find(p => p.url().includes('dd001') || p.url().includes('gosims'));
  if (!page) {
    console.log('e나라도움 페이지 없음');
    return;
  }
  console.log('\nURL:', page.url());

  // 그리드 확인
  const gridInfo = await page.evaluate(() => {
    if (typeof DD001002QGridObj !== 'undefined') {
      const grid = DD001002QGridObj;
      const rows = grid.getDataRows();
      return {
        name: 'DD001002QGridObj',
        rows: rows.length,
        data: rows.slice(0, 10).map((r, i) => {
          const rv = grid.getRowValue(r);
          return { idx: i, purpose: rv.excutPrposCn, amount: rv.excutAmount || rv.excutSumAmount, status: rv.exmntPrgstNm || '' };
        }),
      };
    }
    return { name: 'none', rows: 0 };
  }).catch(() => ({ name: 'error', rows: 0 }));

  console.log(`\n그리드: ${gridInfo.name} (${gridInfo.rows}행)`);
  if (gridInfo.data) {
    gridInfo.data.forEach(r => console.log(`  [${r.idx}] ${r.purpose} | ${r.amount}원 | ${r.status}`));
  }

  // XHR로 전체 상태 확인
  console.log('\n--- XHR 전체 조회 ---');
  // 먼저 XHR 복원
  await page.evaluate(() => {
    const iframe = document.createElement('iframe');
    iframe.style.display = 'none';
    document.body.appendChild(iframe);
    XMLHttpRequest.prototype.open = iframe.contentWindow.XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.send = iframe.contentWindow.XMLHttpRequest.prototype.send;
    document.body.removeChild(iframe);
  });

  const result = await page.evaluate(() => {
    return new Promise((resolve) => {
      const token = document.querySelector("meta[name='_csrf']")?.content || '';
      const headerName = document.querySelector("meta[name='_csrf_header']")?.content || '';
      const p = new URLSearchParams({
        bsnsyear: document.getElementById('DD001002Q_bsnsyear')?.value || '',
        taskNo: document.getElementById('DD001002Q_taskNo')?.value || '',
        requstDeFrom: (document.getElementById('DD001002Q_requstDeFrom')?.value || '').replaceAll('-', ''),
        requstDeTo: (document.getElementById('DD001002Q_requstDeTo')?.value || '').replaceAll('-', ''),
        exmntPrgstCode: '',
        agremId: document.getElementById('DD001002Q_agremId')?.value || '',
        excInsttId: document.getElementById('DD001002Q_excInsttId')?.value || '',
        currentPageNum: '1', countPerPageNum: '50',
        excutAmountFrom: '0', excutAmountTo: '999999999999999',
      });
      const xhr = new XMLHttpRequest();
      xhr.open('POST', '/exe/dd/dd001/retrieveListBsnsExcutDetlList.do', true);
      xhr.setRequestHeader('Content-Type', 'application/x-www-form-urlencoded; charset=UTF-8');
      xhr.setRequestHeader('X-Requested-With', 'XMLHttpRequest');
      if (token && headerName) xhr.setRequestHeader(headerName, token);
      xhr.onload = () => { try { resolve(JSON.parse(xhr.responseText)); } catch { resolve(null); } };
      xhr.onerror = () => resolve(null);
      xhr.timeout = 10000;
      xhr.send(p.toString());
    });
  }).catch(() => null);

  if (result) {
    for (const [key, val] of Object.entries(result)) {
      if (Array.isArray(val)) {
        const cnt = {};
        val.forEach(item => { cnt[item.exmntPrgstNm || '?'] = (cnt[item.exmntPrgstNm || '?'] || 0) + 1; });
        console.log(`전체: ${val.length}건 — ${JSON.stringify(cnt)}`);
        break;
      }
    }
  } else {
    console.log('XHR 조회 실패');
  }
}

main().catch(console.error);
