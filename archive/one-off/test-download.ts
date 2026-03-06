import { chromium } from 'playwright';

async function test() {
  const browser = await chromium.connectOverCDP('http://localhost:9444');
  const context = browser.contexts()[0];
  const popup = context.pages().find(p => p.url().includes('getDB003002SView'));

  if (!popup) { console.log('팝업 없음'); await browser.close(); return; }

  console.log('팝업 발견, 다운로드 시도...');

  // 전체 체크박스 선택
  const checkboxes = await popup.$$('input[type="checkbox"]');
  console.log('체크박스:', checkboxes.length, '개');
  for (const cb of checkboxes) {
    await cb.check().catch(() => {});
  }
  await popup.waitForTimeout(300);

  // 다운로드 버튼 클릭
  const dlBtn = await popup.$('#DB003002S_btnDownload');
  if (!dlBtn) { console.log('다운로드 버튼 없음'); await browser.close(); return; }

  console.log('다운로드 버튼 클릭...');
  const downloadPromise = popup.waitForEvent('download', { timeout: 15000 });
  await dlBtn.click();

  try {
    const download = await downloadPromise;
    const filename = download.suggestedFilename();
    const savePath = 'C:/projects/e-naradomum-rpa/downloads/test/' + filename;

    // 폴더 생성
    const fs = require('fs');
    fs.mkdirSync('C:/projects/e-naradomum-rpa/downloads/test', { recursive: true });

    await download.saveAs(savePath);
    console.log('다운로드 성공!');
    console.log('파일명:', filename);
    console.log('저장 경로:', savePath);

    const stats = fs.statSync(savePath);
    console.log('파일 크기:', stats.size, 'bytes');
  } catch (e: any) {
    console.log('다운로드 이벤트 실패:', e.message?.substring(0, 200));

    // 혹시 새 탭/페이지로 다운로드?
    console.log('\n현재 페이지들:');
    for (const p of context.pages()) {
      console.log(' -', p.url().substring(0, 100));
    }
  }

  await popup.close();
  await browser.close();
}

test().catch(console.error);
