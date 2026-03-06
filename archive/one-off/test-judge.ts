/**
 * 이미 다운받은 5건 PDF에 OCR+판단만 돌리기 (다운로드 스킵)
 */
import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import pdfParse from 'pdf-parse';
import ExcelJS from 'exceljs';

const SOURCE_EXCEL = '/mnt/c/Users/정동회계법인/Downloads/B0080124003815_사업집행내역_20260204151120.xlsx';
const BASE_DIR = '/mnt/c/projects/e-naradomum-rpa/downloads/pipeline-v3';

interface SourceRecord {
  rowNum: number; executionDate: string; purpose: string;
  budgetCategory: string; subCategory: string; vendorName: string;
  supplyAmount: number; totalAmount: number; reviewStatus: string;
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

async function extractPdfText(filePath: string): Promise<string> {
  try {
    const buf = fs.readFileSync(filePath);
    const data = await pdfParse(buf);
    if (data.text.trim().length > 50) return data.text;
  } catch {}

  const tmpDir = `/tmp/ocr-${Date.now()}`;
  fs.mkdirSync(tmpDir, { recursive: true });
  try {
    execSync(`pdftoppm -png -r 300 -f 1 -l 2 "${filePath}" "${tmpDir}/page"`, { timeout: 30000 });
    const images = fs.readdirSync(tmpDir).filter(f => f.endsWith('.png')).sort();
    let ocrText = '';
    for (const img of images) {
      const outBase = path.join(tmpDir, `ocr-${img}`);
      try {
        execSync(`tesseract "${path.join(tmpDir, img)}" "${outBase}" -l kor 2>/dev/null`, { timeout: 30000 });
        ocrText += fs.readFileSync(`${outBase}.txt`, 'utf-8') + '\n';
      } catch {}
    }
    return ocrText;
  } catch { return ''; }
  finally { fs.rmSync(tmpDir, { recursive: true, force: true }); }
}

function detectDocType(fn: string, text: string): string {
  fn = fn.toLowerCase();
  if (fn.includes('지출결의') || text.includes('지출결의')) return '지출결의서';
  if (fn.includes('입금의뢰') || text.includes('입금의뢰')) return '입금의뢰서';
  if (fn.includes('인센티브') || text.includes('인센티브')) return '인센티브지급서';
  if (fn.includes('급여') || fn.includes('인건비')) return '급여명세서';
  if (fn.includes('소급') || text.includes('소급')) return '소급분지급서';
  if (fn.includes('재직증명')) return '재직증명서';
  if (fn.includes('발령') || text.includes('인사발령')) return '인사발령문서';
  if (fn.includes('세금계산서') || text.includes('세금계산서')) return '세금계산서';
  if (fn.includes('영수증') || text.includes('영수증')) return '영수증/카드전표';
  return '기타';
}

function extractAmounts(text: string): number[] {
  const amounts: number[] = [];
  const matches = text.match(/[\d,]{4,}원?/g) || [];
  for (const m of matches) {
    const num = parseInt(m.replace(/[^0-9]/g, ''));
    if (num >= 1000 && num < 10000000000) amounts.push(num);
  }
  return [...new Set(amounts)].sort((a, b) => b - a);
}

function judgeRecord(rec: SourceRecord, files: { name: string; text: string; docType: string }[]): { judgment: string; opinion: string } {
  if (files.length === 0) return { judgment: '부적정', opinion: '증빙서류 미첨부' };

  const allTexts = files.map(f => f.text).join('\n');
  const amounts = extractAmounts(allTexts);
  const issues: string[] = [];
  const good: string[] = [];

  // 지출결의서
  if (files.some(f => f.docType === '지출결의서')) good.push('지출결의서 있음');
  else issues.push('지출결의서 미첨부');

  // 금액 대조
  if (amounts.length > 0) {
    const matched = amounts.some(a => a === rec.totalAmount || Math.abs(a - rec.totalAmount) / rec.totalAmount < 0.05);
    if (matched) good.push(`금액 일치 (${rec.totalAmount.toLocaleString()}원)`);
    else {
      const supplyMatch = rec.supplyAmount > 0 && amounts.some(a => a === rec.supplyAmount);
      if (supplyMatch) good.push(`공급가액 일치`);
      else issues.push(`금액 불일치 (집행:${rec.totalAmount.toLocaleString()}, 증빙:${amounts.slice(0,2).map(a=>a.toLocaleString()).join('/')})`);
    }
  } else {
    issues.push('금액 추출 불가');
  }

  // 거래처
  if (rec.vendorName && allTexts.includes(rec.vendorName)) good.push(`거래처 확인 (${rec.vendorName})`);

  // 용도 키워드
  const keywords = rec.purpose.replace(/[0-9년월일분기]/g, '').split(/[\s,_()（）]+/).filter(w => w.length >= 2);
  const matched = keywords.filter(kw => allTexts.includes(kw));
  if (matched.length >= 2) good.push(`용도 관련: ${matched.slice(0,3).join(',')}`);

  // 인건비 추가 체크
  if (rec.budgetCategory.includes('인건비') && !files.some(f => ['입금의뢰서','급여명세서'].includes(f.docType))) {
    issues.push('인건비: 입금의뢰서/급여명세 미첨부');
  }

  let judgment: string;
  if (issues.length === 0 && good.length >= 2) judgment = '적정';
  else if (issues.some(i => i.includes('지출결의서 미첨부'))) judgment = '부적정';
  else if (issues.some(i => i.includes('불일치'))) judgment = '확인필요';
  else judgment = '확인필요';

  const opinion = [...good.map(g => `✓${g}`), ...issues.map(i => `✗${i}`)].join(' / ');
  return { judgment, opinion };
}

async function main() {
  console.log('=== OCR + 판단 테스트 (다운로드된 5건) ===\n');

  // 소스 엑셀
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(SOURCE_EXCEL);
  const ws = wb.worksheets[0];
  const records: SourceRecord[] = [];
  for (let r = 3; r <= Math.min(7, ws.rowCount); r++) {
    const row = ws.getRow(r);
    if (!row.getCell(1).value) continue;
    records.push({
      rowNum: r,
      executionDate: formatDate(row.getCell(1).value),
      purpose: String(row.getCell(6).value ?? ''),
      budgetCategory: String(row.getCell(7).value ?? ''),
      subCategory: String(row.getCell(8).value ?? ''),
      vendorName: String(row.getCell(10).value ?? ''),
      supplyAmount: parseNumber(row.getCell(17).value),
      totalAmount: parseNumber(row.getCell(20).value),
      reviewStatus: String(row.getCell(23).value ?? ''),
    });
  }

  for (let i = 0; i < records.length; i++) {
    const rec = records[i];
    const dir = path.join(BASE_DIR, `record-${i+1}`);
    console.log(`\n--- [${i+1}] ${rec.executionDate} ${rec.purpose.substring(0,40)} ---`);
    console.log(`    집행금액: ${rec.totalAmount.toLocaleString()}원 | 거래처: ${rec.vendorName} | 비목: ${rec.budgetCategory}`);

    if (!fs.existsSync(dir)) {
      console.log('    디렉토리 없음');
      continue;
    }

    const pdfFiles = fs.readdirSync(dir).filter(f => f.endsWith('.pdf'));
    const files: { name: string; text: string; docType: string }[] = [];

    for (const f of pdfFiles) {
      console.log(`    OCR: ${f}...`);
      const text = await extractPdfText(path.join(dir, f));
      const docType = detectDocType(f, text);
      files.push({ name: f, text, docType });
      console.log(`      → ${docType} (${text.length}자)`);

      // 추출된 금액 표시
      const amounts = extractAmounts(text);
      if (amounts.length > 0) console.log(`      → 금액: ${amounts.slice(0,5).map(a=>a.toLocaleString()).join(', ')}원`);
    }

    const result = judgeRecord(rec, files);
    const symbol = result.judgment === '적정' ? '○' : result.judgment === '부적정' ? '✗' : '△';
    console.log(`    ${symbol} 판단: ${result.judgment}`);
    console.log(`    의견: ${result.opinion}`);
  }
}
main().catch(console.error);
