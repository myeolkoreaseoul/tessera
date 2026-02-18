/**
 * AJAX를 직접 호출하여 전체 항목(필터 없이) 조회
 * + 검토완료 필터로 조회
 */
const { chromium } = require('playwright');

process.on('unhandledRejection', (err) => {
  if (err && err.message && err.message.includes('No dialog is showing')) return;
});

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function main() {
  console.log('=== 전체 항목 직접 AJAX 조회 ===\n');

  const browser = await chromium.connectOverCDP('http://localhost:9444');
  const context = browser.contexts()[0];
  let page = context.pages().find(p => p.url().includes('dd001'));
  if (!page) { console.log('페이지 없음'); return; }
  page.on('dialog', async d => { try { await d.accept(); } catch {} });

  // 1. 현재 select 요소 확인
  const selectInfo = await page.evaluate(() => {
    const sel = document.getElementById('DD001002Q_selExmntPrgstCode');
    if (!sel) return 'not found';
    return {
      tagName: sel.tagName,
      type: sel.type,
      value: sel.value,
      options: sel.options ? Array.from(sel.options).map(o => ({ value: o.value, text: o.text })) : [],
      display: window.getComputedStyle(sel).display,
    };
  });
  console.log('selExmntPrgstCode:', JSON.stringify(selectInfo, null, 2));

  // 2. 기본 파라미터 수집
  const params = await page.evaluate(() => {
    return {
      bsnsyear: $('#DD001002Q_bsnsyear').val(),
      taskNo: $('#DD001002Q_taskNo').val(),
      requstDeFrom: $('#DD001002Q_requstDeFrom').val().replaceAll('-', ''),
      requstDeTo: $('#DD001002Q_requstDeTo').val().replaceAll('-', ''),
      agremId: $('#DD001002Q_agremId').val(),
      excInsttId: $('#DD001002Q_excInsttId').val(),
    };
  });
  console.log('\n기본 파라미터:', JSON.stringify(params, null, 2));

  // 3. 직접 AJAX 호출 - 검토완료(001) 필터
  console.log('\n--- 검토완료(001) 필터 직접 AJAX ---');
  const result001 = await page.evaluate(async (params) => {
    return new Promise((resolve) => {
      $.ajax({
        beforeSend: cf_setCSRFHeader,
        url: '/exe/dd/dd001/retrieveListBsnsExcutDetlList.do',
        type: 'POST',
        data: {
          bsnsyear: params.bsnsyear,
          taskNo: params.taskNo,
          requstDeFrom: params.requstDeFrom,
          requstDeTo: params.requstDeTo,
          exmntPrgstCode: '001',  // 검토완료
          agremId: params.agremId,
          excInsttId: params.excInsttId,
          currentPageNum: 1,
          countPerPageNum: 50,
          excutAmountFrom: 0,
          excutAmountTo: 999999999999999,
          excutPrposCn: '',
          bcncCmpnyNm: '',
          prufSeCode: '',
          asstnExpitmCode: '',
          asstnTaxitmCode: '',
          focusManage: '',
        },
        contentType: 'application/x-www-form-urlencoded; charset=UTF-8',
        dataType: 'json',
        success: function(data) { resolve(data); },
        error: function(err) { resolve({ error: err.statusText }); },
      });
    });
  }, params);

  if (result001.error) {
    console.log('에러:', result001.error);
  } else {
    // 결과 구조 확인
    const keys = Object.keys(result001);
    console.log('응답 키:', keys);
    // 리스트 데이터 찾기
    let list = null;
    for (const key of keys) {
      if (Array.isArray(result001[key])) {
        list = result001[key];
        console.log(`${key}: ${list.length}건`);
        break;
      }
    }
    if (list) {
      list.forEach((item, i) => {
        console.log(`  [${i}] ${item.excutPrposCn || ''} | ${item.excutSumAmount || item.excutAmount || ''}원 | ${item.exmntPrgstNm || item.exmntPrgstCode || ''}`);
      });
    } else {
      // 전체 데이터 출력 (첫 500자)
      console.log('데이터:', JSON.stringify(result001).substring(0, 1000));
    }
  }

  // 4. 직접 AJAX 호출 - 전체 (필터 없이)
  console.log('\n--- 전체(필터 없음) 직접 AJAX ---');
  const resultAll = await page.evaluate(async (params) => {
    return new Promise((resolve) => {
      $.ajax({
        beforeSend: cf_setCSRFHeader,
        url: '/exe/dd/dd001/retrieveListBsnsExcutDetlList.do',
        type: 'POST',
        data: {
          bsnsyear: params.bsnsyear,
          taskNo: params.taskNo,
          requstDeFrom: params.requstDeFrom,
          requstDeTo: params.requstDeTo,
          exmntPrgstCode: '',  // 전체
          agremId: params.agremId,
          excInsttId: params.excInsttId,
          currentPageNum: 1,
          countPerPageNum: 50,
          excutAmountFrom: 0,
          excutAmountTo: 999999999999999,
          excutPrposCn: '',
          bcncCmpnyNm: '',
          prufSeCode: '',
          asstnExpitmCode: '',
          asstnTaxitmCode: '',
          focusManage: '',
        },
        contentType: 'application/x-www-form-urlencoded; charset=UTF-8',
        dataType: 'json',
        success: function(data) { resolve(data); },
        error: function(err) { resolve({ error: err.statusText }); },
      });
    });
  }, params);

  if (resultAll.error) {
    console.log('에러:', resultAll.error);
  } else {
    const keys = Object.keys(resultAll);
    console.log('응답 키:', keys);
    let list = null;
    for (const key of keys) {
      if (Array.isArray(resultAll[key])) {
        list = resultAll[key];
        console.log(`${key}: ${list.length}건`);
        break;
      }
    }
    if (list) {
      // 검토상태별 카운트
      const statusCount = {};
      list.forEach(item => {
        const s = item.exmntPrgstNm || item.exmntPrgstCode || 'unknown';
        statusCount[s] = (statusCount[s] || 0) + 1;
      });
      console.log('상태별:', JSON.stringify(statusCount));

      // 사라진 4건 찾기
      const tracking = [383880, 80000, 160300, 196000];
      console.log('\n사라진 항목:');
      for (const amt of tracking) {
        const found = list.find(item => {
          const a = parseInt(String(item.excutSumAmount || item.excutAmount || '').replace(/,/g, ''));
          return a === amt;
        });
        if (found) {
          console.log(`  ${amt}원: ${found.excutPrposCn} | ${found.exmntPrgstNm || found.exmntPrgstCode}`);
        } else {
          console.log(`  ${amt}원: 못 찾음`);
        }
      }

      // 전체 목록 출력
      console.log('\n전체 목록:');
      list.forEach((item, i) => {
        const amt = item.excutSumAmount || item.excutAmount || '';
        console.log(`  [${i}] ${item.excutPrposCn || ''} | ${amt}원 | ${item.exmntPrgstNm || item.exmntPrgstCode || ''}`);
      });
    } else {
      console.log('데이터:', JSON.stringify(resultAll).substring(0, 1000));
    }
  }

  // 5. 보완요청(002) 확인
  console.log('\n--- 보완요청(002) 직접 AJAX ---');
  const result002 = await page.evaluate(async (params) => {
    return new Promise((resolve) => {
      $.ajax({
        beforeSend: cf_setCSRFHeader,
        url: '/exe/dd/dd001/retrieveListBsnsExcutDetlList.do',
        type: 'POST',
        data: {
          bsnsyear: params.bsnsyear,
          taskNo: params.taskNo,
          requstDeFrom: params.requstDeFrom,
          requstDeTo: params.requstDeTo,
          exmntPrgstCode: '002',
          agremId: params.agremId,
          excInsttId: params.excInsttId,
          currentPageNum: 1,
          countPerPageNum: 50,
          excutAmountFrom: 0,
          excutAmountTo: 999999999999999,
          excutPrposCn: '',
          bcncCmpnyNm: '',
          prufSeCode: '',
          asstnExpitmCode: '',
          asstnTaxitmCode: '',
          focusManage: '',
        },
        contentType: 'application/x-www-form-urlencoded; charset=UTF-8',
        dataType: 'json',
        success: function(data) { resolve(data); },
        error: function(err) { resolve({ error: err.statusText }); },
      });
    });
  }, params);

  if (!result002.error) {
    for (const key of Object.keys(result002)) {
      if (Array.isArray(result002[key])) {
        console.log(`보완요청: ${result002[key].length}건`);
        result002[key].forEach((item, i) => {
          console.log(`  [${i}] ${item.excutPrposCn || ''} | ${item.excutSumAmount || item.excutAmount || ''}원`);
        });
        break;
      }
    }
  }
}

main().catch(console.error);
