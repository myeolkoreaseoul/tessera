/**
 * 국민건강보험 일산병원 119건 파이프라인
 * 소스 엑셀 → atchmnflId 팝업 → 다운로드 → OCR → 판단 → W열/Y열 기재
 */
import { chromium } from 'playwright';
import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import pdfParse from 'pdf-parse';
import AdmZip from 'adm-zip';
import ExcelJS from 'exceljs';

process.on('unhandledRejection', (err: any) => {
  if (err?.message?.includes('No dialog is showing')) return;
});

const SOURCE_EXCEL = '/mnt/c/Users/정동회계법인/Documents/2025 지역책임의료기관사업_국민건강보험 일산병원/B0070225000683_사업집행내역_20260205150410.xlsx';
const BASE_DIR = '/mnt/c/projects/e-naradomum-rpa/downloads/ilsan';
const RESULT_DIR = '/mnt/c/projects/e-naradomum-rpa/results';

// ===== 유틸 =====
function formatDate(val: any): string {
  if (!val) return '';
  if (val instanceof Date) return val.toISOString().substring(0, 10);
  return String(val);
}
function parseNumber(val: any): number {
  if (typeof val === 'number') return val;
  if (!val) return 0;
  return parseInt(String(val).replace(/[^0-9-]/g, '')) || 0;
}

// ===== PDF 텍스트 추출 (pdf-parse → OCR 폴백) =====
async function extractPdfText(filePath: string): Promise<string> {
  try {
    const buf = fs.readFileSync(filePath);
    const data = await pdfParse(buf);
    if (data.text.trim().length > 50) return data.text;
  } catch {}
  const tmpDir = `/tmp/ocr-${Date.now()}-${Math.random().toString(36).substring(7)}`;
  fs.mkdirSync(tmpDir, { recursive: true });
  try {
    execSync(`pdftoppm -png -r 250 -f 1 -l 2 "${filePath}" "${tmpDir}/p"`, { timeout: 30000 });
    const images = fs.readdirSync(tmpDir).filter(f => f.endsWith('.png')).sort();
    let ocrText = '';
    for (const img of images) {
      const ob = path.join(tmpDir, `o-${img}`);
      try {
        execSync(`tesseract "${path.join(tmpDir, img)}" "${ob}" -l kor 2>/dev/null`, { timeout: 30000 });
        ocrText += fs.readFileSync(`${ob}.txt`, 'utf-8') + '\n';
      } catch {}
    }
    return ocrText;
  } catch { return ''; }
  finally { fs.rmSync(tmpDir, { recursive: true, force: true }); }
}

// ===== 문서유형 =====
function detectDocType(fn: string, text: string): string {
  fn = fn.toLowerCase();
  if (fn.includes('지출결의') || text.includes('지출결의')) return '지출결의서';
  if (fn.includes('입금의뢰') || text.includes('입금의뢰')) return '입금의뢰서';
  if (fn.includes('인센티브') || text.includes('인센티브')) return '인센티브';
  if (fn.includes('급여') || fn.includes('인건비') || text.includes('급여명세')) return '급여명세';
  if (fn.includes('소급') || text.includes('소급')) return '소급분';
  if (fn.includes('재직증명')) return '재직증명서';
  if (fn.includes('발령') || text.includes('인사발령')) return '인사발령';
  if (fn.includes('세금계산서') || text.includes('세금계산서')) return '세금계산서';
  if (fn.includes('영수증') || text.includes('영수증') || text.includes('카드매출') || fn.includes('카드')) return '영수증/카드';
  if (fn.includes('견적') || text.includes('견적서')) return '견적서';
  if (fn.includes('계약') || text.includes('계약서')) return '계약서';
  if (fn.includes('거래명세') || text.includes('거래명세')) return '거래명세서';
  return '기타';
}

// ===== 금액 추출 =====
function extractAmounts(text: string): number[] {
  const amounts: number[] = [];
  const matches = text.match(/[\d,]{4,}원?/g) || [];
  for (const m of matches) {
    const num = parseInt(m.replace(/[^0-9]/g, ''));
    if (num >= 1000 && num < 100000000000) amounts.push(num);
  }
  return [...new Set(amounts)].sort((a, b) => b - a);
}

