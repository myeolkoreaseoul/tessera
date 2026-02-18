/**
 * 다운로드 디버깅 2가지 방식 테스트
 * A) waitForEvent 없이 자연 다운로드 → company-downloads 확인
 * B) download.createReadStream()으로 직접 스트림
 */
const { chromium } = require('playwright');
const fs = require('fs');
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

const DL_DIR = '/home/john/company-downloads';
const LOCAL_DL = '/home/john/e-naradomum-rpa/projects/캠퍼스타운-고려대/downloads';

(async () => {
  if (!fs.existsSync(LOCAL_DL)) fs.mkdirSync(LOCAL_DL, { recursive: true });

  const b = await chromium.connectOverCDP('http://localhost:9445', { timeout: 10000 });
  const page = b.contexts()[0].pages().find(p => p.url().includes('lss.do'));
  if (!page) { console.error('lss.do 탭 없음'); process.exit(1); }

  // 팝업 열기
  console.log('기본서류 클릭...');
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

  // 파일 목록
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

  // === 방법 A: waitForEvent 없이 evaluate 클릭, Chrome 자연 다운로드 ===
  console.log('\n=== 방법 A: evaluate 클릭 (Chrome 자연 다운로드) ===');
  const beforeA = fs.readdirSync(DL_DIR);
  await page.evaluate(() => {
    const btn = document.querySelector('[data-dl-btn="0"]');
    if (btn) btn.click();
  });
  console.log('evaluate 클릭 완료');

  // 10초 대기하면서 company-downloads 감시
  let foundA = null;
  for (let i = 0; i < 20; i++) {
    await sleep(500);
    const after = fs.readdirSync(DL_DIR);
    const newFiles = after.filter(f => !beforeA.includes(f) && !f.endsWith('.crdownload'));
    if (newFiles.length > 0) { foundA = newFiles[0]; break; }
    // 최근 수정 파일
    const recent = after.filter(f => {
      try { return Date.now() - fs.statSync(`${DL_DIR}/${f}`).mtimeMs < 5000; }
      catch { return false; }
    }).filter(f => !f.endsWith('.crdownload'));
    if (recent.length > 0) { foundA = recent[0]; break; }
  }
  console.log('결과 A:', foundA || '파일 없음');

  // === 방법 B: Playwright 네이티브 클릭 + createReadStream ===
  if (files.length > 1) {
    console.log('\n=== 방법 B: Playwright click + createReadStream ===');
    const dlBtn = await page.$('[data-dl-btn="1"]');
    if (dlBtn) {
      const downloadPromise = page.waitForEvent('download', { timeout: 15000 }).catch(() => null);
      await dlBtn.click();
      console.log('Playwright 클릭 완료');

      const download = await downloadPromise;
      if (download) {
        const name = download.suggestedFilename();
        console.log('다운로드 이벤트:', name);

        // createReadStream 시도
        try {
          const stream = await download.createReadStream();
          if (stream) {
            const chunks = [];
            for await (const chunk of stream) {
              chunks.push(chunk);
            }
            const buf = Buffer.concat(chunks);
            const savePath = `${LOCAL_DL}/${name}`;
            fs.writeFileSync(savePath, buf);
            console.log(`✓ 로컬 저장: ${savePath} (${Math.round(buf.length/1024)}KB)`);
          } else {
            console.log('stream null');
          }
        } catch (e) {
          console.log('createReadStream 실패:', e.message);
        }

        // path() 시도
        try {
          const p = await download.path();
          console.log('download.path():', p);
        } catch (e) {
          console.log('path() 실패:', e.message);
        }
      } else {
        console.log('다운로드 이벤트 없음');
      }
    }
  }

  // 팝업 닫기
  await page.evaluate(() => {
    const d = [...document.querySelectorAll('.cl-dialog')].filter(el => el.getBoundingClientRect().width > 100);
    for (const dialog of d) {
      const btn = [...dialog.querySelectorAll('*')].find(el => (el.innerText || '').trim() === '닫기' && el.childElementCount === 0);
      if (btn) { btn.click(); break; }
    }
  });

  // company-downloads 스크린샷
  console.log('\n최근 파일:');
  const recent = fs.readdirSync(DL_DIR)
    .map(f => ({ name: f, mtime: fs.statSync(`${DL_DIR}/${f}`).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime)
    .slice(0, 5);
  recent.forEach(f => console.log(`  ${f.name} (${new Date(f.mtime).toLocaleTimeString()})`));

  await b.close();
})().catch(e => console.error('ERROR:', e.message));
