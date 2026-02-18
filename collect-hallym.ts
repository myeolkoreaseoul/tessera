/**
 * 한림성심대 272건 데이터 수집
 * 소스 엑셀 읽기 + 다운로드 파일 OCR → JSON 출력
 * (브라우저 불필요, 이미 다운로드된 파일 사용)
 */
import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import pdfParse from 'pdf-parse';
import ExcelJS from 'exceljs';

const SOURCE_EXCEL = '/mnt/c/Users/정동회계법인/Downloads/B0080306002618_사업집행내역_20260204162946.xlsx';
const BASE_DIR = '/mnt/c/projects/e-naradomum-rpa/downloads/hallym';
const OUTPUT_JSON = '/mnt/c/projects/e-naradomum-rpa/hallym-data.json';

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
    if (data.text.trim().length > 50) return data.text.trim();
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
    return ocrText.trim();
  } catch {
    return '';
  } finally {
    try { execSync(`rm -rf "${tmpDir}"`); } catch {}
  }
}

function classifyDoc(fileName: string, text: string): string {
  const fn = fileName.toLowerCase();
  const t = text.toLowerCase();
  if (fn.includes('지출결의') || fn.includes('지결') || t.includes('지출결의')) return '지출결의서';
  if (fn.includes('입금의뢰') || t.includes('입금의뢰')) return '입금의뢰서';
  if (fn.includes('기안') || t.includes('기안문')) return '기안문';
  if (fn.includes('인센티브') || t.includes('인센티브')) return '인센티브';
  if (fn.includes('급여') || fn.includes('인건비') || t.includes('급여명세')) return '급여명세';
  if (fn.includes('소급') || t.includes('소급')) return '소급분';
  if (fn.includes('재직증명')) return '재직증명서';
  if (fn.includes('발령') || t.includes('인사발령')) return '인사발령';
  if (fn.includes('세금계산서') || t.includes('세금계산서')) return '세금계산서';
  if (fn.includes('영수증') || t.includes('영수증') || t.includes('카드매출') || fn.includes('카드')) return '영수증/카드';
  if (fn.includes('견적') || t.includes('견적서')) return '견적서';
  if (fn.includes('계약') || t.includes('계약서')) return '계약서';
  if (fn.includes('거래명세') || t.includes('거래명세')) return '거래명세서';
  if (fn.includes('출장') || t.includes('출장')) return '출장서류';
  if (fn.includes('회의록') || t.includes('회의록')) return '회의록';
  if (fn.includes('결과보고') || t.includes('결과보고')) return '결과보고서';
  if (fn.includes('물품검수') || t.includes('검수')) return '물품검수확인서';
  if (fn.includes('수당') || t.includes('수당지급')) return '수당지급조서';
  if (fn.includes('이체') || t.includes('이체')) return '이체증';
  if (fn.includes('통장') || t.includes('통장')) return '통장사본';
  if (fn.includes('보험') || t.includes('보험')) return '보험관련';
  return '기타';
}

function extractAmounts(text: string): number[] {
  const amounts: number[] = [];
  const matches = text.match(/[\d,]{4,}원?/g) || [];
  for (const m of matches) {
    const num = parseInt(m.replace(/[^0-9]/g, ''));
    if (num >= 1000 && num < 100000000000) amounts.push(num);
  }
  return [...new Set(amounts)].sort((a, b) => b - a);
}

async function main() {
  console.log('[1/3] 소스 엑셀 읽기...');
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(SOURCE_EXCEL);
  const ws = wb.worksheets[0];

  interface Record {
    rowNum: number;
    executionDate: string;
    evidenceType: string;
    purpose: string;
    budgetCategory: string;
    subCategory: string;
    itemName: string;
    vendorName: string;
    supplyAmount: number;
    totalAmount: number;
    reviewStatus: string;
    files: { name: string; text: string; docType: string; amounts: number[] }[];
  }

  const records: Record[] = [];

  for (let r = 3; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const purpose = String(row.getCell(6).value || '').trim();
    if (!purpose) continue;

    records.push({
      rowNum: r - 2,
      executionDate: formatDate(row.getCell(1).value),
      evidenceType: String(row.getCell(4).value || '').trim(),
      purpose,
      budgetCategory: String(row.getCell(7).value || '').trim(),
      subCategory: String(row.getCell(8).value || '').trim(),
      itemName: String(row.getCell(9).value || '').trim(),
      vendorName: String(row.getCell(10).value || '').trim(),
      supplyAmount: parseNumber(row.getCell(17).value),
      totalAmount: parseNumber(row.getCell(20).value),
      reviewStatus: String(row.getCell(23).value || '').trim(),
      files: [],
    });
  }

  console.log(`  ${records.length}건 로드`);

  console.log('[2/3] 다운로드 파일 OCR...');
  let done = 0;
  for (const rec of records) {
    const dlDir = path.join(BASE_DIR, `r${rec.rowNum}`);
    if (!fs.existsSync(dlDir)) {
      done++;
      continue;
    }

    const fileNames = fs.readdirSync(dlDir).filter(f => f.endsWith('.pdf'));
    for (const fn of fileNames) {
      const fp = path.join(dlDir, fn);
      const text = await extractPdfText(fp);
      const docType = classifyDoc(fn, text);
      const amounts = extractAmounts(text);
      rec.files.push({ name: fn, text: text.substring(0, 3000), docType, amounts });
    }

    done++;
    if (done % 20 === 0 || done === records.length) {
      console.log(`  [${done}/${records.length}] ${rec.purpose.substring(0, 30)}`);
    }
  }

  console.log('[3/3] JSON 저장...');
  fs.writeFileSync(OUTPUT_JSON, JSON.stringify(records, null, 2), 'utf-8');
  console.log(`  ${OUTPUT_JSON} (${(fs.statSync(OUTPUT_JSON).size / 1024 / 1024).toFixed(1)}MB)`);

  // 요약
  const cats = new Map<string, { count: number; total: number }>();
  for (const r of records) {
    const key = r.budgetCategory || '(미분류)';
    const prev = cats.get(key) || { count: 0, total: 0 };
    prev.count++;
    prev.total += r.totalAmount;
    cats.set(key, prev);
  }
  console.log('\n비목별 요약:');
  for (const [k, v] of [...cats.entries()].sort((a, b) => b[1].total - a[1].total)) {
    console.log(`  ${k}: ${v.count}건, ${v.total.toLocaleString()}원`);
  }
}

main().catch(console.error);
