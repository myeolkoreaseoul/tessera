/**
 * R1, R9, R10, R11, R12, R23 증빙파일 다운로드
 * e나라도움 상세 페이지에서 첨부파일 다운로드
 */
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

process.on('unhandledRejection', (err) => {
  if (err && err.message && err.message.includes('No dialog is showing')) return;
});

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function dismissModals(page) {
  await page.evaluate(() => {
    document.querySelectorAll('.popupMask.on').forEach(modal => {
      const ok = modal.querySelector('button.fn.ok, .fn.ok, footer button');
      if (ok) ok.click();
    });
  }).catch(() => {});
}

async function waitForGrid(page, gridName, timeout = 15000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const ready = await page.evaluate((name) => {
      const g = window[name];
      return g && typeof g.getDataRows === 'function' && g.getDataRows().length > 0;
    }, gridName).catch(() => false);
    if (ready) return true;
    await sleep(500);
  }
  return false;
}

async function waitModal(page, timeout = 10000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const msg = await page.evaluate(() => {
      const modal = document.querySelector('.popupMask.on');
      if (modal) {
        const msgEl = modal.querySelector('.message');
        const ok = modal.querySelector('button.fn.ok, .fn.ok, footer button');
        const text = msgEl ? msgEl.textContent.trim() : '';
        if (ok) { ok.click(); return text || 'OK'; }
        return text || 'modal_no_ok';
      }
      return null;
    }).catch(() => null);
    if (msg) return msg;
    await sleep(300);
  }
  return null;
}

const MISSING = [
  { rowNum: 1, gridIdx: 0, purpose: '1224 회의비', amount: 246000 },
  { rowNum: 9, gridIdx: 8, purpose: '참여인력 12월 인건비', amount: 3500000 },
  { rowNum: 10, gridIdx: 9, purpose: '회의비', amount: 253800 },
  { rowNum: 11, gridIdx: 10, purpose: '회의비', amount: 234000 },
  { rowNum: 12, gridIdx: 11, purpose: '회의비', amount: 282000 },
  { rowNum: 23, gridIdx: 22, purpose: '1121 회의비', amount: 176000 },
];

const BASE_DIR = '/mnt/c/projects/e-naradomum-rpa/downloads/knuh';

