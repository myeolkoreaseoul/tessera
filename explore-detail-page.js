/**
 * 세부내역검토 상세 페이지 구조 탐색
 * 1. 행 클릭 → 세부내역검토 → 상세페이지 이동
 * 2. 상세페이지 폼 구조 파악
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

  // 1. 첫 번째 행을 포커스(클릭)
  console.log('1. 행 포커스...');
  await page.evaluate(() => {
    const grid = DD001002QGridObj;
    const rows = grid.getDataRows();
    if (rows.length > 0) {
      grid.selectRow(rows[0]);
      // 포커스도 설정
      if (typeof grid.setFocusedRow === 'function') grid.setFocusedRow(rows[0]);
    }
  });
  await new Promise(r => setTimeout(r, 500));

  // 2. 세부내역검토 버튼 클릭
  console.log('2. 세부내역검토 클릭...');

  // 페이지 네비게이션 감지
  const navigationPromise = page.waitForNavigation({ timeout: 10000 }).catch(() => null);
  await page.click('#DD001002Q_detlListExmnt');

  await new Promise(r => setTimeout(r, 3000));

  // 모달 체크 (에러 메시지 등)
  const modal = await page.evaluate(() => {
    const mask = document.querySelector('.popupMask.on');
    if (mask) {
      const msg = mask.querySelector('.message');
      return msg ? msg.textContent.trim() : 'modal exists but no message';
    }
    return null;
  });

  if (modal) {
    console.log('모달 메시지:', modal);
    // 모달 닫기
    await page.evaluate(() => {
      document.querySelectorAll('.popupMask.on .fn.ok').forEach(b => b.click());
    });

    // 다른 방법 시도: 행을 직접 더블클릭하거나 그리드 셀 클릭
    console.log('\n--- 다른 선택 방법 시도 ---');

    // 방법2: ActionFocusRow 사용
    await page.evaluate(() => {
      const grid = DD001002QGridObj;
      const rows = grid.getDataRows();
      grid.ActionFocusRow(rows[0]);
    });
    await new Promise(r => setTimeout(r, 500));

    await page.click('#DD001002Q_detlListExmnt');
    await new Promise(r => setTimeout(r, 3000));

    const modal2 = await page.evaluate(() => {
      const mask = document.querySelector('.popupMask.on');
      if (mask) {
        const msg = mask.querySelector('.message');
        return msg ? msg.textContent.trim() : null;
      }
      return null;
    });
    if (modal2) {
      console.log('모달2:', modal2);
      await page.evaluate(() => {
        document.querySelectorAll('.popupMask.on .fn.ok').forEach(b => b.click());
      });

      // 방법3: 그리드 셀을 직접 클릭
      console.log('\n--- 그리드 셀 직접 클릭 시도 ---');
      const cellSelector = await page.evaluate(() => {
        const gridDiv = document.getElementById('DD001002QGridObj');
        if (!gridDiv) return 'grid div not found';
        // 데이터 영역의 첫 번째 행 셀 찾기
        const dataCells = gridDiv.querySelectorAll('[class*="data"] td, [class*="Data"] td, tr td');
        if (dataCells.length > 0) {
          return 'found ' + dataCells.length + ' cells, first: ' + dataCells[0].className;
        }
        // SBGrid 내부 구조
        const sbCells = gridDiv.querySelectorAll('[data-r], [data-row]');
        return 'sbCells: ' + sbCells.length;
      });
      console.log('셀 구조:', cellSelector);

      // 방법4: getFocusedRow 확인
      const focusedRow = await page.evaluate(() => {
        const grid = DD001002QGridObj;
        if (typeof grid.getFocusedRow === 'function') {
          const fr = grid.getFocusedRow();
          return fr ? 'focused: ' + JSON.stringify(grid.getRowValue(fr).excutPrposCn) : 'no focused row';
        }
        return 'getFocusedRow not available';
      });
      console.log('포커스 행:', focusedRow);
    }
    return;
  }

  // 네비게이션 성공 시
  console.log('3. 상세 페이지 도달');
  console.log('URL:', page.url().substring(0, 100));

  await page.waitForLoadState('domcontentloaded', { timeout: 10000 }).catch(() => {});
  await new Promise(r => setTimeout(r, 2000));

  // 상세 페이지 분석
  await analyzDetailPage(page);
}

async function analyzDetailPage(page) {
  console.log('\n=== 상세 페이지 분석 ===');

  // 1. 모든 select (드롭다운)
  const selects = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('select')).map(s => ({
      id: s.id, name: s.name,
      options: Array.from(s.options).map(o => o.value + ':' + o.text).slice(0, 10),
      visible: s.offsetHeight > 0,
    }));
  });
  console.log('\n--- SELECT ---');
  selects.forEach(s => console.log(`  id=${s.id} name=${s.name} visible=${s.visible} opts=[${s.options.join(', ')}]`));

  // 2. 버튼
  const buttons = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('button, a.btn, input[type="button"]'))
      .filter(b => b.offsetHeight > 0)
      .map(b => ({
        text: (b.textContent || b.value || '').trim().substring(0, 30),
        id: b.id,
        onclick: (b.getAttribute('onclick') || '').substring(0, 60),
      }));
  });
  console.log('\n--- 버튼 ---');
  buttons.forEach(b => console.log(`  [${b.text}] id=${b.id} onclick=${b.onclick}`));

  // 3. '등록' 텍스트 찾기
  const regLinks = await page.evaluate(() => {
    const all = document.querySelectorAll('a, span, button, td');
    return Array.from(all).filter(el => el.textContent.trim() === '등록' || el.textContent.trim() === '[등록]')
      .map(el => ({
        tag: el.tagName, id: el.id, class: el.className.substring(0, 50),
        onclick: (el.getAttribute('onclick') || '').substring(0, 80),
        parent: el.parentElement ? el.parentElement.className.substring(0, 50) : '',
      }));
  });
  console.log('\n--- [등록] 링크 ---');
  regLinks.forEach(l => console.log(`  <${l.tag} id="${l.id}" class="${l.class}" onclick="${l.onclick}">`));

  // 4. textarea
  const textareas = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('textarea')).map(t => ({
      id: t.id, name: t.name, placeholder: t.placeholder,
      visible: t.offsetHeight > 0,
      value: t.value.substring(0, 50),
    }));
  });
  console.log('\n--- textarea ---');
  textareas.forEach(t => console.log(`  id=${t.id} name=${t.name} visible=${t.visible}`));

  // 5. 그리드 (상세 페이지에도 그리드가 있을 수 있음)
  const grids = await page.evaluate(() => {
    return Object.keys(window).filter(k => {
      try { return window[k] && typeof window[k] === 'object' && typeof window[k].getDataRows === 'function'; } catch { return false; }
    });
  });
  console.log('\n--- 그리드 객체 ---');
  grids.forEach(g => console.log('  ' + g));

  // 6. 페이지 타이틀/헤더
  const pageTitle = await page.title();
  console.log('\n페이지 타이틀:', pageTitle);
}

main().catch(console.error);
