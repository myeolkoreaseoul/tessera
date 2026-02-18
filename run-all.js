/**
 * e나라도움 정산검토 원커맨드 파이프라인
 *
 * 사용법:
 *   node run-all.js --inst=경북대학교병원 --kw=칠곡경북대학교병원 [--dir=chilgok] [--year=2025] [--dry-run] [--skip-review] [--start=N]
 *
 * 옵션:
 *   --inst       하위보조사업자명 (e나라도움 검색용)
 *   --kw         사업명 키워드 (여러 결과 중 매칭)
 *   --dir        다운로드/출력 디렉토리명 (기본: kw에서 자동 생성)
 *   --year       사업연도 (기본: 2025)
 *   --dry-run    review 입력 안 함 (judge까지만)
 *   --skip-review review 단계 건너뛰기
 *   --start=N    review 시작 행번호
 *   --staff=a,b  참여인력 이름 (자문료 중복 체크용)
 *
 * 전체 흐름:
 *   Phase 0: 네비게이션 → Phase 1: 그리드 추출 → Phase 2: 첨부 다운로드
 *   → Phase 3: OCR → Phase 4: JSON 저장 → Phase 5: Judge → Phase 6: Review 입력
 */
process.on('unhandledRejection', (err) => {
  if (err && err.message && err.message.includes('No dialog is showing')) return;
  console.error('UnhandledRejection:', err);
});

const fs = require('fs');
const path = require('path');
const AdmZip = require('adm-zip');
const { extractPdfText, extractHwpText, extractImageText, extractExcelText } = require('./lib/collect-generic');
const nav = require('./lib/navigate');
const judge = require('./lib/judge-digital-healthcare');
const review = require('./lib/review-generic');
const { analyze: deepAnalyze, printSummary: printDeepSummary } = require('./lib/deep-analyze');
const { getConfig } = require('./lib/configs');

// ── CLI 파싱 ──
const args = Object.fromEntries(
  process.argv.slice(2)
    .filter(a => a.startsWith('--'))
    .map(a => {
      const [k, ...v] = a.slice(2).split('=');
      return [k, v.length ? v.join('=') : true];
    })
);

const INST_NAME = args.inst;
if (!INST_NAME) {
  console.log('사용법: node run-all.js --inst=기관명 --kw=사업키워드 [옵션]');
  console.log('  --inst       하위보조사업자명 (필수)');
  console.log('  --kw         사업명 키워드');
  console.log('  --dir        출력 디렉토리명');
  console.log('  --year       사업연도 (기본: 2025)');
  console.log('  --dry-run    review 건너뛰기');
  console.log('  --skip-review  review만 건너뛰기');
  console.log('  --start=N    review 시작 행');
  console.log('  --staff=a,b  참여인력 이름');
  process.exit(1);
}

const PROJECT_KW = args.kw || '';
const YEAR = parseInt(args.year) || 2025;
const DIR_NAME = args.dir || (PROJECT_KW || INST_NAME).replace(/[^가-힣a-zA-Z0-9]/g, '').substring(0, 20).toLowerCase();
const DRY_RUN = !!args['dry-run'];
const SKIP_REVIEW = !!args['skip-review'];
const SKIP_JUDGE = !!args['skip-judge'];
const START_ROW = parseInt(args.start) || 1;
const STAFF = args.staff ? args.staff.split(',') : [];

const BASE_DIR = path.join(__dirname, 'downloads', DIR_NAME);
const DATA_FILE = path.join(__dirname, `${DIR_NAME}-data.json`);
const RESULTS_FILE = path.join(__dirname, `${DIR_NAME}-results.json`);

// ── 유틸 ──
function fmtDate(d) {
  if (!d) return '';
  const s = String(d);
  if (s.length === 8) return `${s.slice(0,4)}-${s.slice(4,6)}-${s.slice(6,8)}`;
  return s;
}

const EXTS = ['.pdf', '.xlsx', '.xls', '.hwp', '.jpg', '.jpeg', '.png'];

async function ocrDir(dlDir) {
  const result = [];
  if (!fs.existsSync(dlDir)) return result;
  const fileNames = fs.readdirSync(dlDir).filter(f => EXTS.some(e => f.toLowerCase().endsWith(e)));
  for (const fn of fileNames) {
    const fp = path.join(dlDir, fn);
    const fnLower = fn.toLowerCase();
    let text = '';
    if (fnLower.endsWith('.pdf')) text = await extractPdfText(fp);
    else if (fnLower.endsWith('.xlsx') || fnLower.endsWith('.xls')) text = await extractExcelText(fp);
    else if (fnLower.endsWith('.hwp')) text = extractHwpText(fp);
    else if (/\.(jpg|jpeg|png)$/.test(fnLower)) text = extractImageText(fp);
    result.push({ name: fn, text: text.substring(0, 12000) });
  }
  return result;
}

