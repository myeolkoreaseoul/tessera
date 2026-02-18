/**
 * 기본서류 PDF 다운로드 테스트
 * cursor:pointer + 파란색 DIV 클릭 방식
 */
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

const DOWNLOAD_DIR = path.join(__dirname, 'projects/캠퍼스타운-고려대/downloads');

(async () => {
  if (!fs.existsSync(DOWNLOAD_DIR)) fs.mkdirSync(DOWNLOAD_DIR, { recursive: true });

  const b = await chromium.connectOverCDP('http://localhost:9445', { timeout: 10000 });
  const ctx = b.contexts()[0];
  const page = ctx.pages().find(p => p.url().includes('lss.do'));
  if (!page) { console.error('lss.do 탭 없음'); process.exit(1); }

  // 기본서류 파일명 찾기 (cursor:pointer + 파란색 + .pdf/.jpg 등)
  const fileInfo = await page.evaluate(() => {
    const fileExts = ['.pdf', '.jpg', '.jpeg', '.png', '.hwp', '.xlsx', '.xls', '.docx', '.zip'];
    const els = [...document.querySelectorAll('*')].filter(el => {
      if (el.childElementCount > 0) return false;
      const r = el.getBoundingClientRect();
      if (r.width === 0) return false;
      const text = (el.innerText || '').trim();
      const style = getComputedStyle(el);
      return text.length > 3 && style.cursor === 'pointer' &&
        fileExts.some(ext => text.toLowerCase().endsWith(ext));
    });
    return els.map(el => ({
      text: (el.innerText || '').trim(),
      tag: el.tagName,
      class: el.className.substring(0, 60),
      color: getComputedStyle(el).color,
      // 부모 구조로 기본서류/증빙서류 구분
      context: (() => {
        let p = el.parentElement;
        for (let i = 0; i < 8 && p; i++) {
          const t = (p.innerText || '');
          if (t.includes('기본서류') && t.length < 500) return '기본서류';
          if (t.includes('증빙서류') && t.length < 500) return '증빙서류';
          p = p.parentElement;
        }
        return 'unknown';
      })(),
    }));
  });

  console.log('=== 파일 링크 ===');
  fileInfo.forEach(f => console.log(`  [${f.context}] "${f.text}" <${f.tag}>`));

  if (fileInfo.length === 0) {
    console.log('파일 없음');
    await b.close();
    return;
  }

  // 첫 번째 파일 다운로드 시도
  const target = fileInfo[0];
  console.log(`\n다운로드 대상: "${target.text}"`);

  // 방법 1: download 이벤트 대기 + 클릭
  const pagesBefore = ctx.pages().length;

  // CDP로 다운로드 감지 설정
  const client = await page.context().newCDPSession(page);
  await client.send('Browser.setDownloadBehavior', {
    behavior: 'allowAndName',
    downloadPath: DOWNLOAD_DIR,
  }).catch(() => {});

  // 다운로드 이벤트 or 새 페이지 대기
  const downloadPromise = page.waitForEvent('download', { timeout: 10000 }).catch(() => null);
  const popupPromise = ctx.waitForEvent('page', { timeout: 10000 }).catch(() => null);

  // 클릭
  await page.evaluate((fileName) => {
    const els = [...document.querySelectorAll('*')].filter(el =>
      el.childElementCount === 0 &&
      (el.innerText || '').trim() === fileName &&
      getComputedStyle(el).cursor === 'pointer'
    );
    if (els.length > 0) els[0].click();
  }, target.text);
  console.log('클릭 완료');

  // 결과 대기
  const download = await downloadPromise;
  const newPage = await popupPromise;

  if (download) {
    const name = download.suggestedFilename();
    const savePath = path.join(DOWNLOAD_DIR, name);
    await download.saveAs(savePath);
    console.log(`✓ 다운로드 완료: ${name} (${Math.round(fs.statSync(savePath).size/1024)}KB)`);
  } else if (newPage) {
    const newUrl = newPage.url();
    console.log(`새 탭/팝업: ${newUrl.substring(0, 200)}`);
    await sleep(2000);
    await newPage.screenshot({ path: '/tmp/botem-new-tab.png' });
    console.log('스크린샷: /tmp/botem-new-tab.png');
  } else {
    console.log('다운로드/팝업 없음');
    await sleep(2000);
    // 페이지 수 확인
    const pagesAfter = ctx.pages().length;
    console.log(`탭 수: ${pagesBefore} → ${pagesAfter}`);

    // 네트워크 요청 확인 (파일 다운로드 URL)
    await page.screenshot({ path: '/tmp/botem-after-click.png' });
    console.log('스크린샷: /tmp/botem-after-click.png');
  }

  await b.close();
})().catch(e => console.error('ERROR:', e.message));
