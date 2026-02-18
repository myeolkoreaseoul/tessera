/**
 * 1) 오염된 XHR.send 복원
 * 2) 직접 XHR로 검토완료/전체 조회
 */
const { chromium } = require('playwright');

process.on('unhandledRejection', () => {});
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function main() {
  const browser = await chromium.connectOverCDP('http://localhost:9444');
  const context = browser.contexts()[0];
  let page = context.pages().find(p => p.url().includes('dd001'));
  if (!page) { console.log('페이지 없음'); return; }

  // Step 1: XHR 원본 복원 (페이지 리로드 없이)
  // 오염된 send를 원래 send로 복원하는 방법: 새로운 iframe에서 pristine send를 가져옴
  await page.evaluate(() => {
    // 이전 인터셉트에서 _capturedAjax를 삭제했지만 send는 패치된 상태
    // iframe을 만들어 pristine send를 가져옴
    const iframe = document.createElement('iframe');
    iframe.style.display = 'none';
    document.body.appendChild(iframe);
    const pristineXHR = iframe.contentWindow.XMLHttpRequest;
    XMLHttpRequest.prototype.open = pristineXHR.prototype.open;
    XMLHttpRequest.prototype.send = pristineXHR.prototype.send;
    document.body.removeChild(iframe);
    console.log('XHR 복원 완료');
  });

  console.log('XHR 복원됨\n');

  // Step 2: 직접 XHR 조회
  for (const filter of ['001', '', '002']) {
    console.log(`=== 필터: ${filter || '전체'} ===`);

    const result = await page.evaluate((filterCode) => {
      return new Promise((resolve) => {
        const token = document.querySelector("meta[name='_csrf']")?.content || '';
        const headerName = document.querySelector("meta[name='_csrf_header']")?.content || '';

        const p = new URLSearchParams({
          bsnsyear: document.getElementById('DD001002Q_bsnsyear')?.value || '',
          taskNo: document.getElementById('DD001002Q_taskNo')?.value || '',
          requstDeFrom: (document.getElementById('DD001002Q_requstDeFrom')?.value || '').replaceAll('-', ''),
          requstDeTo: (document.getElementById('DD001002Q_requstDeTo')?.value || '').replaceAll('-', ''),
          exmntPrgstCode: filterCode,
          agremId: document.getElementById('DD001002Q_agremId')?.value || '',
          excInsttId: document.getElementById('DD001002Q_excInsttId')?.value || '',
          currentPageNum: '1',
          countPerPageNum: '50',
          excutAmountFrom: '0',
          excutAmountTo: '999999999999999',
          excutPrposCn: '',
          bcncCmpnyNm: '',
          prufSeCode: '',
          asstnExpitmCode: '',
          asstnTaxitmCode: '',
          focusManage: '',
        });

        const xhr = new XMLHttpRequest();
        xhr.open('POST', '/exe/dd/dd001/retrieveListBsnsExcutDetlList.do', true);
        xhr.setRequestHeader('Content-Type', 'application/x-www-form-urlencoded; charset=UTF-8');
        xhr.setRequestHeader('X-Requested-With', 'XMLHttpRequest');
        if (token && headerName) xhr.setRequestHeader(headerName, token);

        xhr.onload = function() {
          try { resolve(JSON.parse(xhr.responseText)); }
          catch(e) { resolve({ _raw: xhr.responseText.substring(0, 300) }); }
        };
        xhr.onerror = () => resolve({ _error: 'network' });
        xhr.ontimeout = () => resolve({ _error: 'timeout' });
        xhr.timeout = 15000;
        xhr.send(p.toString());
      });
    }, filter);

    if (result._error) { console.log('에러:', result._error); continue; }
    if (result._raw) { console.log('파싱 실패:', result._raw); continue; }

    for (const [key, val] of Object.entries(result)) {
      if (Array.isArray(val) && val.length > 0) {
        console.log(`${key}: ${val.length}건`);

        // 상태별
        const cnt = {};
        val.forEach(item => { cnt[item.exmntPrgstNm || '?'] = (cnt[item.exmntPrgstNm || '?'] || 0) + 1; });
        console.log('  상태별:', JSON.stringify(cnt));

        // 사라진 항목
        [383880, 80000, 160300, 196000].forEach(amt => {
          const f = val.find(i => parseInt(String(i.excutSumAmount || i.excutAmount || '0').replace(/,/g, '')) === amt);
          if (f) console.log(`  ★ ${amt}원 발견: ${f.excutPrposCn} | ${f.exmntPrgstNm} | id=${f.excutId || 'N/A'}`);
        });

        // 전체 출력 (최대 35)
        val.slice(0, 35).forEach((item, i) => {
          console.log(`  [${i}] ${item.excutPrposCn} | ${item.excutSumAmount || item.excutAmount}원 | ${item.exmntPrgstNm || ''}`);
        });
        break;  // 첫 번째 배열만
      }
    }
    console.log('');
  }
}

main().catch(console.error);