// ── 그리드 추출 ──
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
          excutExecutDe: v.excutExecutDe || '', excutRegistDe: v.excutRegistDe || '',
          writngDe: v.writngDe || '', prufSeNm: v.prufSeNm || '', etcPruf: v.etcPruf || '',
          excutPrposCn: v.excutPrposCn || '', asstnExpitmNm: v.asstnExpitmNm || '',
          asstnTaxitmNm: v.asstnTaxitmNm || '', prdlstNm: v.prdlstNm || '',
          bcncCmpnyNm: v.bcncCmpnyNm || '', dpstrNm: v.dpstrNm || '',
          bcncIndutyNm: v.bcncIndutyNm || '', excutSplpc: v.excutSplpc || 0,
          excutVat: v.excutVat || 0, rcvrySumAmount: v.rcvrySumAmount || 0,
          lastAmount: v.lastAmount || 0, nrcgnAmount: v.nrcgnAmount || 0,
          atchmnflId: v.atchmnflId || '', cmnuseAtchmnflId: v.cmnuseAtchmnflId || '', excutId: v.excutId || '',
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
        if (mask) { const btn = mask.querySelector('footer button'); if (btn) setTimeout(() => btn.click(), 200); }
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
                for (const e of zip.getEntries()) { if (!e.isDirectory) files.push(e.entryName); }
                fs.unlinkSync(fp);
              } catch {}
            } else { files.push(f); }
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

