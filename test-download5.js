/**
 * 팝업에서 다운로드 → company-downloads에서 PDF 확인
 * 팝업이 이미 열려있는 상태에서 실행
 */
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

const COMPANY_DL = '/home/john/company-downloads';

(async () => {
  const b = await chromium.connectOverCDP('http://localhost:9445', { timeout: 10000 });
  const ctx = b.contexts()[0];
  const page = ctx.pages().find(p => p.url().includes('lss.do'));
  if (!page) { console.error('lss.do 탭 없음'); process.exit(1); }

  // 1) 기본서류 클릭해서 팝업 열기
  console.log('기본서류 클릭...');
  await page.evaluate(() => {
    const fileExts = ['.pdf', '.jpg', '.jpeg', '.png', '.hwp', '.xlsx'];
    const els = [...document.querySelectorAll('*')].filter(el => {
      if (el.childElementCount > 0) return false;
      const text = (el.innerText || '').trim();
      return text.length > 3 && getComputedStyle(el).cursor === 'pointer' &&
        fileExts.some(ext => text.toLowerCase().endsWith(ext));
    });
    if (els.length > 0) { els[0].click(); return els[0].innerText.trim(); }
    return null;
  });
  await sleep(2000);

  // 2) 팝업에서 파일 목록 + 다운로드 전 상태
  const beforeFiles = fs.readdirSync(COMPANY_DL).map(f => f);
  console.log('다운로드 전 파일 수:', beforeFiles.length);

  // 3) 첫 번째 다운로드 버튼 클릭
  console.log('다운로드 클릭...');
  await page.evaluate(() => {
    const dialogs = [...document.querySelectorAll('.cl-dialog, [class*="cl-window"]')]
      .filter(el => el.getBoundingClientRect().width > 100);
    if (dialogs.length === 0) return;
    const popup = dialogs[dialogs.length - 1];
    const btns = [...popup.querySelectorAll('*')]
      .filter(el => (el.innerText || '').trim() === '다운로드' &&
        el.childElementCount === 0 && el.getBoundingClientRect().width > 0);
    if (btns.length > 0) btns[0].click();
  });

  // 4) 다운로드 완료 대기 (company-downloads 폴더 감시)
  let newFile = null;
  for (let i = 0; i < 20; i++) {
    await sleep(1000);
    const afterFiles = fs.readdirSync(COMPANY_DL);
    const diff = afterFiles.filter(f => !beforeFiles.includes(f));
    // .crdownload (다운로드 중) 제외
    const completed = diff.filter(f => !f.endsWith('.crdownload'));
    if (completed.length > 0) {
      newFile = completed[0];
      console.log(`✓ 새 파일 발견: ${newFile}`);
      break;
    }
    // 기존 파일 중 최근 수정된 것도 확인
    const recent = afterFiles.filter(f => {
      try {
        const stat = fs.statSync(path.join(COMPANY_DL, f));
        return (Date.now() - stat.mtimeMs) < 10000; // 10초 이내
      } catch { return false; }
    });
    if (recent.length > 0 && !recent[0].endsWith('.crdownload')) {
      newFile = recent[0];
      console.log(`✓ 최근 파일: ${newFile}`);
      break;
    }
  }

  if (newFile) {
    const filePath = path.join(COMPANY_DL, newFile);
    const stat = fs.statSync(filePath);
    console.log(`파일: ${newFile} (${Math.round(stat.size/1024)}KB)`);

    // PDF면 내용 일부 읽기 (텍스트 추출은 Python으로)
    if (newFile.endsWith('.pdf')) {
      console.log('PDF 파일 → Python으로 텍스트 추출 필요');
    }
  } else {
    console.log('새 파일 없음 — 이미 존재하는 파일로 다운로드됐을 수 있음');
    // 가장 최근 파일 확인
    const allFiles = fs.readdirSync(COMPANY_DL)
      .map(f => ({ name: f, mtime: fs.statSync(path.join(COMPANY_DL, f)).mtimeMs }))
      .sort((a, b) => b.mtime - a.mtime);
    console.log('가장 최근 파일:', allFiles.slice(0, 3).map(f => `${f.name} (${new Date(f.mtime).toLocaleTimeString()})`));
  }

  // 5) 팝업 닫기
  await page.evaluate(() => {
    const dialogs = [...document.querySelectorAll('.cl-dialog')]
      .filter(el => el.getBoundingClientRect().width > 100);
    for (const d of dialogs) {
      const btns = [...d.querySelectorAll('*')]
        .filter(el => (el.innerText || '').trim() === '닫기' && el.childElementCount === 0);
      if (btns.length > 0) { btns[0].click(); break; }
    }
  });

  await b.close();
})().catch(e => console.error('ERROR:', e.message));
