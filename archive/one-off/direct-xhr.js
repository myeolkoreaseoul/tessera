/**
 * 직접 XMLHttpRequest로 서버 조회 (CSRF 토큰 포함)
 */
const { chromium } = require('playwright');

process.on('unhandledRejection', () => {});

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function main() {
  const browser = await chromium.connectOverCDP('http://localhost:9444');
  const context = browser.contexts()[0];
  let page = context.pages().find(p => p.url().includes('dd001'));
  if (!page) { console.log('페이지 없음'); return; }

  for (const filter of ['001', '', '002']) {
    console.log(`\n=== 필터: ${filter || '전체'} ===`);

    const result = await page.evaluate((filterCode) => {
      return new Promise((resolve, reject) => {
        const token = $("meta[name='_csrf']").attr("content");
        const header = $("meta[name='_csrf_header']").attr("content");

        const params = new URLSearchParams({
          bsnsyear: $('#DD001002Q_bsnsyear').val(),
          taskNo: $('#DD001002Q_taskNo').val(),
          requstDeFrom: $('#DD001002Q_requstDeFrom').val().replaceAll('-', ''),
          requstDeTo: $('#DD001002Q_requstDeTo').val().replaceAll('-', ''),
          exmntPrgstCode: filterCode,
          agremId: $('#DD001002Q_agremId').val(),
          excInsttId: $('#DD001002Q_excInsttId').val(),
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
        if (token && header) {
          xhr.setRequestHeader(header, token);
        }

        xhr.onload = function() {
          try {
            resolve({ status: xhr.status, data: JSON.parse(xhr.responseText) });
          } catch(e) {
            resolve({ status: xhr.status, text: xhr.responseText.substring(0, 500) });
          }
        };
        xhr.onerror = function() {
          resolve({ error: 'network error' });
        };
        xhr.ontimeout = function() {
          resolve({ error: 'timeout' });
        };
        xhr.timeout = 15000;
        xhr.send(params.toString());
      });
    }, filter);

    if (result.error) {
      console.log('에러:', result.error);
      continue;
    }
    if (result.text) {
      console.log(`HTTP ${result.status}:`, result.text.substring(0, 200));
      continue;
    }

    const data = result.data;
    for (const [key, val] of Object.entries(data)) {
      if (Array.isArray(val)) {
        console.log(`${key}: ${val.length}건`);
        if (val.length > 0 && val.length <= 50) {
          // 상태별 카운트
          const cnt = {};
          val.forEach(item => {
            const s = item.exmntPrgstNm || '?';
            cnt[s] = (cnt[s] || 0) + 1;
          });
          console.log('상태별:', JSON.stringify(cnt));

          // 사라진 항목
          [383880, 80000, 160300, 196000].forEach(amt => {
            const f = val.find(item => parseInt(String(item.excutSumAmount || item.excutAmount || '0').replace(/,/g, '')) === amt);
            if (f) console.log(`★ ${amt}원: ${f.excutPrposCn} | ${f.exmntPrgstNm} | id=${f.excutId}`);
          });

          val.forEach((item, i) => {
            if (i < 35) {
              console.log(`  [${i}] ${item.excutPrposCn || ''} | ${item.excutSumAmount || item.excutAmount || ''}원 | ${item.exmntPrgstNm || ''}`);
            }
          });
        }
      } else if (key.toLowerCase().includes('cnt') || key.toLowerCase().includes('total')) {
        console.log(`${key}: ${val}`);
      }
    }
  }
}

main().catch(console.error);
