/**
 * 경기도의료원 안성병원 187건 데이터 수집
 * 소스 엑셀 읽기 + 다운로드 파일 OCR → JSON 출력
 * (브라우저 불필요, 이미 다운로드된 파일 사용)
 */
import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import pdfParse from 'pdf-parse';
import ExcelJS from 'exceljs';

const SOURCE_EXCEL = '/mnt/c/Users/정동회계법인/Downloads/경기도의료원 안성병원/B0080313003078_사업집행내역_20260206160119.xlsx';
const BASE_DIR = '/mnt/c/projects/e-naradomum-rpa/downloads/ansung';
const OUTPUT_JSON = '/mnt/c/projects/e-naradomum-rpa/ansung-data.json';

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

async function extractExcelText(filePath: string): Promise<string> {
  try {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(filePath);
    const texts: string[] = [];
    for (const ws of wb.worksheets) {
      ws.eachRow((row) => {
        const vals = row.values as any[];
        if (vals) {
          const rowText = vals.slice(1).map(v => v?.toString() || '').join(' ').trim();
          if (rowText) texts.push(rowText);
        }
      });
    }
    return texts.join('\n');
  } catch {
    return '';
  }
}

function extractHwpText(filePath: string): string {
  try {
    const result = execSync(`hwp5txt "${filePath}" 2>/dev/null`, { timeout: 30000, maxBuffer: 10 * 1024 * 1024 });
    return result.toString('utf-8').trim();
  } catch {
    return '';
  }
}

function extractImageText(filePath: string): string {
  const tmpDir = `/tmp/ocr-${Date.now()}-${Math.random().toString(36).substring(7)}`;
  fs.mkdirSync(tmpDir, { recursive: true });
  try {
    const outBase = path.join(tmpDir, 'out');
    execSync(`tesseract "${filePath}" "${outBase}" -l kor 2>/dev/null`, { timeout: 30000 });
    return fs.readFileSync(`${outBase}.txt`, 'utf-8').trim();
  } catch {
    return '';
  } finally {
    try { execSync(`rm -rf "${tmpDir}"`); } catch {}
  }
}

