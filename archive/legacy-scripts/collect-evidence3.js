/**
 * 보탬e 증빙 수집 + 다운로드
 * 각 건: 기본서류 클릭 → 팝업에서 파일 목록 + 모든 파일 다운로드 → 닫기 → 다음
 *
 * 다운로드 파일은 회사 PC → /home/john/company-downloads/
 */
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

const LIMIT  = parseInt((process.argv.find(a => a.startsWith('--limit=')) || '--limit=9999').split('=')[1]);

const DIR    = path.join(__dirname, 'projects/캠퍼스타운-고려대');
const OUTPUT = path.join(DIR, 'evidence.json');
const DL_DIR = '/home/john/company-downloads';

function loadEvidence() {
  try { return JSON.parse(fs.readFileSync(OUTPUT, 'utf-8')); }
  catch { return []; }
}
function saveEvidence(data) {
  fs.writeFileSync(OUTPUT, JSON.stringify(data, null, 2));
}

// 다운로드 완료 대기 (company-downloads에서 새 파일 감지)
async function waitForDownload(beforeFiles, timeout = 8000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    await sleep(500);
    try {
      const afterFiles = fs.readdirSync(DL_DIR);
      const newFiles = afterFiles.filter(f => !beforeFiles.includes(f) && !f.endsWith('.crdownload'));
      if (newFiles.length > 0) return newFiles[0];
      // 기존 파일이 갱신됐는지 확인
      for (const f of afterFiles) {
        if (f.endsWith('.crdownload')) continue;
        const stat = fs.statSync(path.join(DL_DIR, f));
        if (Date.now() - stat.mtimeMs < 3000 && !beforeFiles.includes(f + '_checked')) {
          return f;
        }
      }
    } catch {}
  }
  return null;
}

