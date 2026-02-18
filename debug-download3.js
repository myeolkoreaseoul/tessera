/**
 * CDP 직접 다운로드 설정 → Chrome 자연 다운로드
 * Playwright download 이벤트를 사용하지 않음
 */
const { chromium } = require('playwright');
const fs = require('fs');
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

const DL_DIR = '/home/john/company-downloads';

(async () => {
  const b = await chromium.connectOverCDP('http://localhost:9445', { timeout: 10000 });
  const page = b.contexts()[0].pages().find(p => p.url().includes('lss.do'));
  if (!page) { console.error('lss.do 탭 없음'); process.exit(1); }

  // CDP 세션으로 다운로드 동작 설정 → Chrome 기본 다운로드 허용
  const client = await page.context().newCDPSession(page);

  // 방법 1: Page.setDownloadBehavior
  try {
    await client.send('Page.setDownloadBehavior', {
      behavior: 'allow',
      downloadPath: 'C:\\Users\\정동회계법인\\Downloads'
    });
    console.log('✓ Page.setDownloadBehavior 설정');
  } catch (e) {
    console.log('Page.setDownloadBehavior 실패:', e.message);
  }

  // 방법 2: Browser.setDownloadBehavior (fallback)
  try {
    await client.send('Browser.setDownloadBehavior', {
      behavior: 'allow',
      downloadPath: 'C:\\Users\\정동회계법인\\Downloads'
    });
    console.log('✓ Browser.setDownloadBehavior 설정');
  } catch (e) {
    console.log('Browser.setDownloadBehavior 실패:', e.message);
  }

  // 팝업 열기
  console.log('\n기본서류 클릭...');
  await page.evaluate(() => {
    const exts = ['.pdf', '.jpg', '.hwp', '.xlsx', '.png', '.zip'];
    const el = [...document.querySelectorAll('*')].find(el => {
      if (el.childElementCount > 0) return false;
      const t = (el.innerText || '').trim();
      return t.length > 3 && getComputedStyle(el).cursor === 'pointer' &&
        exts.some(ext => t.toLowerCase().endsWith(ext));
    });
    if (el) el.click();
  });
  await sleep(2000);

  const files = await page.evaluate(() => {
    const dialogs = [...document.querySelectorAll('.cl-dialog')]
      .filter(el => el.getBoundingClientRect().width > 100 && (el.innerText || '').includes('첨부파일'));
    if (dialogs.length === 0) return [];
    const exts = ['.pdf', '.jpg', '.hwp', '.xlsx', '.png', '.zip', '.docx'];
    return [...dialogs[dialogs.length - 1].querySelectorAll('*')]
      .filter(el => el.childElementCount === 0 && exts.some(ext => (el.innerText || '').trim().toLowerCase().endsWith(ext)))
      .map(el => (el.innerText || '').trim());
  });
  console.log('파일:', files);

  // 다운로드 버튼 태그
  await page.evaluate(() => {
    const dialogs = [...document.querySelectorAll('.cl-dialog')]
      .filter(el => el.getBoundingClientRect().width > 100 && (el.innerText || '').includes('첨부파일'));
    if (dialogs.length === 0) return;
    const btns = [...dialogs[dialogs.length - 1].querySelectorAll('*')]
      .filter(el => (el.innerText || '').trim() === '다운로드' && el.childElementCount === 0 && el.getBoundingClientRect().width > 0);
    btns.forEach((btn, i) => btn.setAttribute('data-dl-btn', i));
  });

  // 다운로드 (Playwright download 이벤트 쓰지 않음, evaluate 클릭)
  console.log('\n다운로드 시도 (CDP allow, 이벤트 가로채기 없음)...');
  const beforeFiles = fs.readdirSync(DL_DIR);

  await page.evaluate(() => {
    const btn = document.querySelector('[data-dl-btn="0"]');
    if (btn) btn.click();
  });
  console.log('클릭 완료, 대기...');

  // 15초 대기
  let found = null;
  for (let i = 0; i < 30; i++) {
    await sleep(500);
    try {
      const afterFiles = fs.readdirSync(DL_DIR);
      // 새 파일 (crdownload 제외)
      const newFiles = afterFiles.filter(f => !beforeFiles.includes(f) && !f.endsWith('.crdownload'));
      if (newFiles.length > 0) { found = newFiles[0]; break; }
      // 최근 수정
      const recent = afterFiles.filter(f => {
        try { return !f.endsWith('.crdownload') && Date.now() - fs.statSync(`${DL_DIR}/${f}`).mtimeMs < 3000; }
        catch { return false; }
      });
      if (recent.length > 0 && !beforeFiles.includes(recent[0] + '_seen')) { found = recent[0]; break; }
    } catch {}
  }

  if (found) {
    const size = fs.statSync(`${DL_DIR}/${found}`).size;
    console.log(`✓ 다운로드 성공: ${found} (${Math.round(size/1024)}KB)`);
  } else {
    console.log('다운로드 실패 — company-downloads에 새 파일 없음');
    // 스크린샷으로 Chrome 다운로드 바 확인
    await page.screenshot({ path: '/tmp/botem-dl3.png' });
    console.log('스크린샷: /tmp/botem-dl3.png');
  }

  // 팝업 닫기
  await page.evaluate(() => {
    const d = [...document.querySelectorAll('.cl-dialog')].filter(el => el.getBoundingClientRect().width > 100);
    for (const dialog of d) {
      const btn = [...dialog.querySelectorAll('*')].find(el => (el.innerText || '').trim() === '닫기' && el.childElementCount === 0);
      if (btn) { btn.click(); break; }
    }
  });

  await b.close();
})().catch(e => console.error('ERROR:', e.message));
