/**
 * 칠곡경북대학교병원 전체 파이프라인
 * Phase 0: 네비게이션 (점검대상사업조회 → 집행내역)
 * Phase 1: 그리드 데이터 추출
 * Phase 2: 첨부파일 다운로드
 * Phase 3: OCR
 * Phase 4: chilgok-data.json 저장
 */
process.on('unhandledRejection', (err) => {
  if (err && err.message && err.message.includes('No dialog is showing')) return;
  console.error('UnhandledRejection:', err);
});

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const AdmZip = require('adm-zip');
const { extractPdfText, extractHwpText, extractImageText, extractExcelText } = require('./lib/collect-generic');
const nav = require('./lib/navigate');

const INST_NAME = '경북대학교병원';
const PROJECT_KW = '칠곡경북대학교병원';
const BASE_DIR = path.join(__dirname, 'downloads/chilgok');
const OUTPUT = path.join(__dirname, 'chilgok-data.json');

function fmtDate(d) {
  if (!d) return '';
  const s = String(d);
  if (s.length === 8) return `${s.slice(0,4)}-${s.slice(4,6)}-${s.slice(6,8)}`;
  return s;
}

// ── 그리드 전체 데이터 추출 ──
async function extractAllGridData(page) {
  const currentRows = await page.evaluate(() => {
    const grid = window.DD001002QGridObj;
    return grid ? grid.getDataRows().length : 0;
  });

  if (currentRows === 0) {
    await page.evaluate(() => {
      const sel = document.getElementById('DD001002Q_selPageSize');
      if (sel) {
        const opts = [...sel.options].map(o => o.value);
        if (opts.includes('100')) { sel.value = '100'; sel.dispatchEvent(new Event('change')); }
        else if (opts.includes('50')) { sel.value = '50'; sel.dispatchEvent(new Event('change')); }
      }
      const btn = document.getElementById('DD001002Q_btnRetrieve') ||
                  [...document.querySelectorAll('button')].find(b => b.textContent.trim() === '검색' && b.offsetWidth > 0);
      if (btn) btn.click();
    });
    console.log('  페이지 사이즈 변경 → 재검색...');
    await new Promise(r => setTimeout(r, 4000));
  } else {
    console.log(`  현재 그리드 ${currentRows}건 로드됨`);
  }

  const allRows = [];
  let pageNum = 1;

  while (true) {
    const pageData = await page.evaluate(() => {
      const grid = window.DD001002QGridObj;
      if (!grid) return { rows: [], total: 0 };
      const dataRows = grid.getDataRows();
      const rows = dataRows.map(row => {
        const v = grid.getRowValue(row);
        return {
          excutExecutDe: v.excutExecutDe || '',
          excutRegistDe: v.excutRegistDe || '',
          writngDe: v.writngDe || '',
          prufSeNm: v.prufSeNm || '',
          etcPruf: v.etcPruf || '',
          excutPrposCn: v.excutPrposCn || '',
          asstnExpitmNm: v.asstnExpitmNm || '',
          asstnTaxitmNm: v.asstnTaxitmNm || '',
          prdlstNm: v.prdlstNm || '',
          bcncCmpnyNm: v.bcncCmpnyNm || '',
          dpstrNm: v.dpstrNm || '',
          bcncIndutyNm: v.bcncIndutyNm || '',
          excutSplpc: v.excutSplpc || 0,
          excutVat: v.excutVat || 0,
          rcvrySumAmount: v.rcvrySumAmount || 0,
          lastAmount: v.lastAmount || 0,
          nrcgnAmount: v.nrcgnAmount || 0,
          atchmnflId: v.atchmnflId || '',
          excutId: v.excutId || '',
          exmntPrgstNm: v.exmntPrgstNm || '',
        };
      });
      const totalEl = document.getElementById('DD001002Q_searchCnt');
      const totalMatch = totalEl ? totalEl.textContent.match(/(\d+)/) : null;
      const total = totalMatch ? parseInt(totalMatch[1]) : (dataRows.length > 0 ? grid.getRowValue(dataRows[0]).totalNum || 0 : 0);
      return { rows, total };
    });

    allRows.push(...pageData.rows);
    console.log(`  페이지 ${pageNum}: ${pageData.rows.length}건 (누적 ${allRows.length}/${pageData.total}건)`);

    if (allRows.length >= pageData.total || pageData.rows.length === 0) break;

    pageNum++;
    const hasNext = await page.evaluate((pn) => {
      try { f_retrieveListBsnsExcutDetl(pn); return true; } catch { return false; }
    }, pageNum);

    if (!hasNext) break;
    await new Promise(r => setTimeout(r, 3000));
  }

  return { allRows, total: allRows.length };
}

