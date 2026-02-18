/**
 * onAfterClick 핸들러 전체 + 올바른 팝업 URL 찾기
 */
import { chromium } from 'playwright';

process.on('unhandledRejection', (err: any) => {
  if (err?.message?.includes('No dialog is showing')) return;
});

async function main() {
  const browser = await chromium.connectOverCDP('http://localhost:9444');
  const context = browser.contexts()[0];
  const page = context.pages().find(p => p.url().includes('getDD001002QView'));

  if (!page) { console.log('페이지 없음'); await browser.close(); return; }

  // CDP dialog 처리
  const cdp = await context.newCDPSession(page);
  cdp.on('Page.javascriptDialogOpening', async (event: any) => {
    console.log(`  [dialog] ${event.type}: ${event.message?.substring(0, 60)}`);
    try { await cdp.send('Page.handleJavaScriptDialog', { accept: true }); } catch {}
  });
  await cdp.send('Page.enable');

  // f_createGridDD001002Q 에서 onAfterClick 전체 소스
  console.log('=== onAfterClick 핸들러 전체 ===');
  const clickHandler = await page.evaluate(() => {
    const fn = (window as any).f_createGridDD001002Q;
    if (!fn) return 'NOT FOUND';
    const src = fn.toString();

    // onAfterClick 부분 추출
    const startIdx = src.indexOf('onAfterClick');
    if (startIdx === -1) return 'onAfterClick not found';

    // 함수 블록 끝 찾기 (중괄호 매칭)
    let braceCount = 0;
    let inFunction = false;
    let endIdx = startIdx;
    for (let i = startIdx; i < src.length; i++) {
      if (src[i] === '{') {
        braceCount++;
        inFunction = true;
      } else if (src[i] === '}') {
        braceCount--;
        if (inFunction && braceCount === 0) {
          endIdx = i + 1;
          break;
        }
      }
    }

    return src.substring(startIdx, endIdx);
  });
  console.log(clickHandler);

  // f_clickAtchmnflId 전체 소스
  console.log('\n=== f_clickAtchmnflId 전체 소스 ===');
  const fnSource = await page.evaluate(() => {
    const fn = (window as any).f_clickAtchmnflId;
    return fn ? fn.toString().substring(0, 2000) : 'NOT FOUND';
  });
  console.log(fnSource);

  // DB003002S 관련 함수 찾기
  console.log('\n=== DB003 관련 함수 ===');
  const db003Fns = await page.evaluate(() => {
    const results: string[] = [];
    for (const key of Object.keys(window)) {
      if (key.includes('DB003') || key.includes('db003')) {
        results.push(`${key}: ${typeof (window as any)[key]}`);
      }
    }
    // cf_popup 함수 확인
    if ((window as any).cf_popup) {
      results.push('\ncf_popup: ' + (window as any).cf_popup.toString().substring(0, 300));
    }
    return results.join('\n');
  });
  console.log(db003Fns);

  // f_pjt_goAtchFileList 소스 (첨부파일 리스트 팝업)
  console.log('\n=== f_pjt_goAtchFileList ===');
  const atchListFn = await page.evaluate(() => {
    const fn = (window as any).f_pjt_goAtchFileList;
    return fn ? fn.toString().substring(0, 500) : 'NOT FOUND';
  });
  console.log(atchListFn);

  // 두 번째 행으로 정확한 팝업 URL 구성하여 열기
  console.log('\n=== 정확한 팝업 열기 시도 ===');
  const rowInfo = await page.evaluate(() => {
    const grid = (window as any).DD001002QGridObj;
    const rows = grid.getDataRows();
    const val = grid.getRowValue(rows[1]);
    return {
      atchmnflId: val.atchmnflId,
      excutId: val.excutId,
      excutSn: val.excutSn,
      atchmnflCnt: val.atchmnflCnt,
      // 모든 키 출력
      allKeys: Object.keys(val).join(', '),
    };
  });
  console.log('행 정보:', JSON.stringify(rowInfo, null, 2));

  // DB003002SView 팝업 직접 열기
  const popupPromise = context.waitForEvent('page', { timeout: 15000 });
  await page.evaluate((info: any) => {
    // e나라도움 첨부파일 팝업 URL 패턴
    const url = `/exe/db/db003/getDB003002SView.do?atchmnflId=${info.atchmnflId}`;
    window.open(url, 'popupDB003002S', 'width=700,height=500,scrollbars=yes');
  }, rowInfo);

  const popup = await popupPromise.catch(() => null);
  if (popup) {
    await popup.waitForLoadState('domcontentloaded').catch(() => {});
    console.log(`팝업 URL: ${popup.url()}`);
    const title = await popup.title();
    console.log(`제목: ${title}`);

    // 다운로드 함수 확인
    const hasDlFn = await popup.evaluate(() => typeof (window as any).f_downloadDB003002S === 'function').catch(() => false);
    console.log(`f_downloadDB003002S: ${hasDlFn}`);

    // 파일 목록 확인
    const fileList = await popup.evaluate(() => {
      const checkboxes = document.querySelectorAll('input[type="checkbox"]');
      return Array.from(checkboxes).map(cb => {
        const tr = cb.closest('tr');
        return tr ? tr.textContent?.trim().substring(0, 100) : '';
      });
    }).catch(() => []);
    console.log(`파일 목록: ${fileList.join('\n')}`);

    await popup.close().catch(() => {});
  } else {
    console.log('팝업 안 열림');
  }

  await cdp.detach().catch(() => {});
  await browser.close();
}

main().catch(console.error);