// ===== 판단 =====
interface SourceRecord {
  rowNum: number; executionDate: string; purpose: string; evidenceType: string;
  budgetCategory: string; subCategory: string; itemName: string;
  vendorName: string; supplyAmount: number; totalAmount: number;
}
interface FileInfo { name: string; path: string; text: string; docType: string; }

function judgeRecord(rec: SourceRecord, files: FileInfo[]): { status: string; reason: string } {
  if (files.length === 0) {
    return { status: '부적정', reason: '증빙서류 미첨부' };
  }

  const allTexts = files.map(f => f.text).join('\n');
  const amounts = extractAmounts(allTexts);
  const docTypes = files.map(f => f.docType);
  const good: string[] = [];
  const issues: string[] = [];

  // 1. 지출결의서
  if (docTypes.includes('지출결의서')) good.push('지출결의서 확인');

  // 2. 금액 대조
  const target = rec.totalAmount;
  if (amounts.length > 0 && target > 0) {
    const matched = amounts.some(a => a === target || (target > 0 && Math.abs(a - target) / target < 0.05));
    if (matched) good.push(`집행금액 ${target.toLocaleString()}원 일치`);
    else {
      const supplyMatch = rec.supplyAmount > 0 && amounts.some(a => a === rec.supplyAmount);
      if (supplyMatch) good.push('공급가액 일치');
      else issues.push(`금액 불일치(집행:${target.toLocaleString()}, 증빙:${amounts.slice(0,2).map(a=>a.toLocaleString()).join('/')})`);
    }
  }

  // 3. 거래처
  if (rec.vendorName && allTexts.includes(rec.vendorName)) good.push(`거래처(${rec.vendorName}) 확인`);

  // 4. 용도 키워드
  const keywords = rec.purpose.replace(/[0-9년월일분기차]/g, '').split(/[\s,_()（）\-]+/).filter(w => w.length >= 2);
  const matchedKw = keywords.filter(kw => allTexts.includes(kw));
  if (matchedKw.length >= 2) good.push(`용도 키워드(${matchedKw.slice(0,3).join(',')}) 확인`);

  // 5. 비목별 추가 체크
  if (rec.budgetCategory.includes('인건비')) {
    if (docTypes.some(d => ['입금의뢰서','급여명세'].includes(d))) good.push('인건비 증빙 확인');
  }

  // 판단
  let status: string;
  if (issues.length === 0 && good.length >= 2) {
    status = '적정';
  } else if (files.length > 0 && good.length >= 1 && issues.length === 0) {
    status = '적정';
  } else if (issues.some(i => i.includes('불일치'))) {
    status = '확인필요';
  } else {
    status = '확인필요';
  }

  const parts = [...good.map(g => g), ...issues.map(i => `[주의]${i}`)];
  const docList = `(${docTypes.join(', ')})`;
  const reason = `${parts.join('. ')} ${docList}`;

  return { status, reason };
}

