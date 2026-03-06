/**
 * 그리드 편집/검토 메커니즘 심층 탐색
 */
const { chromium } = require('playwright');

process.on('unhandledRejection', (err) => {
  if (err && err.message && err.message.includes('No dialog is showing')) return;
});

async function main() {
  const browser = await chromium.connectOverCDP('http://localhost:9444');
  const context = browser.contexts()[0];
  const page = context.pages().find(p => p.url().includes('dd001'));
  if (!page) { console.log('dd001 페이지 없음'); return; }
  page.on('dialog', async d => { try { await d.accept(); } catch {} });

  // 모달 닫기
  await page.evaluate(() => {
    document.querySelectorAll('.popupMask.on .fn.ok').forEach(b => b.click());
  });
  await new Promise(r => setTimeout(r, 500));

  // 1. 검토 관련 UI 요소들 (셀렉트박스, 라디오, 체크박스 등)
  const uiElements = await page.evaluate(() => {
    const result = {};
    // 모든 select
    result.selects = Array.from(document.querySelectorAll('select')).map(s => {
      const opts = Array.from(s.options || []).map(o => o.value + ':' + o.text);
      return { id: s.id, name: s.name, opts: opts.slice(0, 10) };
    });
    // radio
    result.radios = Array.from(document.querySelectorAll('input[type="radio"]')).map(r => ({
      name: r.name, value: r.value, checked: r.checked,
      label: r.parentElement ? r.parentElement.textContent.trim().substring(0, 30) : ''
    }));
    // exmntPrgstCode 관련
    result.exmntElements = Array.from(document.querySelectorAll('[id*="exmnt"], [name*="exmnt"], [id*="Exmnt"]')).map(el => ({
      tag: el.tagName, id: el.id, name: el.name || '', type: el.type || '', value: (el.value || '').substring(0, 30)
    }));
    // nrcgn 관련
    result.nrcgnElements = Array.from(document.querySelectorAll('[id*="nrcgn"], [name*="nrcgn"], [id*="Nrcgn"]')).map(el => ({
      tag: el.tagName, id: el.id, name: el.name || '', value: (el.value || '').substring(0, 30)
    }));
    return result;
  });

  console.log('=== select 박스 ===');
  uiElements.selects.forEach(s => console.log(`  id=${s.id} name=${s.name} opts=[${s.opts.join(', ')}]`));
  console.log('\n=== radio ===');
  uiElements.radios.forEach(r => console.log(`  name=${r.name} value=${r.value} ${r.checked ? '✓' : ''} label=${r.label}`));
  console.log('\n=== exmnt 관련 요소 ===');
  uiElements.exmntElements.forEach(e => console.log(`  <${e.tag} id="${e.id}" name="${e.name}" type="${e.type}" value="${e.value}">`));
  console.log('\n=== nrcgn 관련 요소 ===');
  uiElements.nrcgnElements.forEach(e => console.log(`  <${e.tag} id="${e.id}" name="${e.name}" value="${e.value}">`));

  // 2. 불인정금액 setRowValue 테스트
  const editTest = await page.evaluate(() => {
    const grid = DD001002QGridObj;
    const rows = grid.getDataRows();
    if (rows.length === 0) return 'no rows';
    const row0 = rows[0];
    const before = grid.getRowValue(row0);
    const origNrcgn = before.nrcgnAmount;
    try {
      grid.setRowValue(row0, { nrcgnAmount: 99999 });
      const after = grid.getRowValue(row0).nrcgnAmount;
      grid.setRowValue(row0, { nrcgnAmount: origNrcgn || 0 });
      return { success: true, before: origNrcgn, setTo: 99999, after: after };
    } catch (e) {
      return { success: false, error: e.message };
    }
  });
  console.log('\n=== 불인정금액 편집 테스트 ===');
  console.log(JSON.stringify(editTest));

  // 3. exmntPrgstCode(검토진행상태) setRowValue 테스트
  const statusTest = await page.evaluate(() => {
    const grid = DD001002QGridObj;
    const rows = grid.getDataRows();
    if (rows.length === 0) return 'no rows';
    const row0 = rows[0];
    const before = grid.getRowValue(row0);
    return {
      exmntPrgstCode: before.exmntPrgstCode,
      exmntPrgstNm: before.exmntPrgstNm,
      exmntDe: before.exmntDe,
    };
  });
  console.log('\n=== 검토진행상태 현재값 ===');
  console.log(JSON.stringify(statusTest));

  // 4. 검토완료처리 함수 전체
  const batchFn = await page.evaluate(() => {
    if (typeof f_registExcclcExmntBatch === 'function') return f_registExcclcExmntBatch.toString();
    return 'not found';
  });
  console.log('\n=== f_registExcclcExmntBatch 전문 ===');
  console.log(batchFn);

  // 5. 보완요청 함수 전체
  const splemntFn = await page.evaluate(() => {
    if (typeof f_registExcclcExmntSplemnt === 'function') return f_registExcclcExmntSplemnt.toString();
    return 'not found';
  });
  console.log('\n=== f_registExcclcExmntSplemnt 전문 ===');
  console.log(splemntFn);

  // 6. exmntPrgstCodeArr 확인
  const codeArr = await page.evaluate(() => {
    return window.exmntPrgstCodeArr || 'not found';
  });
  console.log('\n=== exmntPrgstCodeArr ===');
  console.log(JSON.stringify(codeArr));
}

main().catch(console.error);
