/**
 * 소스 엑셀 기반 파이프라인 (atchmnflId로 팝업 직접 열기)
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
  console.error('Unhandled:', err?.message?.substring(0, 100));
});

const MAX_RECORDS = 5;
const SOURCE_EXCEL = '/mnt/c/Users/정동회계법인/Downloads/B0080124003815_사업집행내역_20260204151120.xlsx';
const BASE_DIR = '/mnt/c/projects/e-naradomum-rpa/downloads/pipeline-v3';
const RESULT_DIR = '/mnt/c/projects/e-naradomum-rpa/results';

interface SourceRecord {
  rowNum: number;
  executionDate: string;
  registrationDate: string;
  writeDate: string;
  evidenceType: string;
  evidenceDetail: string;
  purpose: string;
  budgetCategory: string;
  subCategory: string;
  itemName: string;
  vendorName: string;
  depositorName: string;
  supplyAmount: number;
  vat: number;
  cancelAmount: number;
  totalAmount: number;
  reviewStatus: string;
  reviewDate: string;
}

interface AttachmentResult {
  files: { name: string; path: string; text: string; docType: string }[];
}

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

// 1. 소스 엑셀 읽기
async function readSourceExcel(): Promise<SourceRecord[]> {
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
      registrationDate: formatDate(row.getCell(2).value),
      writeDate: formatDate(row.getCell(3).value),
      evidenceType: String(row.getCell(4).value ?? ''),
      evidenceDetail: String(row.getCell(5).value ?? ''),
      purpose: String(row.getCell(6).value ?? ''),
      budgetCategory: String(row.getCell(7).value ?? ''),
      subCategory: String(row.getCell(8).value ?? ''),
      itemName: String(row.getCell(9).value ?? ''),
      vendorName: String(row.getCell(10).value ?? ''),
      depositorName: String(row.getCell(11).value ?? ''),
      supplyAmount: parseNumber(row.getCell(17).value),
      vat: parseNumber(row.getCell(18).value),
      cancelAmount: parseNumber(row.getCell(19).value),
      totalAmount: parseNumber(row.getCell(20).value),
      reviewStatus: String(row.getCell(23).value ?? ''),
      reviewDate: formatDate(row.getCell(24).value),
    });
  }
  return records;
}

// 2. 그리드에서 모든 행의 atchmnflId 가져오기
async function getAllAtchmnflIds(page: any): Promise<string[]> {
  return await page.evaluate(() => {
    const grid = (window as any).DD001002QGridObj;
    if (!grid) return [];
    const rows = grid.getDataRows();
    return rows.map((row: any) => {
      const val = grid.getRowValue(row);
      return val.atchmnflId || '';
    });
  });
}

// 3. 팝업 열고 파일 다운로드
async function downloadFromPopup(
  page: any, context: any, atchmnflId: string, dlDir: string
): Promise<{ name: string; path: string; text: string; docType: string }[]> {
  const files: { name: string; path: string; text: string; docType: string }[] = [];

  if (!atchmnflId) return files;

  fs.mkdirSync(dlDir, { recursive: true });
  const winPath = dlDir
    .replace(/^\/mnt\/([a-z])\//, (_, d: string) => `${d.toUpperCase()}:\\`)
    .replace(/\//g, '\\');

  // 팝업 열기
  const popupPromise = context.waitForEvent('page', { timeout: 15000 });
  await page.evaluate((id: string) => {
    window.open(`/exe/db/db003/getDB003002SView.do?atchmnflId=${id}`, 'popupDB003002S', 'width=700,height=500,scrollbars=yes');
  }, atchmnflId);

  const popup = await popupPromise.catch(() => null);
  if (!popup) return files;

  try {
    await popup.waitForLoadState('domcontentloaded', { timeout: 10000 });
    await popup.waitForTimeout(2000);

    // 다운로드 함수 확인
    const hasFn = await popup.evaluate(
      () => typeof (window as any).f_downloadDB003002S === 'function'
    ).catch(() => false);

    if (!hasFn) {
      await popup.close().catch(() => {});
      return files;
    }

    // CDP 설정
    const cdp = await popup.context().newCDPSession(popup);
    await cdp.send('Page.setDownloadBehavior', { behavior: 'allow', downloadPath: winPath });
    cdp.on('Page.javascriptDialogOpening', async () => {
      try { await cdp.send('Page.handleJavaScriptDialog', { accept: true }); } catch {}
    });
    await cdp.send('Page.enable');

    // 전체 선택
    await popup.evaluate(() => {
      document.querySelectorAll('input[type="checkbox"]').forEach(cb => {
        (cb as HTMLInputElement).checked = true;
      });
    });

    const filesBefore = new Set(fs.readdirSync(dlDir));

    // 다운로드 실행 + popupMask 자동 닫기
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
                  if (!e.isDirectory) {
                    files.push({ name: e.entryName, path: path.join(dlDir, e.entryName), text: '', docType: '' });
                  }
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

// PDF에서 텍스트 추출 (pdf-parse → OCR 폴백)
async function extractPdfText(filePath: string): Promise<string> {
  // 1차: pdf-parse
  try {
    const buf = fs.readFileSync(filePath);
    const data = await pdfParse(buf);
    if (data.text.trim().length > 50) {
      return data.text;
    }
  } catch {}

  // 2차: OCR (pdftoppm → tesseract)
  const tmpDir = `/tmp/ocr-${Date.now()}`;
  fs.mkdirSync(tmpDir, { recursive: true });
  try {
    // PDF 첫 2페이지를 이미지로 변환
    execSync(`pdftoppm -png -r 300 -f 1 -l 2 "${filePath}" "${tmpDir}/page"`, { timeout: 30000 });
    const images = fs.readdirSync(tmpDir).filter(f => f.endsWith('.png')).sort();

    let ocrText = '';
    for (const img of images) {
      const imgPath = path.join(tmpDir, img);
      const outBase = path.join(tmpDir, `ocr-${img}`);
      try {
        execSync(`tesseract "${imgPath}" "${outBase}" -l kor 2>/dev/null`, { timeout: 30000 });
        const txt = fs.readFileSync(`${outBase}.txt`, 'utf-8');
        ocrText += txt + '\n';
      } catch {}
    }
    return ocrText;
  } catch {
    return '';
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

// 문서유형 판별
function detectDocType(fileName: string, text: string): string {
  const fn = fileName.toLowerCase();
  if (fn.includes('지출결의') || text.includes('지출결의')) return '지출결의서';
  if (fn.includes('입금의뢰') || text.includes('입금의뢰')) return '입금의뢰서';
  if (fn.includes('급여') || fn.includes('인건비') || text.includes('급여명세')) return '급여명세서';
  if (fn.includes('인센티브') || text.includes('인센티브')) return '인센티브지급서';
  if (fn.includes('소급') || text.includes('소급')) return '소급분지급서';
  if (fn.includes('재직증명') || text.includes('재직증명')) return '재직증명서';
  if (fn.includes('발령') || text.includes('인사발령')) return '인사발령문서';
  if (fn.includes('세금계산서') || text.includes('세금계산서')) return '세금계산서';
  if (fn.includes('영수증') || fn.includes('카드') || text.includes('영수증') || text.includes('카드매출')) return '영수증/카드전표';
  if (fn.includes('견적') || text.includes('견적서')) return '견적서';
  if (fn.includes('계약') || text.includes('계약서')) return '계약서';
  return '기타';
}

// 텍스트에서 금액 추출 (모든 금액 패턴)
function extractAmounts(text: string): number[] {
  const amounts: number[] = [];
  // 콤마 포함 숫자 + 원 (예: 30,000원, 10,074,710)
  const patterns = [
    /[\d,]+원/g,
    /합\s*계[^\d]*?([\d,]+)/g,
    /총\s*액[^\d]*?([\d,]+)/g,
    /금\s*액[^\d]*?([\d,]+)/g,
    /실지급액[^\d]*?([\d,]+)/g,
    /집행금액[^\d]*?([\d,]+)/g,
  ];
  // 단순 금액 패턴
  const simpleMatches = text.match(/[\d,]{4,}원/g) || [];
  for (const m of simpleMatches) {
    const num = parseInt(m.replace(/[^0-9]/g, ''));
    if (num >= 1000) amounts.push(num);
  }
  // 합계/총액 등
  for (const pat of patterns.slice(1)) {
    let match;
    while ((match = pat.exec(text)) !== null) {
      const num = parseInt(match[1]?.replace(/[^0-9]/g, '') || match[0].replace(/[^0-9]/g, ''));
      if (num >= 1000) amounts.push(num);
    }
  }
  return [...new Set(amounts)];
}

// 집행건과 첨부 내용 대조 판단
function judgeRecord(
  rec: SourceRecord,
  files: { name: string; text: string; docType: string }[]
): { judgment: string; opinion: string } {
  if (files.length === 0) {
    return { judgment: '부적정', opinion: '증빙서류 미첨부' };
  }

  const hasExpenseReport = files.some(f => f.docType === '지출결의서');
  const allTexts = files.map(f => f.text).join('\n');
  const amounts = extractAmounts(allTexts);
  const issues: string[] = [];
  const good: string[] = [];

  // 1. 지출결의서 존재 확인
  if (!hasExpenseReport) {
    issues.push('지출결의서 미첨부');
  } else {
    good.push('지출결의서 있음');
  }

  // 2. 금액 대조
  const targetAmount = rec.totalAmount;
  if (amounts.length > 0) {
    const matched = amounts.some(a => {
      // 정확히 일치하거나, 10% 이내 오차
      return a === targetAmount || Math.abs(a - targetAmount) / targetAmount < 0.1;
    });
    if (matched) {
      good.push(`금액 일치 (${targetAmount.toLocaleString()}원)`);
    } else {
      // 부분 일치 확인 (공급가액 등)
      const supplyMatched = amounts.some(a => a === rec.supplyAmount && rec.supplyAmount > 0);
      if (supplyMatched) {
        good.push(`공급가액 일치 (${rec.supplyAmount.toLocaleString()}원)`);
      } else {
        issues.push(`금액 불일치 (집행: ${targetAmount.toLocaleString()}원, 증빙: ${amounts.slice(0,3).map(a => a.toLocaleString()).join('/')}원)`);
      }
    }
  } else {
    issues.push('금액 추출 불가');
  }

  // 3. 거래처/수신자 대조
  if (rec.vendorName && allTexts.includes(rec.vendorName)) {
    good.push(`거래처 일치 (${rec.vendorName})`);
  }

  // 4. 용도 키워드 대조
  const purposeKeywords = rec.purpose
    .replace(/[0-9년월일분기]/g, '')
    .split(/[\s,_()（）]+/)
    .filter(w => w.length >= 2);
  const matchedKeywords = purposeKeywords.filter(kw => allTexts.includes(kw));
  if (matchedKeywords.length > 0) {
    good.push(`용도 관련 키워드: ${matchedKeywords.slice(0,3).join(', ')}`);
  }

  // 5. 비목별 추가 체크
  const budget = rec.budgetCategory;
  if (budget.includes('인건비')) {
    // 인건비: 입금의뢰서 또는 급여명세 필요
    const hasProof = files.some(f => ['입금의뢰서', '급여명세서'].includes(f.docType));
    if (hasProof) good.push('인건비 증빙(입금의뢰서/급여명세) 있음');
    else issues.push('인건비: 입금의뢰서/급여명세 미첨부');
  }
  if (budget.includes('여비')) {
    // 여비: 영수증 또는 카드전표 필요
    const hasReceipt = files.some(f => f.docType.includes('영수증') || f.docType.includes('카드'));
    if (!hasReceipt && !allTexts.includes('교통비') && !allTexts.includes('여비')) {
      // 지출결의서에 여비 관련 내용이 있으면 OK
      if (!allTexts.includes('여비') && !allTexts.includes('출장')) {
        issues.push('여비: 교통비/영수증 증빙 미확인');
      }
    }
  }

  // 판단 결정
  let judgment: string;
  if (issues.length === 0 && good.length >= 2) {
    judgment = '적정';
  } else if (issues.some(i => i.includes('미첨부') && i.includes('지출결의서'))) {
    judgment = '부적정';
  } else if (issues.some(i => i.includes('불일치'))) {
    judgment = '확인필요';
  } else if (issues.length > 0) {
    judgment = '확인필요';
  } else {
    judgment = '확인필요';
  }

  const opinion = [
    ...good.map(g => `✓ ${g}`),
    ...issues.map(i => `✗ ${i}`),
    `[문서유형: ${files.map(f => f.docType).join(', ')}]`,
  ].join(' / ');

  return { judgment, opinion };
}

async function main() {
  console.log('=== 소스 엑셀 + atchmnflId 기반 파이프라인 ===\n');

  fs.mkdirSync(BASE_DIR, { recursive: true });
  fs.mkdirSync(RESULT_DIR, { recursive: true });

  // 1. 소스 엑셀 읽기
  console.log('[1/5] 소스 엑셀 읽기...');
  const allRecords = await readSourceExcel();
  const records = allRecords.slice(0, MAX_RECORDS);
  console.log(`  전체 ${allRecords.length}건, 테스트 ${records.length}건\n`);

  for (let i = 0; i < records.length; i++) {
    const r = records[i];
    console.log(`  [${i+1}] ${r.executionDate} | ${r.purpose.substring(0,35)} | ${r.vendorName} | ${r.totalAmount.toLocaleString()}원`);
  }

  // 2. Chrome 연결 + atchmnflId 수집
  console.log('\n[2/5] Chrome 연결 + 그리드 데이터 수집...');
  const browser = await chromium.connectOverCDP('http://localhost:9444');
  const context = browser.contexts()[0];
  const page = context.pages().find(p => p.url().includes('getDD001002QView'));

  if (!page) {
    console.log('집행내역 페이지 없음!');
    await browser.close();
    return;
  }
  console.log('  연결됨');

  // CDP dialog 처리 (메인 페이지)
  const mainCdp = await context.newCDPSession(page);
  mainCdp.on('Page.javascriptDialogOpening', async () => {
    try { await mainCdp.send('Page.handleJavaScriptDialog', { accept: true }); } catch {}
  });
  await mainCdp.send('Page.enable');

  const atchmnflIds = await getAllAtchmnflIds(page);
  console.log(`  그리드 행 ${atchmnflIds.length}개, atchmnflId 있는 행 ${atchmnflIds.filter(Boolean).length}개`);

  // 소스 엑셀 행 수와 그리드 행 수 매칭 확인
  if (atchmnflIds.length < records.length) {
    console.log(`  주의: 그리드(${atchmnflIds.length}행) < 소스엑셀(${records.length}행) — 그리드에 보이는 만큼만 처리`);
  }

  // 3. 첨부파일 다운로드
  console.log('\n[3/5] 첨부파일 다운로드...');
  const attachmentResults: AttachmentResult[] = [];

  for (let i = 0; i < records.length; i++) {
    const rec = records[i];
    const atchId = atchmnflIds[i] || '';

    console.log(`  [${i+1}/${records.length}] ${rec.executionDate} ${rec.purpose.substring(0,25)} | atchmnflId=${atchId ? atchId.substring(0,15) + '...' : '없음'}`);

    if (!atchId) {
      console.log('    → 첨부파일 ID 없음, 스킵');
      attachmentResults.push({ files: [] });
      continue;
    }

    const dlDir = path.join(BASE_DIR, `record-${i+1}`);
    const files = await downloadFromPopup(page, context, atchId, dlDir);
    console.log(`    → 파일 ${files.length}개${files.length > 0 ? ': ' + files.map(f => f.name).join(', ') : ''}`);
    attachmentResults.push({ files });

    await page.waitForTimeout(500);
  }

  // 4. PDF 분석 (OCR 포함)
  console.log('\n[4/6] PDF 분석 (OCR 포함)...');
  for (let i = 0; i < attachmentResults.length; i++) {
    const result = attachmentResults[i];
    const rec = records[i];
    console.log(`  [${i+1}] ${rec.purpose.substring(0,30)}`);
    for (const file of result.files) {
      if (file.name.toLowerCase().endsWith('.pdf')) {
        try {
          const text = await extractPdfText(file.path);
          file.text = text;
          file.docType = detectDocType(file.name, text);
          const method = text.length > 50 ? (text.includes('\n') ? 'OCR' : 'text') : 'minimal';
          console.log(`    ${file.name}: ${file.docType} (${text.length}자, ${method})`);
        } catch {
          file.docType = '분석실패';
          console.log(`    ${file.name}: 분석실패`);
        }
      } else {
        file.docType = detectDocType(file.name, '');
        console.log(`    ${file.name}: ${file.docType} (비PDF)`);
      }
    }
  }

  // 5. 내용 대조 판단
  console.log('\n[5/6] 내용 대조 판단...');
  const judgments: { judgment: string; opinion: string }[] = [];
  for (let i = 0; i < records.length; i++) {
    const rec = records[i];
    const att = attachmentResults[i] || { files: [] };
    const result = judgeRecord(rec, att.files);
    judgments.push(result);
    const symbol = result.judgment === '적정' ? '○' : result.judgment === '부적정' ? '✗' : '△';
    console.log(`  [${i+1}] ${symbol} ${result.judgment}: ${rec.purpose.substring(0,25)}`);
  }

  // 6. 결과 엑셀
  console.log('\n[6/6] 결과 엑셀 생성...');
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('점검결과');

  ws.columns = [
    { header: '번호', key: 'no', width: 6 },
    { header: '집행실행일자', key: 'execDate', width: 13 },
    { header: '작성일자', key: 'writeDate', width: 13 },
    { header: '증빙구분', key: 'evidenceType', width: 12 },
    { header: '집행용도', key: 'purpose', width: 45 },
    { header: '비목명', key: 'budget', width: 12 },
    { header: '세목명', key: 'subCat', width: 18 },
    { header: '품목명', key: 'item', width: 20 },
    { header: '거래처명', key: 'vendor', width: 18 },
    { header: '집행금액', key: 'amount', width: 15 },
    { header: '검토상태', key: 'reviewStatus', width: 10 },
    { header: '첨부파일수', key: 'fileCount', width: 10 },
    { header: '첨부파일목록', key: 'fileList', width: 50 },
    { header: '문서유형', key: 'docTypes', width: 30 },
    { header: '판단', key: 'judgment', width: 10 },
    { header: '점검의견', key: 'opinion', width: 50 },
  ];

  ws.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
  ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF4472C4' } };

  for (let i = 0; i < records.length; i++) {
    const rec = records[i];
    const att = attachmentResults[i] || { files: [] };
    const fileNames = att.files.map(f => f.name).join('\n');
    const docTypes = att.files.map(f => f.docType).filter(Boolean).join(', ');
    const { judgment, opinion } = judgments[i];

    const row = ws.addRow({
      no: i + 1,
      execDate: rec.executionDate,
      writeDate: rec.writeDate,
      evidenceType: rec.evidenceType,
      purpose: rec.purpose,
      budget: rec.budgetCategory,
      subCat: rec.subCategory,
      item: rec.itemName,
      vendor: rec.vendorName,
      amount: rec.totalAmount,
      reviewStatus: rec.reviewStatus,
      fileCount: att.files.length,
      fileList: fileNames,
      docTypes,
      judgment,
      opinion,
    });

    row.getCell('amount').numFmt = '#,##0';

    const judgCell = row.getCell('judgment');
    if (judgment === '적정') {
      judgCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF4CAF50' } };
      judgCell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    } else if (judgment === '부적정') {
      judgCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFF6B6B' } };
      judgCell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    } else if (judgment === '확인필요') {
      judgCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFEB3B' } };
    }
  }

  const now = new Date();
  const ts = `${now.getFullYear()}${String(now.getMonth()+1).padStart(2,'0')}${String(now.getDate()).padStart(2,'0')}_${String(now.getHours()).padStart(2,'0')}${String(now.getMinutes()).padStart(2,'0')}`;
  const excelPath = path.join(RESULT_DIR, `점검결과_${ts}.xlsx`);
  await wb.xlsx.writeFile(excelPath);

  console.log(`\n=== 완료 ===`);
  console.log(`처리: ${records.length}건`);
  console.log(`엑셀: ${excelPath}`);

  console.log('\n--- 요약 ---');
  let countOk = 0, countBad = 0, countCheck = 0;
  for (let i = 0; i < records.length; i++) {
    const rec = records[i];
    const att = attachmentResults[i] || { files: [] };
    const j = judgments[i];
    const symbol = j.judgment === '적정' ? '○' : j.judgment === '부적정' ? '✗' : '△';
    if (j.judgment === '적정') countOk++;
    else if (j.judgment === '부적정') countBad++;
    else countCheck++;
    console.log(`${symbol} ${i+1}. ${rec.executionDate} | ${rec.purpose.substring(0,25)} | ${rec.totalAmount.toLocaleString()}원 | 파일${att.files.length} | ${j.judgment}`);
  }
  console.log(`\n적정: ${countOk}건, 부적정: ${countBad}건, 확인필요: ${countCheck}건`);

  await mainCdp.detach().catch(() => {});
  await browser.close();
}

main().catch(console.error);
