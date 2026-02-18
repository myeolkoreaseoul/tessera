/**
 * 네오폰스 51건 증빙파일 다운로드
 * e나라도움 사업별집행내역조회 → 첨부파일 팝업 → 다운로드
 */
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const AdmZip = require('adm-zip');

const BASE_DIR = '/mnt/c/projects/e-naradomum-rpa/downloads/neofons';

async function downloadFromPopup(page, context, atchmnflId, dlDir) {
  const files = [];
  if (!atchmnflId) return files;

  fs.mkdirSync(dlDir, { recursive: true });
  const winPath = dlDir.replace(/^\/mnt\/([a-z])\//, (_, d) => `${d.toUpperCase()}:\\`).replace(/\//g, '\\');

  // 기존 팝업 닫기
  for (const p of context.pages()) {
    if (p.url().includes('getDB003002SView')) await p.close().catch(() => {});
  }
  await page.waitForTimeout(300);

  // 팝업 열기
  const popupPromise = context.waitForEvent('page', { timeout: 8000 });
  await page.evaluate((id) => {
    window.open('/exe/db/db003/getDB003002SView.do?atchmnflId=' + id, '_blank', 'width=700,height=500,scrollbars=yes');
  }, atchmnflId);

  let popup = await popupPromise.catch(() => null);
  if (!popup) {
    await page.waitForTimeout(2000);
    popup = context.pages().find(p => p.url().includes('getDB003002SView'));
  }
  if (!popup) return files;

  try {
    await popup.waitForLoadState('domcontentloaded', { timeout: 10000 });
    await popup.waitForTimeout(2000);

    const hasFn = await popup.evaluate(() => typeof window.f_downloadDB003002S === 'function').catch(() => false);
    if (!hasFn) { await popup.close().catch(() => {}); return files; }

    const cdp = await popup.context().newCDPSession(popup);
    await cdp.send('Page.setDownloadBehavior', { behavior: 'allow', downloadPath: winPath });
    cdp.on('Page.javascriptDialogOpening', async () => {
      try { await cdp.send('Page.handleJavaScriptDialog', { accept: true }); } catch {}
    });
    await cdp.send('Page.enable');

    // 모든 체크박스 선택
    await popup.evaluate(() => {
      document.querySelectorAll('input[type="checkbox"]').forEach(cb => cb.checked = true);
    });

    const filesBefore = new Set(fs.readdirSync(dlDir));

    // 다운로드 실행 + 팝업 자동 확인
    await popup.evaluate(() => {
      const obs = new MutationObserver(() => {
        const mask = document.querySelector('.popupMask.on');
        if (mask) {
          const btn = mask.querySelector('footer button');
          if (btn) setTimeout(() => btn.click(), 200);
        }
      });
      obs.observe(document.body, { subtree: true, attributes: true, attributeFilter: ['class'] });
      window.f_downloadDB003002S();
    });

    // 다운로드 대기 (최대 20초)
    for (let w = 0; w < 20; w++) {
      await new Promise(r => setTimeout(r, 1000));
      try {
        const current = fs.readdirSync(dlDir);
        const newFiles = current.filter(f => !filesBefore.has(f) && !f.endsWith('.crdownload'));
        if (newFiles.length > 0) {
          for (const f of newFiles) {
            const fp = path.join(dlDir, f);
            if (f.toLowerCase().endsWith('.zip')) {
              try {
                const zip = new AdmZip(fp);
                zip.extractAllTo(dlDir, true);
                for (const e of zip.getEntries()) {
                  if (!e.isDirectory) files.push(e.entryName);
                }
                fs.unlinkSync(fp);
              } catch {}
            } else {
              files.push(f);
            }
          }
          break;
        }
      } catch {}
    }
    await cdp.detach().catch(() => {});
  } finally {
    await popup.close().catch(() => {});
  }
  return files;
}

async function main() {
  console.log('=== 네오폰스 증빙파일 다운로드 ===\n');
  fs.mkdirSync(BASE_DIR, { recursive: true });

  const browser = await chromium.connectOverCDP('http://localhost:9444');
  const context = browser.contexts()[0];
  const page = context.pages().find(p => p.url().includes('gosims'));
  if (!page) { console.log('e나라도움 페이지 없음!'); return; }

  // 메인 페이지 다이얼로그 자동 처리
  const mainCdp = await context.newCDPSession(page);
  mainCdp.on('Page.javascriptDialogOpening', async () => {
    try { await mainCdp.send('Page.handleJavaScriptDialog', { accept: true }); } catch {}
  });
  await mainCdp.send('Page.enable');

  // 그리드에서 atchmnflId 추출
  const gridData = await page.evaluate(() => {
    const grid = window.DD001002QGridObj;
    if (!grid) return [];
    return grid.getDataRows().map((row, i) => {
      const v = grid.getRowValue(row);
      return {
        idx: i + 1,
        atchmnflId: v.atchmnflId || '',
        amount: v.excutSumAmount || '',
        purpose: (v.excutPurps || '').substring(0, 50),
        vendor: (v.tradeCorpNm || '').substring(0, 25),
      };
    });
  });

  console.log('그리드 ' + gridData.length + '건 추출\n');

  let done = 0;
  let totalFiles = 0;
  const skipExisting = true;

  for (const row of gridData) {
    const dlDir = path.join(BASE_DIR, 'r' + row.idx);
    done++;

    // 이미 다운로드된 건 스킵
    if (skipExisting && fs.existsSync(dlDir)) {
      const existing = fs.readdirSync(dlDir).filter(f => !f.endsWith('.crdownload'));
      if (existing.length > 0) {
        totalFiles += existing.length;
        console.log('[' + done + '/51] R' + row.idx + ' 스킵 (이미 ' + existing.length + '개 파일)');
        continue;
      }
    }

    const files = await downloadFromPopup(page, context, row.atchmnflId, dlDir);
    totalFiles += files.length;
    console.log('[' + done + '/51] R' + row.idx + ' → ' + files.length + '개 | ' + row.amount + '원 | ' + row.purpose);

    await page.waitForTimeout(500);
  }

  await mainCdp.detach().catch(() => {});
  console.log('\n=== 완료: ' + totalFiles + '개 파일 다운로드 ===');
}

main().catch(console.error);
