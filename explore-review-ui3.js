/**
 * 세부내역검토 화면 열어서 폼 구조 확인
 */
const { chromium } = require('playwright');

process.on('unhandledRejection', (err) => {
  if (err && err.message && err.message.includes('No dialog is showing')) return;
  console.error('Unhandled:', err.message);
});

async function main() {
  const browser = await chromium.connectOverCDP('http://localhost:9444');
  const context = browser.contexts()[0];
  const page = context.pages().find(p => p.url().includes('dd001'));
  if (!page) { console.log('dd001 페이지 없음'); return; }
  page.on('dialog', async d => { try { await d.accept(); } catch {} });

  // 1. 첫 번째 행 선택
  await page.evaluate(() => {
    const grid = DD001002QGridObj;
    const rows = grid.getDataRows();
    if (rows.length > 0) {
      grid.selectRow(rows[0]);
      grid.setCheck(rows[0], 'checked', true);
    }
  });
  console.log('행 선택 완료');

  // 2. 세부내역검토 버튼 클릭 → 새 페이지/팝업 감지
  const pagesBefore = context.pages().length;
  const popupPromise = context.waitForEvent('page', { timeout: 8000 }).catch(() => null);

  await page.click('#DD001002Q_detlListExmnt');
  console.log('세부내역검토 버튼 클릭');

  await new Promise(r => setTimeout(r, 3000));

  // 새 팝업 감지
  const popup = await popupPromise;
  if (popup) {
    console.log('\n=== 새 페이지 열림 ===');
    console.log('URL:', popup.url());
    await popup.waitForLoadState('domcontentloaded', { timeout: 10000 }).catch(() => {});
    await new Promise(r => setTimeout(r, 2000));

    // 폼 요소 분석
    const formInfo = await popup.evaluate(() => {
      const inputs = document.querySelectorAll('input, textarea, select');
      const result = [];
      inputs.forEach(el => {
        result.push({
          tag: el.tagName,
          type: el.type || '',
          id: el.id,
          name: el.name,
          value: (el.value || '').substring(0, 50),
          placeholder: el.placeholder || '',
          class: el.className.substring(0, 50),
        });
      });
      return result;
    });
    console.log('\n=== 폼 요소 ===');
    formInfo.forEach(f => console.log(`  <${f.tag} type="${f.type}" id="${f.id}" name="${f.name}" value="${f.value}">`));

    // 버튼들
    const buttons = await popup.evaluate(() => {
      return Array.from(document.querySelectorAll('button, a.btn, input[type="button"]')).map(b => ({
        text: (b.textContent || b.value || '').trim().substring(0, 30),
        id: b.id,
        onclick: (b.getAttribute('onclick') || '').substring(0, 80),
      }));
    });
    console.log('\n=== 버튼 ===');
    buttons.filter(b => b.text).forEach(b => console.log(`  [${b.text}] id=${b.id}`));

    // 텍스트 라벨 확인
    const labels = await popup.evaluate(() => {
      return Array.from(document.querySelectorAll('th, label, .tit')).map(l =>
        (l.textContent || '').trim().substring(0, 40)
      ).filter(t => t && t.length > 1);
    });
    console.log('\n=== 라벨 ===');
    labels.slice(0, 30).forEach(l => console.log('  ' + l));

  } else {
    // 팝업 대신 같은 페이지에서 변경 감지
    console.log('\n팝업 없음 - 현재 페이지 변경 확인');
    const pagesAfter = context.pages().length;
    console.log('페이지 수:', pagesBefore, '→', pagesAfter);

    // 모달/레이어 확인
    const modal = await page.evaluate(() => {
      const layers = document.querySelectorAll('.layer, .modal, .popup, [class*="popup"], [class*="layer"]');
      return Array.from(layers).filter(l => l.offsetHeight > 0).map(l => ({
        id: l.id,
        class: l.className.substring(0, 50),
        html: l.innerHTML.substring(0, 300),
      }));
    });
    console.log('모달:', JSON.stringify(modal, null, 2));

    // URL 변경 확인
    console.log('현재 URL:', page.url().substring(0, 100));
  }
}

main().catch(console.error);
