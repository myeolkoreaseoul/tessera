import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';

async function test() {
  const browser = await chromium.connectOverCDP('http://localhost:9444');
  const context = browser.contexts()[0];
  const popup = context.pages().find(p => p.url().includes('getDB003002SView'));

  if (!popup) { console.log('팝업 없음'); await browser.close(); return; }
  console.log('팝업 발견:', popup.url());

  const dlDir = path.resolve('/mnt/c/projects/e-naradomum-rpa/downloads/test');
  fs.mkdirSync(dlDir, { recursive: true });

  // CDP로 다운로드 경로 설정
  const cdpSession = await popup.context().newCDPSession(popup);
  await cdpSession.send('Page.setDownloadBehavior', {
    behavior: 'allow',
    downloadPath: 'C:\\projects\\e-naradomum-rpa\\downloads\\test'
  });
  console.log('CDP 다운로드 경로 설정 완료');

  // dialog 핸들러
  popup.on('dialog', async (dialog) => {
    console.log('알림:', dialog.message());
    await dialog.accept();
  });

  // 체크박스 상태 확인 및 클릭
  const cbState = await popup.evaluate(() => {
    const cbs = document.querySelectorAll('input[type="checkbox"]');
    const states: any[] = [];
    cbs.forEach((cb, i) => {
      const input = cb as HTMLInputElement;
      states.push({ id: input.id, checked: input.checked });
      input.checked = true;
      input.dispatchEvent(new Event('change', { bubbles: true }));
    });
    return states;
  });
  console.log('체크박스 상태:', cbState);

  // 다운로드 버튼의 실제 동작 확인
  const btnInfo = await popup.evaluate(() => {
    const btn = document.getElementById('DB003002S_btnDownload');
    if (!btn) return null;
    // jQuery 이벤트 확인
    const jqEvents = (window as any).jQuery?._data?.(btn, 'events');
    const clickHandlers = jqEvents?.click?.map((h: any) => h.handler?.toString().substring(0, 200));
    return {
      tagName: btn.tagName,
      type: btn.getAttribute('type'),
      onclick: btn.getAttribute('onclick'),
      clickHandlers
    };
  });
  console.log('다운로드 버튼 정보:', JSON.stringify(btnInfo, null, 2));

  // 다운로드 전 파일 목록
  const filesBefore = fs.existsSync(dlDir) ? fs.readdirSync(dlDir) : [];
  console.log('다운로드 전 파일:', filesBefore);

  // 다운로드 버튼 클릭
  console.log('\n다운로드 버튼 클릭...');
  await popup.click('#DB003002S_btnDownload');

  // 대기 (다운로드에 시간 필요)
  await popup.waitForTimeout(5000);

  // 다운로드 후 파일 목록
  const filesAfter = fs.existsSync(dlDir) ? fs.readdirSync(dlDir) : [];
  console.log('다운로드 후 파일:', filesAfter);

  const newFiles = filesAfter.filter(f => !filesBefore.includes(f));
  if (newFiles.length > 0) {
    console.log('\n새로 다운로드된 파일:');
    for (const f of newFiles) {
      const stat = fs.statSync(path.join(dlDir, f));
      console.log(`  ${f} (${stat.size} bytes)`);
    }
  } else {
    console.log('새 파일 없음');

    // Chrome 기본 다운로드 폴더 확인
    const defaultDl = 'C:/Users/정동회계법인/Downloads';
    if (fs.existsSync(defaultDl)) {
      const recent = fs.readdirSync(defaultDl)
        .map(f => ({ name: f, time: fs.statSync(path.join(defaultDl, f)).mtimeMs }))
        .sort((a, b) => b.time - a.time)
        .slice(0, 5);
      console.log('\n기본 다운로드 폴더 최근 파일:');
      for (const f of recent) {
        console.log(`  ${f.name} (${new Date(f.time).toLocaleString()})`);
      }
    }
  }

  await browser.close();
}

test().catch(console.error);
