import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';

async function test() {
  const browser = await chromium.connectOverCDP('http://localhost:9444');
  const context = browser.contexts()[0];

  // 먼저 [보기] 다시 클릭해서 팝업 열기
  const ePage = context.pages().find(p => p.url().includes('getDD001002QView'));
  if (!ePage) { console.log('집행내역 페이지 없음'); await browser.close(); return; }

  // 기존 팝업 닫기
  const existingPopup = context.pages().find(p => p.url().includes('getDB003002SView'));
  if (existingPopup) {
    await existingPopup.close();
    await ePage.waitForTimeout(500);
  }

  // popupMask 제거
  await ePage.evaluate(() => {
    document.querySelectorAll('.popupMask.on').forEach(el => {
      (el as HTMLElement).classList.remove('on');
      (el as HTMLElement).style.display = 'none';
    });
  });

  // [보기] 클릭
  const viewCells = await ePage.$$('td.IBTextUnderline.HideCol0atchmnflTmp');
  console.log('[보기] 셀:', viewCells.length);
  if (viewCells.length === 0) { await browser.close(); return; }

  const popupPromise = context.waitForEvent('page', { timeout: 10000 });
  await viewCells[0].click({ timeout: 5000 });
  const popup = await popupPromise;

  // URL 변경 대기
  if (popup.url() === 'about:blank') {
    await popup.waitForURL(/gosims/, { timeout: 15000 });
  }
  await popup.waitForLoadState('domcontentloaded');
  await popup.waitForTimeout(1000);
  console.log('팝업 열림:', popup.url());

  // 다운로드 폴더 설정
  const dlDir = 'C:/projects/e-naradomum-rpa/downloads/test';
  fs.mkdirSync(dlDir, { recursive: true });

  // 네트워크 요청 감시
  popup.on('response', async (resp) => {
    const url = resp.url();
    const contentType = resp.headers()['content-type'] || '';
    const contentDisp = resp.headers()['content-disposition'] || '';
    if (contentDisp || contentType.includes('octet') || contentType.includes('pdf') || contentType.includes('download')) {
      console.log('다운로드 응답 감지:', url.substring(0, 100));
      console.log('  Content-Type:', contentType);
      console.log('  Content-Disposition:', contentDisp);
    }
  });

  // 체크박스 전체 선택
  const checkAll = await popup.$('input[type="checkbox"]:not([id])');
  if (checkAll) {
    await checkAll.click();
    console.log('전체 선택 체크박스 클릭');
  }
  await popup.waitForTimeout(300);

  // dialog 핸들러 등록
  popup.on('dialog', async (dialog) => {
    console.log('알림:', dialog.type(), dialog.message());
    await dialog.accept();
  });

  // 다운로드 버튼 클릭
  const dlBtn = await popup.$('#DB003002S_btnDownload');
  if (dlBtn) {
    console.log('\n다운로드 버튼 클릭...');

    // download 이벤트 + 타임아웃
    const downloadPromise = popup.waitForEvent('download', { timeout: 10000 }).catch(() => null);
    await dlBtn.click();

    const download = await downloadPromise;
    if (download) {
      const filename = download.suggestedFilename();
      const savePath = path.join(dlDir, filename);
      await download.saveAs(savePath);
      console.log('다운로드 성공:', filename, fs.statSync(savePath).size, 'bytes');
    } else {
      console.log('download 이벤트 없음');
    }

    await popup.waitForTimeout(3000);
    console.log('\n최종 페이지들:');
    for (const p of context.pages()) {
      console.log(' -', p.url().substring(0, 100));
    }
  }

  await browser.close();
}

test().catch(console.error);