(async () => {
  const b = await chromium.connectOverCDP('http://localhost:9445', { timeout: 10000 });
  const page = b.contexts()[0].pages().find(p => p.url().includes('lss.do'));
  if (!page) { console.error('lss.do 탭 없음'); process.exit(1); }

  // CDP 다운로드 설정 — Playwright 가로채기 방지, Chrome 자연 다운로드
  const client = await page.context().newCDPSession(page);
  await client.send('Page.setDownloadBehavior', {
    behavior: 'allow',
    downloadPath: 'C:\\Users\\정동회계법인\\Downloads'
  }).catch(() => {});
  await client.send('Browser.setDownloadBehavior', {
    behavior: 'allow',
    downloadPath: 'C:\\Users\\정동회계법인\\Downloads'
  }).catch(() => {});
  console.log('CDP 다운로드 설정 완료');

  const evidence = loadEvidence();
  let collected = 0;

  for (let step = 0; collected < LIMIT; step++) {
    // 현재 건 정보
    const info = await page.evaluate(() => {
      const text = document.body.innerText;
      const purposeM = text.match(/집행목적\(용도\)\n(.+)/);
      const evidTypeM = text.match(/증빙유형\n(.+)/);
      const amountM = text.match(/공급가액\n([\d,]+)/);
      const vendorM = text.match(/거래처명\n(.+)/);

      // 증빙자료 텍스트 (전자세금계산서 등)
      const evidDataM = text.match(/증빙자료\n(.+?)(\n증빙서류|\n기본서류|\n집행등록일)/s);

      // 기본서류 클릭 가능 여부
      const fileExts = ['.pdf', '.jpg', '.jpeg', '.png', '.hwp', '.xlsx', '.xls', '.docx', '.zip'];
      const hasFile = [...document.querySelectorAll('*')].some(el => {
        if (el.childElementCount > 0) return false;
        const t = (el.innerText || '').trim();
        return t.length > 3 && getComputedStyle(el).cursor === 'pointer' &&
          fileExts.some(ext => t.toLowerCase().endsWith(ext));
      });

      return {
        purpose: (purposeM?.[1] || '').trim(),
        evidenceType: (evidTypeM?.[1] || '').trim(),
        evidenceData: (evidDataM?.[1] || '').trim(),
        amount: (amountM?.[1] || '').replace(/,/g, ''),
        vendor: (vendorM?.[1] || '').trim(),
        hasFile,
      };
    });

    console.log(`[${step + 1}] ${info.purpose?.substring(0, 55)}`);

    let fileList = [];
    let downloadedFiles = [];

    if (info.hasFile) {
      // 기본서류 클릭 → 팝업 열기
      await page.evaluate(() => {
        const fileExts = ['.pdf', '.jpg', '.jpeg', '.png', '.hwp', '.xlsx', '.xls', '.docx', '.zip'];
        const els = [...document.querySelectorAll('*')].filter(el => {
          if (el.childElementCount > 0) return false;
          const t = (el.innerText || '').trim();
          return t.length > 3 && getComputedStyle(el).cursor === 'pointer' &&
            fileExts.some(ext => t.toLowerCase().endsWith(ext));
        });
        if (els.length > 0) els[0].click();
      });
      await sleep(1500);

      // 파일 목록 추출
      fileList = await page.evaluate(() => {
        const dialogs = [...document.querySelectorAll('.cl-dialog, [class*="cl-window"]')]
          .filter(el => el.getBoundingClientRect().width > 100 && (el.innerText || '').includes('첨부파일'));
        if (dialogs.length === 0) return [];

        const popup = dialogs[dialogs.length - 1];
        const fileExts = ['.pdf', '.jpg', '.jpeg', '.png', '.hwp', '.xlsx', '.xls', '.docx', '.zip'];
        return [...popup.querySelectorAll('*')]
          .filter(el => {
            const t = (el.innerText || '').trim();
            return el.childElementCount === 0 && t.length > 3 &&
              fileExts.some(ext => t.toLowerCase().endsWith(ext));
          })
          .map(el => (el.innerText || '').trim());
      });

      console.log(`  파일: ${fileList.join(' | ')}`);

      // 각 파일 다운로드
      const dlBtnCount = await page.evaluate(() => {
        const dialogs = [...document.querySelectorAll('.cl-dialog')]
          .filter(el => el.getBoundingClientRect().width > 100 && (el.innerText || '').includes('첨부파일'));
        if (dialogs.length === 0) return 0;
        return [...dialogs[dialogs.length - 1].querySelectorAll('*')]
          .filter(el => (el.innerText || '').trim() === '다운로드' &&
            el.childElementCount === 0 && el.getBoundingClientRect().width > 0).length;
      });

      for (let fi = 0; fi < dlBtnCount; fi++) {
        const beforeFiles = fs.readdirSync(DL_DIR);
        // fi번째 다운로드 버튼 클릭
        await page.evaluate((idx) => {
          const dialogs = [...document.querySelectorAll('.cl-dialog')]
            .filter(el => el.getBoundingClientRect().width > 100 && (el.innerText || '').includes('첨부파일'));
          if (dialogs.length === 0) return;
          const btns = [...dialogs[dialogs.length - 1].querySelectorAll('*')]
            .filter(el => (el.innerText || '').trim() === '다운로드' &&
              el.childElementCount === 0 && el.getBoundingClientRect().width > 0);
          if (btns[idx]) btns[idx].click();
        }, fi);

        const newFile = await waitForDownload(beforeFiles, 6000);
        if (newFile) {
          downloadedFiles.push(newFile);
          console.log(`  ✓ 다운: ${newFile}`);
        } else {
          // 파일명으로 이미 존재하는지 확인
          const expected = fileList[fi];
          if (expected && fs.existsSync(path.join(DL_DIR, expected))) {
            downloadedFiles.push(expected);
            console.log(`  ↺ 이미 있음: ${expected}`);
          } else {
            console.log(`  ⚠️ 다운 실패: ${fileList[fi] || fi}`);
          }
        }
      }

      // 팝업 닫기
      await page.evaluate(() => {
        const dialogs = [...document.querySelectorAll('.cl-dialog')]
          .filter(el => el.getBoundingClientRect().width > 100);
        for (const d of dialogs) {
          const btns = [...d.querySelectorAll('*')]
            .filter(el => ['닫기', '×'].includes((el.innerText || '').trim()) && el.childElementCount === 0);
          if (btns.length > 0) { btns[0].click(); break; }
        }
      });
      await sleep(500);
    } else {
      console.log(`  (기본서류 없음)`);
    }

    // 저장
    const item = {
      idx: step + 1,
      purpose: info.purpose,
      evidenceType: info.evidenceType,
      evidenceData: info.evidenceData,
      amount: info.amount,
      vendor: info.vendor,
      files: fileList,
      downloaded: downloadedFiles,
    };

    const existIdx = evidence.findIndex(e => e.purpose === info.purpose && e.amount === info.amount);
    if (existIdx >= 0) evidence[existIdx] = item;
    else evidence.push(item);
    collected++;

    // 주기적 저장
    if (collected % 20 === 0) {
      saveEvidence(evidence);
      console.log(`  [저장] ${evidence.length}건`);
    }

    // 다음 건
    const moved = await page.evaluate(() => {
      const btns = [...document.querySelectorAll('*')].filter(el =>
        (el.innerText || '').trim() === '다음 집행정보 보기' &&
        el.getBoundingClientRect().width > 0 && el.childElementCount === 0
      );
      if (btns.length > 0) { btns[0].click(); return true; }
      return false;
    });
    if (!moved) { console.log('마지막 건'); break; }
    await sleep(1200);
  }

  saveEvidence(evidence);
  console.log(`\n완료: ${collected}건, 총 ${evidence.length}건`);
  await b.close();
})().catch(e => console.error('ERROR:', e.message));