// ── 첨부파일 다운로드 ──
async function downloadFromPopup(page, context, atchmnflId, dlDir) {
  const files = [];
  if (!atchmnflId) return files;

  fs.mkdirSync(dlDir, { recursive: true });
  const winPath = dlDir.replace(/^\/mnt\/([a-z])\//, (_, d) => `${d.toUpperCase()}:\\`).replace(/\//g, '\\');

  for (const p of context.pages()) {
    if (p.url().includes('getDB003002SView')) await p.close().catch(() => {});
  }
  await page.waitForTimeout(300);

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
    popup.on('dialog', async d => { try { await d.accept(); } catch {} });
    await popup.waitForLoadState('domcontentloaded', { timeout: 10000 });
    await popup.waitForTimeout(2000);

    const hasFn = await popup.evaluate(() => typeof window.f_downloadDB003002S === 'function').catch(() => false);
    if (!hasFn) { await popup.close().catch(() => {}); return files; }

    const cdp = await popup.context().newCDPSession(popup);
    await cdp.send('Page.setDownloadBehavior', { behavior: 'allow', downloadPath: winPath });

    await popup.evaluate(() => {
      document.querySelectorAll('input[type="checkbox"]').forEach(cb => cb.checked = true);
    });

    const filesBefore = new Set(fs.readdirSync(dlDir));

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

    for (let w = 0; w < 25; w++) {
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

// ── OCR ──
const EXTS = ['.pdf', '.xlsx', '.xls', '.hwp', '.jpg', '.jpeg', '.png'];

async function ocrDir(dlDir) {
  const result = [];
  if (!fs.existsSync(dlDir)) return result;

  const fileNames = fs.readdirSync(dlDir).filter(f =>
    EXTS.some(e => f.toLowerCase().endsWith(e))
  );

  for (const fn of fileNames) {
    const fp = path.join(dlDir, fn);
    const fnLower = fn.toLowerCase();
    let text = '';

    if (fnLower.endsWith('.pdf')) text = await extractPdfText(fp);
    else if (fnLower.endsWith('.xlsx') || fnLower.endsWith('.xls')) text = await extractExcelText(fp);
    else if (fnLower.endsWith('.hwp')) text = extractHwpText(fp);
    else if (/\.(jpg|jpeg|png)$/.test(fnLower)) text = extractImageText(fp);

    result.push({ name: fn, text: text.substring(0, 4000) });
  }
  return result;
}

// ── 메인 ──
async function main() {
  console.log(`=== ${INST_NAME} 파이프라인 시작 ===\n`);
  fs.mkdirSync(BASE_DIR, { recursive: true });

  // ── Phase 0: 네비게이션 ──
  console.log('[Phase 0] 네비게이션...');
  const { page, context, selected } = await nav.goToInstitution({
    institutionName: INST_NAME,
    projectKeyword: PROJECT_KW,
    year: 2025,
  });
  console.log(`  사업: ${selected.taskNm}`);
  console.log(`  상태: ${selected.excutLmttResnNm}`);
  console.log(`  집행건: ${selected.gridCount}건\n`);

  // DD001002Q 정산구분 중간정산 설정
  if (selected.excutLmttResnNm === '사업수행중') {
    await page.evaluate(() => {
      const r2 = document.getElementById('DD001002Q_excclcSeCode_2');
      if (r2 && !r2.checked) r2.click();
    });
    console.log('  DD001002Q 중간정산 설정\n');

    // 중간정산으로 재검색
    await page.evaluate(() => {
      const btn = document.getElementById('DD001002Q_btnRetrieve') ||
                  [...document.querySelectorAll('button')].find(b => b.textContent.trim() === '검색' && b.offsetWidth > 0);
      if (btn) btn.click();
    });
    await new Promise(r => setTimeout(r, 3000));
  }

  // ── Phase 1: 그리드 데이터 추출 ──
  console.log('[Phase 1] 그리드 데이터 추출...');
  const { allRows, total } = await extractAllGridData(page);
  console.log(`  총 ${total}건 추출 완료\n`);

  const records = allRows.map((r, i) => ({
    rowNum: i + 1,
    executionDate: fmtDate(r.excutExecutDe),
    registDate: fmtDate(r.excutRegistDe),
    writeDate: fmtDate(r.writngDe),
    evidenceType: r.prufSeNm,
    evidenceSub: r.etcPruf,
    purpose: r.excutPrposCn,
    budgetCategory: r.asstnExpitmNm,
    subCategory: r.asstnTaxitmNm,
    itemName: r.prdlstNm,
    vendorName: r.bcncCmpnyNm,
    depositorName: r.dpstrNm,
    bizType: r.bcncIndutyNm,
    supplyAmount: r.excutSplpc,
    vat: r.excutVat,
    cancelAmount: r.rcvrySumAmount,
    totalAmount: r.lastAmount,
    disallowedAmount: r.nrcgnAmount,
    reviewStatus: r.exmntPrgstNm,
    atchmnflId: r.atchmnflId,
    excutId: r.excutId,
    files: [],
  }));

  // ── Phase 2: 첨부파일 다운로드 ──
  console.log('[Phase 2] 첨부파일 다운로드...');
  let dlCount = 0;
  for (const rec of records) {
    dlCount++;
    const dlDir = path.join(BASE_DIR, `r${rec.rowNum}`);

    if (fs.existsSync(dlDir)) {
      const existing = fs.readdirSync(dlDir).filter(f => !f.endsWith('.crdownload'));
      if (existing.length > 0) {
        console.log(`  [${dlCount}/${total}] r${rec.rowNum} 스킵 (${existing.length}파일)`);
        continue;
      }
    }

    if (!rec.atchmnflId) {
      console.log(`  [${dlCount}/${total}] r${rec.rowNum} 첨부없음`);
      continue;
    }

    const files = await downloadFromPopup(page, context, rec.atchmnflId, dlDir);
    console.log(`  [${dlCount}/${total}] r${rec.rowNum} → ${files.length}파일 | ${rec.totalAmount.toLocaleString()}원 | ${rec.purpose.substring(0, 40)}`);
    await page.waitForTimeout(500);
  }
  console.log('');

  // ── Phase 3: OCR ──
  console.log('[Phase 3] OCR 수집...');
  for (let i = 0; i < records.length; i++) {
    const rec = records[i];
    rec.files = await ocrDir(path.join(BASE_DIR, `r${rec.rowNum}`));
    if ((i + 1) % 10 === 0 || i === records.length - 1) {
      console.log(`  [${i + 1}/${records.length}] ${rec.purpose.substring(0, 30)}`);
    }
  }
  console.log('');

  // ── Phase 4: JSON 저장 ──
  const output = records.map(r => {
    const { atchmnflId, excutId, ...rest } = r;
    return rest;
  });
  fs.writeFileSync(OUTPUT, JSON.stringify(output, null, 2), 'utf-8');
  const sizeMB = (fs.statSync(OUTPUT).size / 1024 / 1024).toFixed(1);
  console.log(`[완료] ${OUTPUT} (${sizeMB}MB, ${records.length}건)`);

  // 비목별 요약
  const cats = new Map();
  for (const r of records) {
    const key = `${r.budgetCategory}/${r.subCategory}`;
    const prev = cats.get(key) || { count: 0, total: 0 };
    prev.count++;
    prev.total += r.totalAmount;
    cats.set(key, prev);
  }
  console.log('\n비목별 요약:');
  for (const [k, v] of [...cats.entries()].sort((a, b) => b[1].total - a[1].total)) {
    console.log(`  ${k}: ${v.count}건, ${v.total.toLocaleString()}원`);
  }

  const statuses = new Map();
  for (const r of records) {
    const key = r.reviewStatus || '(없음)';
    statuses.set(key, (statuses.get(key) || 0) + 1);
  }
  console.log('\n검토상태:');
  for (const [k, v] of statuses) console.log(`  ${k}: ${v}건`);

  console.log(`\n=== ${INST_NAME} Phase 1-4 완료 ===`);
  console.log(`다음: node lib/judge-digital-healthcare.js --data=knuh-data.json --name=${INST_NAME}`);
}

main().catch(console.error);
