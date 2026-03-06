const { connectBrowser, findEnaraPage, sleep, dismissModals, waitForGrid, waitModal } = require('./lib/utils');
const fs = require('fs');

(async () => {
  const { context } = await connectBrowser();
  const page = await findEnaraPage(context);
  if (!page) { console.log('페이지 없음'); process.exit(1); }

  // 최종정산 확인
  await page.evaluate(() => {
    const r = document.getElementById('DD001002Q_excclcSeCode_1');
    if (r && !r.checked) r.click();
  });
  await sleep(500);
  await page.evaluate(() => {
    const b = document.getElementById('DD001002Q_btnRetrieve');
    if (b) b.click();
  });
  await sleep(4000);
  await dismissModals(page);
  await waitForGrid(page, 'DD001002QGridObj', 15000);

  // 모든 페이지에서 미처리 찾기
  let pageNum = 1;
  while (true) {
    const found = await page.evaluate(() => {
      const grid = DD001002QGridObj;
      const rows = grid.getDataRows();
      for (let i = 0; i < rows.length; i++) {
        const v = grid.getRowValue(rows[i]);
        if (!v.exmntPrgstNm || v.exmntPrgstNm === '미처리') {
          grid.focus(rows[i]);
          return {
            idx: i,
            amount: parseInt(String(v.lastAmount).replace(/,/g, '')),
            purpose: v.excutPrposCn,
            vendor: v.bcncCmpnyNm,
          };
        }
      }
      return null;
    });

    if (found) {
      console.log(`미처리 발견 (페이지 ${pageNum}): ${found.amount}원 ${found.vendor} | ${found.purpose}`);

      // results.json에서 매칭
      const results = JSON.parse(fs.readFileSync('신라2차최종-results.json', 'utf-8'));
      const match = results.find(r => r.amount === found.amount);
      if (!match) {
        console.log('results.json 매칭 실패, 금액으로 재검색...');
        // 금액 근사 매칭
        const approx = results.find(r => Math.abs(r.amount - found.amount) < 100);
        if (approx) {
          console.log(`근사 매칭: R${approx.id} ${approx.amount}원`);
        } else {
          console.log('매칭 실패. 수동 처리 필요.');
          process.exit(1);
        }
      }

      const useMatch = match || results.find(r => Math.abs(r.amount - found.amount) < 100);
      const statusKor = useMatch.status === '적정' ? '검토완료' : '보완요청';
      console.log(`→ ${statusKor} (R${useMatch.id})`);

      // 상세 페이지 이동
      await page.click('#DD001002Q_detlListExmnt');
      await sleep(3000);
      await dismissModals(page);
      const ready = await waitForGrid(page, 'DD001003SGridObj', 15000);
      if (!ready) {
        console.log('ERROR: 상세 페이지 로드 실패');
        process.exit(1);
      }

      if (useMatch.status === '적정') {
        await page.evaluate(() => f_changeExmntPrgst("001"));
      } else {
        const comment = useMatch.issues.join('; ');
        await page.evaluate(({ cmt }) => {
          f_changeExmntPrgst("002");
          const grid = DD001003SGridObj;
          const row = grid.getDataRows()[0];
          const html = cmt.replace(/\n/g, "<br>");
          grid.setValue(row, "exclexCn", html);
          grid.setValue(row, "orgExclexCn", html);
        }, { cmt: comment });
      }

      await sleep(500);
      await page.click('#DD001003S_btnSave');
      await sleep(500);
      await waitModal(page, 5000);
      await sleep(2000);
      await waitModal(page, 10000);
      console.log('저장 완료!');

      // 목록 복귀
      await page.evaluate(() => f_prevPage()).catch(() => {});
      await sleep(3000);
      await dismissModals(page);

      break;
    }

    const count = await page.evaluate(() => DD001002QGridObj.getDataRows().length).catch(() => 0);
    if (count < 20) {
      console.log('미처리 건 없음');
      break;
    }
    pageNum++;
    await page.evaluate((pn) => f_retrieveListBsnsExcutDetl(pn), pageNum);
    await sleep(3000);
    await dismissModals(page);
    await waitForGrid(page, 'DD001002QGridObj');
  }

  process.exit(0);
})().catch(e => { console.error('Error:', e.message); process.exit(1); });