async function downloadFilesForItem(page, item) {
  console.log(`\n=== R${item.rowNum}: ${item.purpose} (${item.amount}원) ===`);

  const destDir = path.join(BASE_DIR, `r${item.rowNum}`);
  fs.mkdirSync(destDir, { recursive: true });

  // 1. DOM 클릭으로 행 선택
  const coords = await page.evaluate((purpose) => {
    const tds = document.querySelectorAll('td');
    for (const td of tds) {
      if (td.textContent.trim() === purpose) {
        const rect = td.getBoundingClientRect();
        if (rect.height > 0 && rect.width > 0) {
          return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
        }
      }
    }
    return null;
  }, item.purpose);

  if (!coords) {
    // 금액으로 시도
    const amtStr = item.amount.toLocaleString();
    const amtCoords = await page.evaluate((amt) => {
      const tds = document.querySelectorAll('td');
      for (const td of tds) {
        if (td.textContent.trim() === amt) {
          const rect = td.getBoundingClientRect();
          if (rect.height > 0 && rect.width > 0) {
            return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
          }
        }
      }
      return null;
    }, amtStr);

    if (amtCoords) {
      await page.mouse.click(amtCoords.x, amtCoords.y);
    } else {
      console.log('  행 클릭 실패');
      return 0;
    }
  } else {
    await page.mouse.click(coords.x, coords.y);
  }
  await sleep(1000);

  // 포커스 확인
  const focused = await page.evaluate(() => {
    const grid = DD001002QGridObj;
    const fr = grid.getFocusedRow();
    if (!fr) return null;
    const rv = grid.getRowValue(fr);
    return { amount: parseInt(String(rv.excutAmount || rv.excutSumAmount).replace(/,/g, '')) };
  });
  if (!focused || focused.amount !== item.amount) {
    console.log(`  포커스 불일치 (${focused?.amount} ≠ ${item.amount})`);
    return 0;
  }

  // 2. 세부내역검토
  await page.click('#DD001002Q_detlListExmnt');
  await sleep(4000);
  await dismissModals(page);
  await waitForGrid(page, 'DD001003SGridObj', 15000);

  // 3. 첨부파일 영역 탐색
  const fileInfo = await page.evaluate(() => {
    const result = { links: [], buttons: [], areas: [] };

    // 파일 다운로드 링크/버튼 찾기
    const allLinks = document.querySelectorAll('a[href*="download"], a[onclick*="download"], a[onclick*="Download"], a[onclick*="file"]');
    allLinks.forEach(a => {
      result.links.push({
        text: a.textContent.trim().substring(0, 50),
        href: (a.href || '').substring(0, 100),
        onclick: (a.getAttribute('onclick') || '').substring(0, 100),
      });
    });

    // 첨부파일 영역 (보통 테이블이나 div)
    const labels = document.querySelectorAll('th, label, span, td');
    labels.forEach(el => {
      if (el.textContent.includes('첨부파일') || el.textContent.includes('증빙파일') || el.textContent.includes('파일목록')) {
        const container = el.closest('tr') || el.closest('div') || el.parentElement;
        if (container) {
          const links = container.querySelectorAll('a');
          links.forEach(a => {
            result.areas.push({
              label: el.textContent.trim().substring(0, 20),
              linkText: a.textContent.trim().substring(0, 50),
              onclick: (a.getAttribute('onclick') || '').substring(0, 150),
              href: (a.href || '').substring(0, 100),
            });
          });
        }
      }
    });

    // IBSheet 파일 그리드 확인
    const fileGrids = [];
    for (const key of Object.keys(window)) {
      if (key.includes('File') && key.includes('Grid') && window[key] && typeof window[key].getDataRows === 'function') {
        const grid = window[key];
        const rows = grid.getDataRows();
        fileGrids.push({
          name: key,
          rows: rows.length,
          data: rows.map(r => {
            const rv = grid.getRowValue(r);
            return rv;
          }),
        });
      }
    }
    result.fileGrids = fileGrids;

    // 모든 a 태그 중 파일명 패턴 (.pdf, .hwp, .jpg, .xlsx 등)
    document.querySelectorAll('a').forEach(a => {
      const text = a.textContent.trim();
      if (/\.(pdf|hwp|jpg|jpeg|png|xlsx|xls|doc|docx|zip)/i.test(text)) {
        result.buttons.push({
          text: text.substring(0, 60),
          onclick: (a.getAttribute('onclick') || '').substring(0, 150),
        });
      }
    });

    // span/div 중 파일명 패턴
    document.querySelectorAll('span, div, td').forEach(el => {
      const text = el.textContent.trim();
      if (/\.(pdf|hwp|jpg|jpeg|png|xlsx)/i.test(text) && text.length < 80 && text.length > 5) {
        const a = el.querySelector('a') || el.closest('a');
        if (a) {
          result.buttons.push({
            text: text.substring(0, 60),
            onclick: (a.getAttribute('onclick') || '').substring(0, 150),
            parentTag: el.tagName,
          });
        }
      }
    });

    return result;
  });

  console.log('  파일 정보:');
  if (fileInfo.links.length) console.log('  다운로드 링크:', JSON.stringify(fileInfo.links));
  if (fileInfo.areas.length) console.log('  첨부파일 영역:', JSON.stringify(fileInfo.areas));
  if (fileInfo.buttons.length) console.log('  파일 버튼:', JSON.stringify(fileInfo.buttons));
  if (fileInfo.fileGrids.length) console.log('  파일 그리드:', JSON.stringify(fileInfo.fileGrids).substring(0, 500));

  const totalFiles = fileInfo.buttons.length + fileInfo.areas.length;
  console.log(`  발견된 파일: ${totalFiles}개`);

  // 4. 파일 다운로드
  let downloaded = 0;
  const fileElements = [...fileInfo.buttons, ...fileInfo.areas];

  for (const file of fileElements) {
    const fileName = (file.text || file.linkText || '').replace(/[<>:"/\\|?*]/g, '_').trim();
    if (!fileName) continue;

    console.log(`  다운로드: ${fileName}`);

    try {
      // 다운로드 이벤트 대기 설정
      const [download] = await Promise.all([
        page.waitForEvent('download', { timeout: 15000 }),
        page.evaluate((onclick) => {
          // onclick 실행
          if (onclick) {
            eval(onclick);
          }
        }, file.onclick),
      ]).catch(() => [null]);

      if (download) {
        const savePath = path.join(destDir, fileName);
        await download.saveAs(savePath);
        downloaded++;
        console.log(`    → 저장: ${savePath}`);
      }
    } catch (err) {
      console.log(`    → 실패: ${err.message?.substring(0, 50)}`);
    }
  }

  // 5. 이전 페이지
  await page.evaluate(() => f_prevPage()).catch(() => {});
  await sleep(3000);
  await dismissModals(page);
  await waitForGrid(page, 'DD001002QGridObj', 10000);

  console.log(`  완료: ${downloaded}/${totalFiles} 파일`);
  return downloaded;
}

async function main() {
  console.log('=== 6건 증빙파일 다운로드 ===\n');

  const browser = await chromium.connectOverCDP('http://localhost:9444');
  const context = browser.contexts()[0];
  let page = context.pages().find(p => p.url().includes('dd001'));
  if (!page) { console.log('페이지 없음'); return; }
  page.on('dialog', async d => { try { await d.accept(); } catch {} });

  await dismissModals(page);

  // XHR 복원
  await page.evaluate(() => {
    const iframe = document.createElement('iframe');
    iframe.style.display = 'none';
    document.body.appendChild(iframe);
    XMLHttpRequest.prototype.open = iframe.contentWindow.XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.send = iframe.contentWindow.XMLHttpRequest.prototype.send;
    document.body.removeChild(iframe);
  });

  // 먼저 첫 번째 항목으로 상세 페이지 구조 탐색
  const item = MISSING[0];
  const total = await downloadFilesForItem(page, item);

  if (total === 0) {
    console.log('\n파일 다운로드 구조를 먼저 확인해야 합니다.');
    console.log('상세 페이지에서 파일 다운로드 UI 탐색 중...');
  }
}

main().catch(console.error);
