/**
 * 다운로드 디버깅 — 네트워크 캡처 + Playwright 네이티브 클릭
 */
const { chromium } = require('playwright');
const fs = require('fs');
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

const DL_DIR = '/home/john/company-downloads';

(async () => {
  const b = await chromium.connectOverCDP('http://localhost:9445', { timeout: 10000 });
  const page = b.contexts()[0].pages().find(p => p.url().includes('lss.do'));
  if (!page) { console.error('lss.do 탭 없음'); process.exit(1); }

  // 네트워크 모니터링
  const allRequests = [];
  page.on('request', req => {
    allRequests.push({ url: req.url().substring(0, 150), method: req.method(), time: Date.now() });
  });
  page.on('response', resp => {
    const ct = resp.headers()['content-type'] || '';
    const cd = resp.headers()['content-disposition'] || '';
    if (ct.includes('pdf') || ct.includes('octet') || cd.includes('attachment') ||
        resp.url().includes('download') || resp.url().includes('file') || resp.url().includes('atch')) {
      console.log(`[RESPONSE] ${resp.url().substring(0, 120)} | ${resp.status()} | ${ct} | ${cd.substring(0, 60)}`);
    }
  });

  // 1) 기본서류 클릭 → 팝업 열기
  console.log('=== 기본서류 클릭 ===');
  await page.evaluate(() => {
    const fileExts = ['.pdf', '.jpg', '.hwp', '.xlsx'];
    const el = [...document.querySelectorAll('*')].find(el => {
      if (el.childElementCount > 0) return false;
      const t = (el.innerText || '').trim();
      return t.length > 3 && getComputedStyle(el).cursor === 'pointer' &&
        fileExts.some(ext => t.toLowerCase().endsWith(ext));
    });
    if (el) el.click();
  });
  await sleep(2000);

  // 파일 목록 확인
  const files = await page.evaluate(() => {
    const dialogs = [...document.querySelectorAll('.cl-dialog')]
      .filter(el => el.getBoundingClientRect().width > 100 && (el.innerText || '').includes('첨부파일'));
    if (dialogs.length === 0) return [];
    const popup = dialogs[dialogs.length - 1];
    const exts = ['.pdf', '.jpg', '.hwp', '.xlsx', '.png', '.zip', '.docx'];
    return [...popup.querySelectorAll('*')]
      .filter(el => {
        const t = (el.innerText || '').trim();
        return el.childElementCount === 0 && t.length > 3 && exts.some(ext => t.toLowerCase().endsWith(ext));
      })
      .map(el => (el.innerText || '').trim());
  });
  console.log('파일:', files);

  // 2) Playwright 네이티브 클릭으로 다운로드
  console.log('\n=== 다운로드 (Playwright native click) ===');
  const beforeFiles = fs.readdirSync(DL_DIR);
  const reqCountBefore = allRequests.length;

  // 다운로드 버튼에 고유 속성 부여
  await page.evaluate(() => {
    const dialogs = [...document.querySelectorAll('.cl-dialog')]
      .filter(el => el.getBoundingClientRect().width > 100 && (el.innerText || '').includes('첨부파일'));
    if (dialogs.length === 0) return;
    const btns = [...dialogs[dialogs.length - 1].querySelectorAll('*')]
      .filter(el => (el.innerText || '').trim() === '다운로드' &&
        el.childElementCount === 0 && el.getBoundingClientRect().width > 0);
    btns.forEach((btn, i) => btn.setAttribute('data-dl-btn', i));
  });

  // 첫 번째 다운로드 버튼 Playwright 네이티브 클릭
  const dlBtn = await page.$('[data-dl-btn="0"]');
  if (dlBtn) {
    // download 이벤트 대기
    const downloadPromise = page.waitForEvent('download', { timeout: 10000 }).catch(() => null);
    await dlBtn.click();
    console.log('Playwright 클릭 완료');

    const download = await downloadPromise;
    if (download) {
      console.log(`✓ Download 이벤트: ${download.suggestedFilename()}`);
      try {
        await download.saveAs('/tmp/botem-test-dl.pdf');
        console.log('로컬 저장 완료: /tmp/botem-test-dl.pdf');
      } catch (e) {
        console.log(`저장 실패: ${e.message}`);
      }
    } else {
      console.log('Download 이벤트 없음');
    }
  } else {
    console.log('다운로드 버튼 없음');
  }

  await sleep(3000);

  // 네트워크 요청 확인
  const newReqs = allRequests.slice(reqCountBefore);
  console.log(`\n새 네트워크 요청: ${newReqs.length}건`);
  newReqs.forEach(r => console.log(`  ${r.method} ${r.url}`));

  // company-downloads 새 파일 확인
  const afterFiles = fs.readdirSync(DL_DIR);
  const newFiles = afterFiles.filter(f => !beforeFiles.includes(f));
  console.log(`\n새 다운로드 파일: ${newFiles.length}건`);
  newFiles.forEach(f => console.log(`  ${f}`));

  // 최근 수정 파일
  const recent = afterFiles
    .map(f => ({ name: f, mtime: fs.statSync(`${DL_DIR}/${f}`).mtimeMs }))
    .filter(f => Date.now() - f.mtime < 30000)
    .sort((a, b) => b.mtime - a.mtime);
  console.log(`최근 30초 내 파일: ${recent.map(f => f.name).join(', ') || '없음'}`);

  // 팝업 닫기
  await page.evaluate(() => {
    const dialogs = [...document.querySelectorAll('.cl-dialog')]
      .filter(el => el.getBoundingClientRect().width > 100);
    for (const d of dialogs) {
      const btn = [...d.querySelectorAll('*')]
        .find(el => (el.innerText || '').trim() === '닫기' && el.childElementCount === 0);
      if (btn) { btn.click(); break; }
    }
  });

  await page.screenshot({ path: '/tmp/botem-dl-debug.png' });
  await b.close();
})().catch(e => console.error('ERROR:', e.message));
