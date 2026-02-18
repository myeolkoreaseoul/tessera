const nav = require('./lib/navigate');
const { sleep, dismissModals, waitForGrid, waitModal } = require('./lib/utils');
const fs = require('fs');

async function findAndProcessUnreviewed(page, resultsFile) {
  // 미처리 건 찾기
  const unreviewed = await page.evaluate(() => {
    const grid = DD001002QGridObj;
    const rows = grid.getDataRows();
    for (let i = 0; i < rows.length; i++) {
      const v = grid.getRowValue(rows[i]);
      if (!v.exmntPrgstNm || v.exmntPrgstNm === '미처리') {
        grid.focus(rows[i]);
        return { idx: i, amount: parseInt(String(v.lastAmount).replace(/,/g, '')), purpose: v.excutPrposCn, vendor: v.bcncCmpnyNm };
      }
    }
    return null;
  });

  if (!unreviewed) { console.log('  미처리 건 없음'); return true; }

  console.log(`  미처리 발견: [${unreviewed.idx}] ${unreviewed.amount}원 ${unreviewed.vendor} | ${unreviewed.purpose}`);

  // results.json에서 매칭
  const results = JSON.parse(fs.readFileSync(resultsFile, 'utf-8'));
  const match = results.find(r => r.amount === unreviewed.amount);
  if (!match) { console.log('  results.json 매칭 실패'); return false; }

  const statusKor = match.status === '적정' ? '검토완료' : '보완요청';
  console.log(`  → ${statusKor}`);
  await sleep(500);

  await page.click('#DD001002Q_detlListExmnt');
  await sleep(3000);
  await dismissModals(page);

  const ready = await waitForGrid(page, 'DD001003SGridObj');
  if (!ready) { console.log('  ERROR: 상세 페이지 로드 실패'); return false; }

  if (match.status === '적정') {
    await page.evaluate(() => f_changeExmntPrgst("001"));
  } else {
    const comment = match.issues.join('; ');
    await page.evaluate(({ cmt }) => {
      f_changeExmntPrgst("002");
      const grid = DD001003SGridObj;
      const row = grid.getDataRows()[0];
      const html = cmt.replace(/\n/g, "<br>");
      grid.setValue(row, "exclexCn", html);
      grid.setValue(row, "orgExclexCn", html);
    }, { cmt: comment });
  }

  await page.click('#DD001003S_btnSave');
  await sleep(500);
  await waitModal(page, 5000);
  await sleep(2000);
  await waitModal(page, 10000);
  console.log('  저장 완료');

  await page.evaluate(() => f_prevPage()).catch(() => {});
  await sleep(3000);
  await dismissModals(page);
  await waitForGrid(page, 'DD001002QGridObj');
  return true;
}

(async () => {
  try {
    // 1차년도 (현재 페이지)
    console.log('=== 1차년도 미처리 건 ===');
    const { context } = await require('./lib/utils').connectBrowser();
    let page = await require('./lib/utils').findEnaraPage(context);

    await page.evaluate(() => { const r = document.getElementById('DD001002Q_excclcSeCode_2'); if (r && !r.checked) r.click(); });
    await page.evaluate(() => { const b = document.getElementById('DD001002Q_btnRetrieve'); if (b) b.click(); });
    await sleep(3000); await dismissModals(page); await waitForGrid(page, 'DD001002QGridObj', 15000);

    await findAndProcessUnreviewed(page, '신라시스템-results.json');

    // 2차년도
    console.log('\n=== 2차년도 미처리 건 ===');
    ({ page } = await nav.goToInstitution({ institutionName: '신라시스템', projectKeyword: '2차년도', year: 2025 }));
    await page.evaluate(() => { const r = document.getElementById('DD001002Q_excclcSeCode_2'); if (r && !r.checked) r.click(); });
    await page.evaluate(() => { const b = document.getElementById('DD001002Q_btnRetrieve'); if (b) b.click(); });
    await sleep(3000); await dismissModals(page); await waitForGrid(page, 'DD001002QGridObj', 15000);

    await findAndProcessUnreviewed(page, '2차년도-results.json');

    console.log('\n완료');
  } catch(e) { console.error('Error:', e.message); }
  process.exit(0);
})();