function classifyDoc(fileName: string, text: string): string {
  const fn = fileName.toLowerCase();
  const t = text.toLowerCase();

  // 복합 문서 대응: 파일명 기반 1차 분류 + 텍스트 기반 2차 보완
  // 1차: 파일명 기반 주분류
  let primary = '';

  // 통장 거래내역 (이체증)
  if ((t.includes('수납내역') || t.includes('거래내역') || t.includes('계좌구분')) &&
      (t.includes('입금액') || t.includes('거래일자') || t.includes('적요'))) {
    primary = '이체증';
  }

  if (!primary && fn.includes('인센티브') && (fn.includes('지급') || fn.includes('상세') || fn.includes('내역'))) primary = '인센티브지급내역';
  if (!primary && (fn.includes('케어플랜') || fn.includes('퇴원') && fn.includes('리스트'))) primary = '퇴원케어플랜';
  if (!primary && (fn.includes('자문의뢰') || t.includes('자문의뢰'))) primary = '자문의뢰서';
  if (!primary && (fn.includes('자문회신') || t.includes('자문회신'))) primary = '자문회신서';
  if (!primary && ((fn.includes('자문') && fn.includes('요청')) || t.includes('자문 요청'))) primary = '자문요청서';
  if (!primary && (fn.includes('지출결의') || fn.includes('지결') || t.includes('지출결의'))) primary = '지출결의서';
  if (!primary && (fn.includes('입금의뢰') || t.includes('입금의뢰'))) primary = '입금의뢰서';
  if (!primary && (fn.includes('기안') || t.includes('기안문'))) primary = '기안문';
  if (!primary && (fn.includes('급여') || fn.includes('인건비') || t.includes('급여명세') || t.includes('급여(상여)명세'))) primary = '급여명세';
  if (!primary && (fn.includes('소급') || t.includes('소급'))) primary = '소급분';
  if (!primary && fn.includes('재직증명')) primary = '재직증명서';
  if (!primary && (fn.includes('발령') || t.includes('인사발령'))) primary = '인사발령';
  if (!primary && (fn.includes('세금계산서') || t.includes('세금계산서'))) primary = '세금계산서';
  if (!primary && (fn.includes('영수증') || t.includes('영수증') || t.includes('카드매출') || fn.includes('카드'))) primary = '영수증/카드';
  if (!primary && (fn.includes('견적') || t.includes('견적서'))) primary = '견적서';
  if (!primary && (fn.includes('계약') || t.includes('계약서'))) primary = '계약서';
  if (!primary && (fn.includes('거래명세') || t.includes('거래명세'))) primary = '거래명세서';
  if (!primary && (fn.includes('출장') || t.includes('출장'))) primary = '출장서류';
  if (!primary && (fn.includes('회의록') || t.includes('회의록'))) primary = '회의록';
  if (!primary && (fn.includes('결과보고') || t.includes('결과보고'))) primary = '결과보고서';
  if (!primary && (fn.includes('물품검수') || t.includes('검수'))) primary = '물품검수확인서';
  if (!primary && (fn.includes('공급승낙') || t.includes('공급승낙'))) primary = '공급승낙서';
  if (!primary && (fn.includes('수당') || t.includes('수당지급'))) primary = '수당지급조서';
  if (!primary && (fn.includes('이체') || t.includes('이체'))) primary = '이체증';
  if (!primary && (fn.includes('통장') || t.includes('통장'))) primary = '통장사본';
  if (!primary && (fn.includes('보험') || t.includes('보험'))) primary = '보험관련';
  if (!primary) primary = '기타';

  // 2차: 텍스트 기반 보완 (합본 문서에서 추가 증빙 감지)
  // 지출결의서인데 세금계산서/카드영수증도 포함된 경우
  if (primary === '지출결의서' || primary === '기안문' || primary === '수당지급조서') {
    if (t.includes('세금계산서') || t.includes('전자세금계산서')) return primary + '+세금계산서';
    if (t.includes('신용카드') || t.includes('카드매출') || t.includes('승인금액') || t.includes('카드영수증')) return primary + '+영수증/카드';
  }

  return primary;
}

function extractAmounts(text: string): number[] {
  const amounts: number[] = [];
  // 이메일/타임스탬프 패턴 제거 후 추출
  const cleaned = text.replace(/\d+@[\d.]+/g, '').replace(/\d{4}-\d{2}-\d{2}\s*\d{2}:\d{2}:\d{2}\d+/g, '');
  const matches = cleaned.match(/[\d,]{4,}원?/g) || [];
  for (const m of matches) {
    const num = parseInt(m.replace(/[^0-9]/g, ''));
    // 1,000원 ~ 10억원 범위만 유효 금액으로 인정
    if (num >= 1000 && num < 1000000000) amounts.push(num);
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

    const exts = ['.pdf', '.xlsx', '.hwp', '.jpg', '.jpeg', '.png'];
    const fileNames = fs.readdirSync(dlDir).filter(f => exts.some(e => f.toLowerCase().endsWith(e)));
    for (const fn of fileNames) {
      const fp = path.join(dlDir, fn);
      const fnLower = fn.toLowerCase();
      let text = '';
      if (fnLower.endsWith('.pdf')) {
        text = await extractPdfText(fp);
      } else if (fnLower.endsWith('.xlsx')) {
        text = await extractExcelText(fp);
      } else if (fnLower.endsWith('.hwp')) {
        text = extractHwpText(fp);
      } else if (fnLower.endsWith('.jpg') || fnLower.endsWith('.jpeg') || fnLower.endsWith('.png')) {
        text = extractImageText(fp);
      }
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
