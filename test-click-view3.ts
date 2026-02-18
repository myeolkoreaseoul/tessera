import { chromium } from 'playwright';

async function test() {
  const browser = await chromium.connectOverCDP('http://localhost:9444');
  const context = browser.contexts()[0];
  const ePage = context.pages().find(p => p.url().includes('gosims'));

  if (!ePage) { console.log('페이지 없음'); await browser.close(); return; }

  // popupMask 제거
  await ePage.evaluate(() => {
    document.querySelectorAll('.popupMask.on').forEach(el => {
      (el as HTMLElement).classList.remove('on');
      (el as HTMLElement).style.display = 'none';
    });
  });

  // 팝업 감지 준비
  context.on('page', p => console.log('새 페이지!:', p.url()));

  // IBSheet API로 [보기] 클릭 시뮬레이션
  const result = await ePage.evaluate(() => {
    const sheet = (window as any).IBSheet?.[0];
    if (!sheet) return { error: 'IBSheet 없음' };

    // IBSheet의 행 정보 확인
    const rowCount = sheet.RowCount?.() || sheet.LastRow?.() || 'unknown';
    const cols = sheet.ColCount?.() || 'unknown';

    // atchmnflTmp 컬럼의 인덱스 찾기
    let colName = 'atchmnflTmp';

    // 첫 번째 행의 atchmnflTmp 값
    const firstRow = sheet.Rows?.['AR1'];
    let cellValue = '';
    try {
      cellValue = sheet.GetCellValue?.('AR1', colName) || '';
    } catch {}

    return {
      rowCount,
      cols,
      cellValue,
      sheetMethods: Object.keys(sheet).filter(k => typeof sheet[k] === 'function').slice(0, 30)
    };
  });
  console.log('IBSheet 정보:', JSON.stringify(result, null, 2));

  // 방법 1: force 없이 일반 클릭
  console.log('\n방법 1: 일반 클릭 시도...');
  const viewCells = await ePage.$$('td.IBTextUnderline.HideCol0atchmnflTmp');
  console.log('[보기] 셀:', viewCells.length, '개');

  if (viewCells.length > 0) {
    try {
      const popupPromise = context.waitForEvent('page', { timeout: 5000 }).catch(() => null);
      await viewCells[0].click({ timeout: 3000 }); // force 없이
      const popup = await popupPromise;
      if (popup) {
        console.log('일반 클릭 성공! 팝업:', popup.url());
        await popup.close();
        await browser.close();
        return;
      }
      console.log('일반 클릭: 팝업 안 열림');
    } catch (e: any) {
      console.log('일반 클릭 실패:', e.message?.substring(0, 100));
    }
  }

  // 방법 2: JavaScript로 셀 클릭 이벤트 발생
  console.log('\n방법 2: JS dispatchEvent...');
  const jsResult = await ePage.evaluate(() => {
    const cell = document.querySelector('td.IBTextUnderline.HideCol0atchmnflTmp') as HTMLElement;
    if (!cell) return 'cell not found';

    const events = ['mousedown', 'mouseup', 'click'];
    for (const evt of events) {
      cell.dispatchEvent(new MouseEvent(evt, { bubbles: true, cancelable: true, view: window }));
    }
    return 'dispatched';
  });
  console.log('JS 결과:', jsResult);
  await ePage.waitForTimeout(2000);

  // 팝업 확인
  for (const p of context.pages()) {
    if (p.url().includes('getDB003002SView')) {
      console.log('JS 클릭으로 팝업 열림!');
      await p.close();
      await browser.close();
      return;
    }
  }

  // 방법 3: IBSheet API 직접 호출
  console.log('\n방법 3: IBSheet API 호출...');
  const apiResult = await ePage.evaluate(() => {
    const sheet = (window as any).IBSheet?.[0];
    if (!sheet) return 'no sheet';

    try {
      // IBSheet의 셀 클릭 시뮬레이션
      if (sheet.DoClick) {
        sheet.DoClick('AR1', 'atchmnflTmp');
        return 'DoClick called';
      }
      if (sheet.OnClick) {
        sheet.OnClick('AR1', 'atchmnflTmp');
        return 'OnClick called';
      }
      // SearchClick이나 다른 메서드 시도
      const methods = Object.keys(sheet).filter(k =>
        k.toLowerCase().includes('click') && typeof sheet[k] === 'function'
      );
      return 'click methods: ' + methods.join(', ');
    } catch (e: any) {
      return 'error: ' + e.message;
    }
  });
  console.log('API 결과:', apiResult);
  await ePage.waitForTimeout(2000);

  // 최종 팝업 확인
  for (const p of context.pages()) {
    console.log(' page:', p.url().substring(0, 100));
  }

  // 알림 확인
  const mask = await ePage.evaluate(() => {
    const m = document.querySelector('.popupMask.on');
    return m ? (m as HTMLElement).innerText?.substring(0, 200) : null;
  });
  if (mask) console.log('알림:', mask);

  await browser.close();
}

test().catch(console.error);
