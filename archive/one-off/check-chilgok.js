process.on('unhandledRejection', () => {});
const { chromium } = require('playwright');
const { sleep, dismissModals, waitForGrid } = require('./lib/utils');

(async () => {
  const browser = await chromium.connectOverCDP('http://localhost:9444');
  const ctx = browser.contexts()[0];
  const page = ctx.pages().find(p => {
    const u = p.url();
    return u.includes('gosims') && !u.includes('getDB003002SView');
  });
  if (!page) { console.log('페이지 없음'); return; }
  page.on('dialog', async d => { try { await d.accept(); } catch {} });

  // 현재 페이지 확인
  const url = page.url();
  console.log('현재 URL:', url);

  // DD001005Q (점검대상사업조회) 페이지인지 확인
  const isDD005 = await page.evaluate(() => {
    return typeof DD001005QGridObj !== 'undefined' || document.getElementById('DD001005Q_selBsnsyear') !== null;
  }).catch(() => false);

  // DD001002Q (집행내역) 페이지인지 확인
  const isDD002 = await page.evaluate(() => {
    return typeof DD001002QGridObj !== 'undefined';
  }).catch(() => false);

  console.log('DD001005Q:', isDD005, '| DD001002Q:', isDD002);

  if (isDD002) {
    // 현재 집행내역 페이지의 상태 확인
    const info = await page.evaluate(() => {
      const grid = DD001002QGridObj;
      const rows = grid ? grid.getDataRows() : [];
      const statusMap = {};
      rows.forEach(row => {
        const v = grid.getRowValue(row);
        const s = v.exmntPrgstNm || '(없음)';
        statusMap[s] = (statusMap[s] || 0) + 1;
      });

      const totalEl = document.getElementById('DD001002Q_searchCnt');
      const total = totalEl ? totalEl.textContent : '?';

      // 정산구분 확인
      const r1 = document.getElementById('DD001002Q_excclcSeCode_1');
      const r2 = document.getElementById('DD001002Q_excclcSeCode_2');

      // 페이지 제목이나 기관 정보
      const titleEl = document.querySelector('.page-title, .sub-title, h3');
      const title = titleEl ? titleEl.textContent.trim() : '';

      return {
        total,
        statusMap,
        rowCount: rows.length,
        settle: { final: r1 ? r1.checked : null, interim: r2 ? r2.checked : null },
        title,
      };
    });
    console.log('\n현재 집행내역 페이지:');
    console.log('  총건수:', info.total);
    console.log('  현재 페이지 행수:', info.rowCount);
    console.log('  정산구분: 최종=' + info.settle.final + ', 중간=' + info.settle.interim);
    console.log('  검토상태:', JSON.stringify(info.statusMap));
    console.log('  제목:', info.title);
  }

  if (isDD005) {
    // 점검대상사업조회 페이지의 그리드 확인
    const searchInfo = await page.evaluate(() => {
      const grid = DD001005QGridObj;
      if (!grid) return [];
      const rows = grid.getDataRows();
      return rows.map((row, i) => {
        const v = grid.getRowValue(row);
        return {
          idx: i,
          taskNm: v.taskNm || '',
          excInsttNm: v.excInsttNm || '',
          status: v.excutLmttResnNm || '',
        };
      });
    });
    console.log('\n점검대상사업 검색결과:');
    for (const r of searchInfo) {
      console.log('  [' + r.idx + '] ' + r.taskNm + ' | ' + r.excInsttNm + ' | ' + r.status);
    }
  }
})();
