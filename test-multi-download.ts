import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';
import AdmZip from 'adm-zip';

// CDP dialog 에러 무시
process.on('unhandledRejection', (err: any) => {
  if (err?.message?.includes('No dialog is showing')) return;
  console.error('Unhandled:', err?.message?.substring(0, 100));
});

async function test() {
  const browser = await chromium.connectOverCDP('http://localhost:9444');
  const context = browser.contexts()[0];
  const ePage = context.pages().find(p => p.url().includes('getDD001002QView'));

  if (!ePage) {
    console.log('집행내역 페이지 없음');
    await browser.close();
    return;
  }

  console.log('집행내역 페이지 발견:', ePage.url().substring(0, 60));

  // popupMask 제거
  await ePage.evaluate(() => {
    document.querySelectorAll('.popupMask.on').forEach(el => {
      (el as HTMLElement).classList.remove('on');
      (el as HTMLElement).style.display = 'none';
    });
  });

  // 스크롤 컨테이너 찾기
  const containers = await ePage.$$('#DD001002QGridObj .IBSectionScroll');
  let scrollContainer = null;
  let maxH = 0;
  for (const c of containers) {
    const h = await c.evaluate((el: Element) => (el as HTMLElement).scrollHeight);
    if (h > maxH) { maxH = h; scrollContainer = c; }
  }

  // 스크롤 맨 위로
  if (scrollContainer) {
    await scrollContainer.evaluate((el: Element) => { (el as HTMLElement).scrollTop = 0; });
    await ePage.waitForTimeout(500);
  }

  const MAX_DOWNLOADS = 3; // 3건만 테스트
  const processedRowKeys = new Set<string>();
  let downloadCount = 0;

  const baseDir = '/mnt/c/projects/e-naradomum-rpa/downloads/multi-test';
  fs.mkdirSync(baseDir, { recursive: true });

  for (let scroll = 0; scroll < 20 && downloadCount < MAX_DOWNLOADS; scroll++) {
    // popupMask 제거
    await ePage.evaluate(() => {
      document.querySelectorAll('.popupMask.on').forEach(el => {
        (el as HTMLElement).classList.remove('on');
        (el as HTMLElement).style.display = 'none';
      });
    });

    // 현재 보이는 [보기] 셀 정보 가져오기
    const cellInfos = await ePage.evaluate(() => {
      const cells = Array.from(
        document.querySelectorAll('td.IBTextUnderline.HideCol0atchmnflTmp')
      );
      return cells.map((cell, idx) => {
        const tr = cell.closest('tr');
        if (!tr) return { idx, rowKey: `orphan-${idx}` };
        const rowIdx = Array.from(tr.parentElement?.children || []).indexOf(tr);
        const allBodies = document.querySelectorAll('#DD001002QGridObj .IBBodyMid');
        const rowTexts: string[] = [];
        allBodies.forEach(body => {
          const rows = body.querySelectorAll('tr');
          const matchRow = rows[rowIdx];
          if (matchRow) {
            Array.from(matchRow.querySelectorAll('td')).forEach(c => {
              rowTexts.push(c.textContent?.trim() || '');
            });
          }
        });
        return { idx, rowKey: rowTexts.join('|') };
      });
    });

    console.log(`\n--- 스크롤 ${scroll}: ${cellInfos.length}개 [보기] 셀 보임 ---`);

    for (const info of cellInfos) {
      if (processedRowKeys.has(info.rowKey)) continue;
      if (downloadCount >= MAX_DOWNLOADS) break;

      processedRowKeys.add(info.rowKey);
      downloadCount++;

      console.log(`\n[${downloadCount}/${MAX_DOWNLOADS}] 다운로드 시도...`);

      // 셀 다시 쿼리
      const freshCells = await ePage.$$('td.IBTextUnderline.HideCol0atchmnflTmp');
      const cell = freshCells[info.idx];
      if (!cell) {
        console.log('  셀 없음, 스킵');
        continue;
      }

      // 팝업 이벤트 대기
      const popupPromise = context.waitForEvent('page', { timeout: 10000 });
      await cell.click({ timeout: 5000 });

      const popup = await popupPromise.catch(() => null);
      if (!popup) {
        console.log('  팝업 안 열림');
        await ePage.evaluate(() => {
          document.querySelectorAll('.popupMask.on').forEach(el => {
            (el as HTMLElement).classList.remove('on');
            (el as HTMLElement).style.display = 'none';
          });
        });
        continue;
      }

      // URL 대기
      if (popup.url() === 'about:blank') {
        await popup.waitForURL(/gosims/, { timeout: 15000 }).catch(() => {});
      }
      await popup.waitForLoadState('domcontentloaded');
      await popup.waitForTimeout(1000);

      console.log('  팝업:', popup.url().substring(0, 60));

      // 다운로드 디렉토리
      const dlDir = path.join(baseDir, `record-${downloadCount}`);
      fs.mkdirSync(dlDir, { recursive: true });
      const winPath = dlDir
        .replace(/^\/mnt\/([a-z])\//, (_, d) => `${d.toUpperCase()}:\\`)
        .replace(/\//g, '\\');

      // CDP 다운로드 설정
      const cdp = await popup.context().newCDPSession(popup);
      await cdp.send('Page.setDownloadBehavior', {
        behavior: 'allow',
        downloadPath: winPath,
      });
      cdp.on('Page.javascriptDialogOpening', async () => {
        try { await cdp.send('Page.handleJavaScriptDialog', { accept: true }); } catch {}
      });
      await cdp.send('Page.enable');

      // 체크박스 선택
      await popup.evaluate(() => {
        document.querySelectorAll('input[type="checkbox"]').forEach(cb => {
          (cb as HTMLInputElement).checked = true;
        });
      });

      const filesBefore = new Set(fs.readdirSync(dlDir));

      // 다운로드 호출
      await popup.evaluate(() => {
        const obs = new MutationObserver(() => {
          const mask = document.querySelector('.popupMask.on') as HTMLElement;
          if (mask) {
            const btn = mask.querySelector('footer button') as HTMLElement;
            if (btn) setTimeout(() => btn.click(), 200);
          }
        });
        obs.observe(document.body, { subtree: true, attributes: true, attributeFilter: ['class'] });
        (window as any).f_downloadDB003002S();
      });

      // 다운로드 대기
      let downloaded = false;
      for (let w = 0; w < 20; w++) {
        await new Promise(r => setTimeout(r, 1000));
        try {
          const files = fs.readdirSync(dlDir);
          const newFiles = files.filter(f => !filesBefore.has(f) && !f.endsWith('.crdownload'));
          if (newFiles.length > 0) {
            for (const f of newFiles) {
              const size = fs.statSync(path.join(dlDir, f)).size;
              console.log(`  다운로드: ${f} (${size} bytes)`);

              // ZIP 해제
              if (f.toLowerCase().endsWith('.zip')) {
                try {
                  const zip = new AdmZip(path.join(dlDir, f));
                  zip.extractAllTo(dlDir, true);
                  const entries = zip.getEntries();
                  console.log(`  ZIP 해제: ${entries.length}개 파일`);
                  for (const e of entries) {
                    if (!e.isDirectory) {
                      console.log(`    - ${e.entryName}`);
                    }
                  }
                  fs.unlinkSync(path.join(dlDir, f));
                } catch (ze) {
                  console.log(`  ZIP 해제 실패: ${ze}`);
                }
              }
            }
            downloaded = true;
            break;
          }
        } catch {}
      }

      if (!downloaded) console.log('  다운로드 안 됨 (20초 타임아웃)');

      await cdp.detach().catch(() => {});
      await popup.close().catch(() => {});

      // 팝업 닫은 후 잠시 대기
      await ePage.waitForTimeout(500);
    }

    // 스크롤 다운
    if (scrollContainer && downloadCount < MAX_DOWNLOADS) {
      await scrollContainer.evaluate((el: Element) => {
        const step = 30 * 5;
        (el as HTMLElement).scrollTop += step;
        el.dispatchEvent(new WheelEvent('wheel', {
          deltaY: step, deltaMode: 0, bubbles: true, cancelable: true,
        }));
        el.dispatchEvent(new Event('scroll', { bubbles: true }));
      });
      await ePage.waitForTimeout(400);
    }
  }

  console.log(`\n=== 완료: ${downloadCount}건 다운로드 ===`);

  // 결과 확인
  const dirs = fs.readdirSync(baseDir).filter(d =>
    fs.statSync(path.join(baseDir, d)).isDirectory()
  );
  for (const d of dirs) {
    const files = fs.readdirSync(path.join(baseDir, d));
    console.log(`${d}/: ${files.join(', ')}`);
  }

  await browser.close();
}

test().catch(console.error);
