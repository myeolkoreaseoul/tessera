/**
 * 첨부파일 팝업에서 파일 목록 추출 + 다운로드 테스트
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

  // 1) 첨부파일 팝업에서 파일 목록 추출
  const files = await page.evaluate(() => {
    // 첨부파일 팝업의 그리드/테이블에서 파일 정보 추출
    const popup = [...document.querySelectorAll('.cl-dialog, [class*="cl-window"]')]
      .filter(el => el.getBoundingClientRect().width > 0 && (el.innerText || '').includes('첨부파일'));

    if (popup.length === 0) return { error: '팝업 없음' };

    const popupEl = popup[0];
    const text = popupEl.innerText;

    // 그리드 행 찾기
    const rows = [...popupEl.querySelectorAll('[class*="cl-grid-row"], tr')]
      .filter(el => el.getBoundingClientRect().height > 0);

    const fileList = [];
    // 방법 1: 그리드 행에서 추출
    rows.forEach(row => {
      const cells = [...row.querySelectorAll('[class*="cl-grid-cell"], td')]
        .filter(el => el.getBoundingClientRect().width > 0);
      const texts = cells.map(c => (c.innerText || '').trim()).filter(Boolean);
      if (texts.length >= 2) {
        fileList.push({ cells: texts });
      }
    });

    // 방법 2: 텍스트에서 파일명 추출 (fallback)
    const fileExts = ['.pdf', '.jpg', '.jpeg', '.png', '.hwp', '.xlsx', '.xls', '.docx', '.zip'];
    const allTexts = [...popupEl.querySelectorAll('*')]
      .filter(el => el.childElementCount === 0 && el.getBoundingClientRect().width > 0)
      .map(el => (el.innerText || '').trim())
      .filter(t => t.length > 3 && fileExts.some(ext => t.toLowerCase().endsWith(ext)));

    // 다운로드 버튼 찾기
    const downloadBtns = [...popupEl.querySelectorAll('*')]
      .filter(el => {
        const t = (el.innerText || '').trim();
        return t === '다운로드' && el.getBoundingClientRect().width > 0;
      })
      .map(el => ({
        text: '다운로드',
        tag: el.tagName,
        class: el.className.substring(0, 60),
      }));

    return {
      fileList,
      fileNames: allTexts,
      downloadBtnCount: downloadBtns.length,
      popupText: text.substring(0, 500),
    };
  });

  console.log('=== 첨부파일 팝업 ===');
  console.log('파일 행:', JSON.stringify(files.fileList, null, 2));
  console.log('파일명:', files.fileNames);
  console.log('다운로드 버튼:', files.downloadBtnCount);

  // 2) 첫 번째 다운로드 버튼 클릭
  if (files.downloadBtnCount > 0) {
    console.log('\n--- 첫 번째 파일 다운로드 ---');

    // 다운로드 이벤트 대기
    const downloadPromise = page.waitForEvent('download', { timeout: 15000 }).catch(() => null);

    await page.evaluate(() => {
      const popup = [...document.querySelectorAll('.cl-dialog, [class*="cl-window"]')]
        .filter(el => el.getBoundingClientRect().width > 0 && (el.innerText || '').includes('첨부파일'));
      if (popup.length === 0) return;

      const btns = [...popup[0].querySelectorAll('*')]
        .filter(el => (el.innerText || '').trim() === '다운로드' && el.getBoundingClientRect().width > 0 && el.childElementCount === 0);
      if (btns.length > 0) btns[0].click();
    });
    console.log('다운로드 클릭');

    const download = await downloadPromise;
    if (download) {
      const name = download.suggestedFilename();
      const savePath = path.join(DOWNLOAD_DIR, name);
      await download.saveAs(savePath);
      const size = fs.statSync(savePath).size;
      console.log(`✓ 다운로드: ${name} (${Math.round(size/1024)}KB)`);
    } else {
      console.log('다운로드 이벤트 없음 — 회사 PC에 직접 다운로드될 수 있음');
      await sleep(3000);
      // 새 탭 확인
      const pages = ctx.pages();
      for (const p of pages) {
        if (p !== page) {
          console.log(`새 탭: ${p.url().substring(0, 200)}`);
        }
      }
    }
  }

  // 3) 팝업 닫기
  await page.evaluate(() => {
    const popup = [...document.querySelectorAll('.cl-dialog, [class*="cl-window"]')]
      .filter(el => el.getBoundingClientRect().width > 0 && (el.innerText || '').includes('첨부파일'));
    if (popup.length > 0) {
      const closeBtn = [...popup[0].querySelectorAll('*')]
        .filter(el => (el.innerText || '').trim() === '닫기' && el.childElementCount === 0);
      if (closeBtn.length > 0) closeBtn[0].click();
    }
  });

  await b.close();
})().catch(e => console.error('ERROR:', e.message));