// ===== 팝업 다운로드 =====
async function downloadFromPopup(
  page: any, context: any, atchmnflId: string, dlDir: string
): Promise<FileInfo[]> {
  const files: FileInfo[] = [];
  if (!atchmnflId) return files;

  fs.mkdirSync(dlDir, { recursive: true });
  const winPath = dlDir.replace(/^\/mnt\/([a-z])\//, (_, d: string) => `${d.toUpperCase()}:\\`).replace(/\//g, '\\');

  // 기존 팝업 닫기
  for (const p of context.pages()) {
    if (p.url().includes('getDB003002SView')) await p.close().catch(() => {});
  }
  await page.waitForTimeout(300);

  // 팝업 열기 (waitForEvent + URL 폴백)
  const popupPromise = context.waitForEvent('page', { timeout: 8000 });
  await page.evaluate((id: string) => {
    window.open(`/exe/db/db003/getDB003002SView.do?atchmnflId=${id}`, '_blank', 'width=700,height=500,scrollbars=yes');
  }, atchmnflId);

  let popup = await popupPromise.catch(() => null);
  // 폴백: URL로 직접 찾기
  if (!popup) {
    await page.waitForTimeout(2000);
    popup = context.pages().find((p: any) => p.url().includes('getDB003002SView'));
  }
  if (!popup) return files;

  try {
    await popup.waitForLoadState('domcontentloaded', { timeout: 10000 });
    await popup.waitForTimeout(2000);

    const hasFn = await popup.evaluate(() => typeof (window as any).f_downloadDB003002S === 'function').catch(() => false);
    if (!hasFn) { await popup.close().catch(() => {}); return files; }

    const cdp = await popup.context().newCDPSession(popup);
    await cdp.send('Page.setDownloadBehavior', { behavior: 'allow', downloadPath: winPath });
    cdp.on('Page.javascriptDialogOpening', async () => {
      try { await cdp.send('Page.handleJavaScriptDialog', { accept: true }); } catch {}
    });
    await cdp.send('Page.enable');

    await popup.evaluate(() => {
      document.querySelectorAll('input[type="checkbox"]').forEach(cb => (cb as HTMLInputElement).checked = true);
    });

    const filesBefore = new Set(fs.readdirSync(dlDir));

    await popup.evaluate(() => {
      const obs = new MutationObserver(() => {
        const mask = document.querySelector('.popupMask.on') as HTMLElement;
        if (mask) { const btn = mask.querySelector('footer button') as HTMLElement; if (btn) setTimeout(() => btn.click(), 200); }
      });
      obs.observe(document.body, { subtree: true, attributes: true, attributeFilter: ['class'] });
      (window as any).f_downloadDB003002S();
    });

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
                  if (!e.isDirectory) files.push({ name: e.entryName, path: path.join(dlDir, e.entryName), text: '', docType: '' });
                }
                fs.unlinkSync(fp);
              } catch {}
            } else {
              files.push({ name: f, path: fp, text: '', docType: '' });
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

// ===== 메인 =====
async function main() {
  console.log('=== 국민건강보험 일산병원 전체 파이프라인 ===\n');
  fs.mkdirSync(BASE_DIR, { recursive: true });
  fs.mkdirSync(RESULT_DIR, { recursive: true });

  // 1. 소스 엑셀 읽기
  console.log('[1/4] 소스 엑셀 읽기...');
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(SOURCE_EXCEL);
  const ws = wb.worksheets[0];

  const records: SourceRecord[] = [];
  for (let r = 3; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    if (!row.getCell(1).value) continue;
    records.push({
      rowNum: r,
      executionDate: formatDate(row.getCell(1).value),
      purpose: String(row.getCell(6).value ?? ''),
      evidenceType: String(row.getCell(4).value ?? ''),
      budgetCategory: String(row.getCell(7).value ?? ''),
      subCategory: String(row.getCell(8).value ?? ''),
      itemName: String(row.getCell(9).value ?? ''),
      vendorName: String(row.getCell(10).value ?? ''),
      supplyAmount: parseNumber(row.getCell(17).value),
      totalAmount: parseNumber(row.getCell(20).value),
    });
  }
  console.log(`  ${records.length}건 로드\n`);

  // 2. Chrome 연결 + 전체 그리드 데이터 수집
  console.log('[2/4] Chrome 연결...');
  const browser = await chromium.connectOverCDP('http://localhost:9444');
  const context = browser.contexts()[0];
  const page = context.pages().find(p => p.url().includes('gosims'));
  if (!page) { console.log('페이지 없음!'); await browser.close(); return; }

  const mainCdp = await context.newCDPSession(page);
  mainCdp.on('Page.javascriptDialogOpening', async () => {
    try { await mainCdp.send('Page.handleJavaScriptDialog', { accept: true }); } catch {}
  });
  await mainCdp.send('Page.enable');

  // 그리드 행 추출 함수
  interface GridRow { atchmnflId: string; amount: number; date: string; purpose: string; vendor: string; fileCnt: number; }
  async function getGridRows(): Promise<GridRow[]> {
    return await page!.evaluate(() => {
      const grid = (window as any).DD001002QGridObj;
      if (!grid) return [];
      const rows = grid.getDataRows();
      return rows.map((row: any) => {
        const val = grid.getRowValue(row);
        return {
          atchmnflId: val.atchmnflId || '',
          amount: parseInt(String(val.excutSumAmount || val.lastAmount || val.excutSplpc || '0').replace(/[^0-9-]/g, '')) || 0,
          date: val.excutExecutDe || val.excutExcnYmd || '',
          purpose: (val.excutPrposCn || ''),
          vendor: val.bcncCmpnyNm || val.dpstrNm || '',
          fileCnt: parseInt(val.atchmnflCnt) || 0,
        };
      });
    });
  }

  // 페이지 이동 (waitForResponse 사용)
  async function goToPage(pageNum: number): Promise<void> {
    await Promise.all([
      page!.waitForResponse(r => r.url().includes('retrieveListBsnsExcutDetl'), { timeout: 15000 }),
      page!.evaluate((pn: number) => { (window as any).f_retrieveListBsnsExcutDetl(pn); }, pageNum),
    ]);
    await page!.waitForTimeout(1000);
  }

  // 전체 페이지 순회하여 모든 그리드 행 수집
  const allGridRows: GridRow[] = [];
  const seenIds = new Set<string>();
  const totalPages = Math.ceil(records.length / 20); // 페이지당 20행

  for (let pg = 1; pg <= totalPages; pg++) {
    if (pg > 1) await goToPage(pg);
    const rows = await getGridRows();
    for (const r of rows) {
      if (r.atchmnflId && !seenIds.has(r.atchmnflId)) {
        seenIds.add(r.atchmnflId);
        allGridRows.push(r);
      }
    }
    console.log(`  p${pg}: ${rows.length}행 (누적 ${allGridRows.length})`);
    if (rows.length < 20) break;
  }
  // 1페이지로 복귀
  if (totalPages > 1) await goToPage(1);
  console.log(`  총 그리드 행: ${allGridRows.length}개\n`);

  // 엑셀 레코드를 그리드 행과 매칭 (그리드 순서 = 엑셀 순서 가정 + 검증)
  const usedAtchIds = new Set<string>();
  function matchRecordToGrid(rec: SourceRecord, idx: number): string {
    const normDate = rec.executionDate.replace(/-/g, '');
    const available = allGridRows.filter(g => g.atchmnflId && !usedAtchIds.has(g.atchmnflId));

    // 0차: 인덱스 기반 (순서 일치 시)
    if (idx < allGridRows.length && !usedAtchIds.has(allGridRows[idx].atchmnflId)) {
      const gr = allGridRows[idx];
      const purposeMatch = rec.purpose.length >= 3 && gr.purpose.includes(rec.purpose.substring(0, Math.min(10, rec.purpose.length)));
      if (gr.date.includes(normDate) && purposeMatch) {
        usedAtchIds.add(gr.atchmnflId);
        return gr.atchmnflId;
      }
    }

    // 1차: 금액+날짜+용도 키워드 동시 일치
    const keywords = rec.purpose.split(/[\s,_()（）\-]+/).filter(w => w.length >= 2).slice(0, 5);
    for (const gr of available) {
      if (gr.amount === rec.totalAmount && gr.date.includes(normDate) && keywords.some(kw => gr.purpose.includes(kw))) {
        usedAtchIds.add(gr.atchmnflId);
        return gr.atchmnflId;
      }
    }
    // 2차: 날짜+용도 키워드 2개 이상
    for (const gr of available) {
      if (gr.date.includes(normDate) && keywords.filter(kw => gr.purpose.includes(kw)).length >= 2) {
        usedAtchIds.add(gr.atchmnflId);
        return gr.atchmnflId;
      }
    }
    // 3차: 금액+날짜 일치
    for (const gr of available) {
      if (gr.amount === rec.totalAmount && gr.date.includes(normDate)) {
        usedAtchIds.add(gr.atchmnflId);
        return gr.atchmnflId;
      }
    }
    // 4차: 날짜+용도 1개
    for (const gr of available) {
      if (gr.date.includes(normDate) && keywords.some(kw => gr.purpose.includes(kw))) {
        usedAtchIds.add(gr.atchmnflId);
        return gr.atchmnflId;
      }
    }
    return '';
  }

  // 3. 다운로드 + OCR + 판단
  console.log('[3/4] 다운로드 + OCR + 판단...');
  const results: { status: string; reason: string; fileCount: number }[] = [];

  for (let i = 0; i < records.length; i++) {
    const rec = records[i];
    const progress = `[${i+1}/${records.length}]`;

    // 그리드 매칭
    const atchId = matchRecordToGrid(rec, i);

    process.stdout.write(`${progress} ${rec.executionDate} ${rec.purpose.substring(0,25).padEnd(25)} `);

    // 다운로드
    const dlDir = path.join(BASE_DIR, `r${i+1}`);
    let files: FileInfo[] = [];

    if (atchId) {
      // 이미 다운받은 파일이 있으면 재사용
      if (fs.existsSync(dlDir) && fs.readdirSync(dlDir).filter(f => !f.startsWith('.')).length > 0) {
        const existing = fs.readdirSync(dlDir).filter(f => /\.(pdf|jpg|png|hwp|xlsx)$/i.test(f));
        files = existing.map(f => ({ name: f, path: path.join(dlDir, f), text: '', docType: '' }));
      } else {
        files = await downloadFromPopup(page, context, atchId, dlDir);
      }
    }

    // OCR
    for (const file of files) {
      if (file.name.toLowerCase().endsWith('.pdf')) {
        try {
          file.text = await extractPdfText(file.path);
          file.docType = detectDocType(file.name, file.text);
        } catch { file.docType = '분석실패'; }
      } else {
        file.docType = detectDocType(file.name, '');
      }
    }

    // 판단
    const { status, reason } = judgeRecord(rec, files);
    results.push({ status, reason, fileCount: files.length });

    const symbol = status === '적정' ? '○' : status === '부적정' ? '✗' : '△';
    console.log(`${symbol} ${status} (파일${files.length})${!atchId ? ' [매칭실패]' : ''}`);

    await page.waitForTimeout(300);
  }

  // 4. 결과 엑셀 생성 (원본 복사 + W열/Y열 기재)
  console.log('\n[4/4] 결과 엑셀 생성...');
  const outWb = new ExcelJS.Workbook();
  await outWb.xlsx.readFile(SOURCE_EXCEL);
  const outWs = outWb.worksheets[0];

  // Y열 헤더 추가 (25번째 컬럼)
  outWs.getRow(1).getCell(25).value = '검토의견';
  outWs.getRow(2).getCell(25).value = '검토의견';
  outWs.getColumn(25).width = 60;

  let countOk = 0, countBad = 0, countCheck = 0;
  for (let i = 0; i < records.length; i++) {
    const rec = records[i];
    const r = results[i];
    const excelRow = outWs.getRow(rec.rowNum);

    // W열: 검토진행상태
    excelRow.getCell(23).value = r.status === '적정' ? '적정' : r.status === '부적정' ? '부적정' : '확인필요';

    // X열: 검토일자
    excelRow.getCell(24).value = new Date().toISOString().substring(0, 10);

    // Y열: 검토의견
    excelRow.getCell(25).value = r.reason;

    // 색상
    if (r.status === '적정') {
      countOk++;
      excelRow.getCell(23).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF4CAF50' } };
      excelRow.getCell(23).font = { color: { argb: 'FFFFFFFF' }, bold: true };
    } else if (r.status === '부적정') {
      countBad++;
      excelRow.getCell(23).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFF6B6B' } };
      excelRow.getCell(23).font = { color: { argb: 'FFFFFFFF' }, bold: true };
    } else {
      countCheck++;
      excelRow.getCell(23).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFEB3B' } };
    }
  }

  const now = new Date();
  const ts = `${now.getFullYear()}${String(now.getMonth()+1).padStart(2,'0')}${String(now.getDate()).padStart(2,'0')}_${String(now.getHours()).padStart(2,'0')}${String(now.getMinutes()).padStart(2,'0')}`;
  const outPath = path.join(RESULT_DIR, `일산병원_점검결과_${ts}.xlsx`);
  await outWb.xlsx.writeFile(outPath);

  console.log(`\n=== 완료 ===`);
  console.log(`적정: ${countOk}건, 부적정: ${countBad}건, 확인필요: ${countCheck}건`);
  console.log(`결과: ${outPath}`);

  await mainCdp.detach().catch(() => {});
  await browser.close();
}

main().catch(console.error);
