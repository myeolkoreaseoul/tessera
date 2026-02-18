const nav = require('./lib/navigate');
const { sleep, connectBrowser, findEnaraPage, dismissModals, waitForGrid } = require('./lib/utils');

const institutions = [
  '원주세브란스',
  '인트인',
  '메디웨일',
  '용인세브란스',
  '임프리메드',
  '에이아이트릭스',
  '실비아헬스',
  '스키아',
  '이대목동',
];

(async () => {
  const { context } = await connectBrowser();
  const page = await findEnaraPage(context);
  if (!page) { console.log('페이지 없음'); process.exit(1); }

  // 점검대상사업조회 페이지로 이동
  await nav.goToInspectionPage(page);

  for (const name of institutions) {
    const results = await nav.searchInstitution(page, name, 2025);
    if (results.length > 0) {
      console.log(`\n>>> ${name}: ${results.length}건 발견 <<<`);
      for (const r of results) {
        console.log(`    ${r.taskNm} | ${r.excInsttNm} | ${r.excutLmttResnNm}`);
      }
    } else {
      console.log(`\n>>> ${name}: 검색 불가 <<<`);
    }
    await sleep(1000);
  }

  process.exit(0);
})().catch(e => { console.error('Error:', e.message); process.exit(1); });
