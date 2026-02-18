process.on('unhandledRejection', () => {});
const nav = require('./lib/navigate');
const { sleep, connectBrowser, dismissModals, waitForGrid } = require('./lib/utils');

(async () => {
  const { context } = await connectBrowser();
  const page = context.pages().find(p => p.url().includes('gosims') && !p.url().includes('getDB003002SView'));
  if (!page) { console.log('페이지 없음'); return; }
  page.on('dialog', async d => { try { await d.accept(); } catch {} });

  await nav.goToInspectionPage(page);

  // 여러 키워드로 검색
  for (const kw of ['칠곡', '칠곡경북대', '칠곡경북대학교']) {
    console.log('\n=== 검색: "' + kw + '" ===');
    const results = await nav.searchInstitution(page, kw, 2025);
    if (results.length > 0) {
      for (const r of results) {
        console.log('  ' + r.taskNm + ' | ' + r.excInsttNm + ' | ' + r.excutLmttResnNm);
      }
    }
  }
})();