// ══════════════════════════════════════
//  메인 파이프라인
// ══════════════════════════════════════
async function main() {
  const t0 = Date.now();
  console.log('╔══════════════════════════════════════════════════╗');
  console.log(`║  ${INST_NAME} (${PROJECT_KW || '-'})`);
  console.log(`║  dir=${DIR_NAME} year=${YEAR} ${DRY_RUN ? 'DRY-RUN' : 'SAVE'}`);
  console.log('╚══════════════════════════════════════════════════╝\n');

  fs.mkdirSync(BASE_DIR, { recursive: true });

  // ════════ Phase 0: 네비게이션 ════════
  console.log('[Phase 0] 네비게이션...');
  const { page, context, selected } = await nav.goToInstitution({
    institutionName: INST_NAME,
    projectKeyword: PROJECT_KW,
    year: YEAR,
  });
  console.log(`  사업: ${selected.taskNm}`);
  console.log(`  상태: ${selected.excutLmttResnNm}`);
  console.log(`  집행건: ${selected.gridCount}건\n`);

  // 정산구분 자동 결정: 집행마감→최종정산, 사업수행중→중간정산
  let SETTLEMENT = args.settlement;
  if (!SETTLEMENT) {
    SETTLEMENT = (selected.excutLmttResnNm === '집행마감') ? 'final' : 'interim';
  }
  const radioId = SETTLEMENT === 'interim' ? 'DD001002Q_excclcSeCode_2' : 'DD001002Q_excclcSeCode_1';
  const settleLabel = SETTLEMENT === 'interim' ? '중간정산' : '최종정산';
  await page.evaluate((id) => {
    const r = document.getElementById(id);
    if (r && !r.checked) r.click();
  }, radioId);
  await page.evaluate(() => {
    const btn = document.getElementById('DD001002Q_btnRetrieve') ||
                [...document.querySelectorAll('button')].find(b => b.textContent.trim() === '검색' && b.offsetWidth > 0);
    if (btn) btn.click();
  });
  console.log(`  ${settleLabel} 설정 → 재검색`);
  await new Promise(r => setTimeout(r, 3000));

  // ════════ Phase 1: 그리드 추출 ════════
  console.log('\n[Phase 1] 그리드 데이터 추출...');
  const { allRows, total } = await extractAllGridData(page);
  console.log(`  총 ${total}건 추출\n`);

  const records = allRows.map((r, i) => ({
    rowNum: i + 1,
    executionDate: fmtDate(r.excutExecutDe), registDate: fmtDate(r.excutRegistDe),
    writeDate: fmtDate(r.writngDe), evidenceType: r.prufSeNm, evidenceSub: r.etcPruf,
    purpose: r.excutPrposCn, budgetCategory: r.asstnExpitmNm, subCategory: r.asstnTaxitmNm,
    itemName: r.prdlstNm, vendorName: r.bcncCmpnyNm, depositorName: r.dpstrNm,
    bizType: r.bcncIndutyNm, supplyAmount: r.excutSplpc, vat: r.excutVat,
    cancelAmount: r.rcvrySumAmount, totalAmount: r.lastAmount,
    disallowedAmount: r.nrcgnAmount, reviewStatus: r.exmntPrgstNm,
    atchmnflId: r.atchmnflId, cmnuseAtchmnflId: r.cmnuseAtchmnflId, excutId: r.excutId, files: [],
  }));

  // ════════ Phase 2: 다운로드 ════════
  console.log('[Phase 2] 첨부파일 다운로드...');
  let dlNew = 0, dlSkip = 0;
  for (let i = 0; i < records.length; i++) {
    const rec = records[i];
    const dlDir = path.join(BASE_DIR, `r${rec.rowNum}`);
    if (fs.existsSync(dlDir)) {
      const existing = fs.readdirSync(dlDir).filter(f => !f.endsWith('.crdownload'));
      if (existing.length > 0) { dlSkip++; continue; }
    }
    if (!rec.atchmnflId && !rec.cmnuseAtchmnflId) { continue; }
    let files = [];
    if (rec.atchmnflId) {
      files = await downloadFromPopup(page, context, rec.atchmnflId, dlDir);
    }
    if (rec.cmnuseAtchmnflId) {
      const sharedFiles = await downloadFromPopup(page, context, rec.cmnuseAtchmnflId, dlDir);
      files = files.concat(sharedFiles);
    }
    dlNew++;
    if (dlNew % 5 === 0 || i === records.length - 1) {
      console.log(`  [${i + 1}/${total}] ${dlNew}건 다운, ${dlSkip}건 스킵`);
    }
    await page.waitForTimeout(500);
  }
  console.log(`  다운로드 완료: 신규 ${dlNew}, 스킵 ${dlSkip}\n`);

  // ════════ Phase 3: OCR ════════
  console.log('[Phase 3] OCR...');
  for (let i = 0; i < records.length; i++) {
    records[i].files = await ocrDir(path.join(BASE_DIR, `r${records[i].rowNum}`));
    if ((i + 1) % 10 === 0 || i === records.length - 1) {
      console.log(`  [${i + 1}/${records.length}]`);
    }
  }

  // ════════ Phase 4: JSON 저장 ════════
  const output = records.map(r => {
    const { atchmnflId, cmnuseAtchmnflId, excutId, ...rest } = r;
    return rest;
  });
  fs.writeFileSync(DATA_FILE, JSON.stringify(output, null, 2), 'utf-8');
  const sizeMB = (fs.statSync(DATA_FILE).size / 1024 / 1024).toFixed(1);
  console.log(`\n[Phase 4] ${DATA_FILE} (${sizeMB}MB, ${records.length}건)\n`);

  // ════════ Phase 4.5: 심층분석 (deep-analyze) ════════
  console.log('[Phase 4.5] 심층분석...');
  const projectConfig = getConfig(args.project || PROJECT_KW || '', {
    institutionName: INST_NAME,
    legalBasis: args.basis || '보조금',
  });
  const enrichedData = deepAnalyze(output, projectConfig);
  const enrichedFile = DATA_FILE.replace(/\.json$/, '-enriched.json');
  fs.writeFileSync(enrichedFile, JSON.stringify(enrichedData, null, 2), 'utf-8');
  printDeepSummary(enrichedData);
  console.log(`  enriched: ${enrichedFile}\n`);

  // ════════ Phase 5: Judge ════════
  let results;
  if (SKIP_JUDGE) {
    console.log('[Phase 5] Judge 건너뜀 (--skip-judge)');
    console.log(`  데이터 파일: ${DATA_FILE}`);
    console.log('  → Claude Code가 직접 판정한 후 results JSON을 생성하세요.\n');
    // results 파일이 이미 있으면 로드
    if (fs.existsSync(RESULTS_FILE)) {
      results = JSON.parse(fs.readFileSync(RESULTS_FILE, 'utf-8'));
      console.log(`  기존 results 로드: ${RESULTS_FILE} (${results.length}건)`);
    }
  } else {
    console.log('[Phase 5] Judge...');
    const data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8'));
    results = judge.run(data, { staff: STAFF, institutionName: INST_NAME });
    judge.printResults(results, PROJECT_KW || INST_NAME);
    fs.writeFileSync(RESULTS_FILE, JSON.stringify(results, null, 2), 'utf-8');
    console.log(`결과 저장: ${RESULTS_FILE}\n`);
  }

  const ok = results ? results.filter(r => r.status === '적정').length : 0;
  const ng = results ? results.filter(r => r.status === '확인').length : 0;

  // ════════ Phase 6: Review 입력 ════════
  if (DRY_RUN || SKIP_REVIEW || !results) {
    console.log(`[Phase 6] 건너뜀 (${!results ? 'no-results' : DRY_RUN ? 'dry-run' : 'skip-review'})`);
    console.log(`\n  다음 단계: node lib/review-generic.js --results=${RESULTS_FILE} --pagesize=20 --save`);
  } else {
    console.log('[Phase 6] e나라도움 입력...');
    await review.run({
      results,
      overrides: {},
      saveMode: true,
      startRow: START_ROW,
      pageSize: 20,
      settlement: SETTLEMENT,
    });
  }

  // ════════ 최종 요약 ════════
  const elapsed = ((Date.now() - t0) / 60000).toFixed(1);
  console.log('\n╔══════════════════════════════════════════════════╗');
  console.log(`║  ${PROJECT_KW || INST_NAME} 완료`);
  console.log(`║  ${total}건: 적정 ${ok} / 확인 ${ng}`);
  console.log(`║  소요시간: ${elapsed}분`);
  console.log('╚══════════════════════════════════════════════════╝');
}

main().catch(err => {
  console.error('\n!! 파이프라인 오류 !!');
  console.error(err);
  process.exit(1);
});
