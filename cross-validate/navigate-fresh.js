const { sleep, connectBrowser, findEnaraPage, dismissModals, waitForGrid } = require('../lib/utils');

(async () => {
  const { context } = await connectBrowser();
  const page = await findEnaraPage(context);
  await dismissModals(page);

  // 1. 과제목록으로 이동
  console.log('과제목록 이동...');
  await page.goto('https://gvs.gosims.go.kr/exe/dd/dd001/getDD001005QView.do', {
    waitUntil: 'networkidle', timeout: 30000
  });
  await sleep(5000);
  await dismissModals(page);
  console.log('URL:', page.url());

  // 그리드 객체 찾기
  const grids = await page.evaluate(() => {
    const found = [];
    for (const key of Object.keys(window)) {
      try {
        const obj = window[key];
        if (obj && typeof obj === 'object' && typeof obj.getDataRows === 'function') {
          found.push({ name: key, rows: obj.getDataRows().length });
        }
      } catch(e) {}
    }
    return found;
  });
  console.log('Grid objects:', JSON.stringify(grids));

  // 버튼 찾기
  const btns = await page.evaluate(() => {
    return [...document.querySelectorAll('button, input[type=button]')]
      .filter(b => b.offsetWidth > 0)
      .map(b => ({ id: b.id, text: (b.textContent || b.value || '').trim().substring(0, 30) }))
      .filter(b => b.id || /검색|조회|세부/.test(b.text));
  });
  console.log('Buttons:', JSON.stringify(btns));

  // 라디오 찾기
  const radios = await page.evaluate(() => {
    return [...document.querySelectorAll('input[type=radio]')]
      .filter(r => r.id.includes('excclc'))
      .map(r => ({ id: r.id, checked: r.checked, value: r.value }));
  });
  console.log('Settlement radios:', JSON.stringify(radios));

  // 정산구분 중간정산 설정
  await page.evaluate(() => {
    const r = document.getElementById('DD001005Q_excclcSeCode_2');
    if (r) { r.click(); }
  });
  await sleep(500);

  // 검색
  console.log('\n검색...');
  await page.evaluate(() => {
    const btn = document.getElementById('DD001005Q_btnRetrieve') ||
                document.getElementById('DD001005Q_btnRetrieveList') ||
                [...document.querySelectorAll('button')].find(b => b.textContent.trim() === '검색' && b.offsetWidth > 0);
    if (btn) { console.log('Search btn:', btn.id); btn.click(); }
  });
  await sleep(5000);
  await dismissModals(page);

  // 그리드 확인
  const grids2 = await page.evaluate(() => {
    const found = [];
    for (const key of Object.keys(window)) {
      try {
        const obj = window[key];
        if (obj && typeof obj === 'object' && typeof obj.getDataRows === 'function') {
          const rows = obj.getDataRows();
          if (rows.length > 0) {
            const rv = obj.getRowValue(rows[0]);
            found.push({ name: key, rows: rows.length, sample: JSON.stringify(rv).substring(0, 200) });
          } else {
            found.push({ name: key, rows: 0 });
          }
        }
      } catch(e) {}
    }
    return found;
  });
  console.log('\n검색 후 grids:', JSON.stringify(grids2, null, 2));

  process.exit(0);
})();
