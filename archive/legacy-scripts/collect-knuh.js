/**
 * 경북대학교병원 31건 - 증빙파일 텍스트 추출 → JSON 출력
 */
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const ExcelJS = require('exceljs');

const SOURCE_EXCEL = '/mnt/c/Users/정동회계법인/Documents/2025 보조금 본정산/대구경북첨단의료산업진흥재단/디지털헬스케어 의료기기 실증지원 사업/경북대학교병원/B0071029000066_사업집행내역_20260210180224.xlsx';
const BASE_DIR = '/mnt/c/projects/e-naradomum-rpa/downloads/knuh';
const OUTPUT_JSON = '/mnt/c/projects/e-naradomum-rpa/knuh-data.json';

function formatDate(val) {
  if (!val) return '';
  if (val instanceof Date) return val.toISOString().substring(0, 10);
  return String(val);
}
function parseNumber(val) {
  if (typeof val === 'number') return val;
  if (!val) return 0;
  return parseInt(String(val).replace(/[^0-9-]/g, '')) || 0;
}

async function extractPdfText(filePath) {
  try {
    const pdfParse = require('pdf-parse');
    const buf = fs.readFileSync(filePath);
    const data = await pdfParse(buf);
    if (data.text.trim().length > 50) return data.text.trim();
  } catch {}
  // OCR 폴백
  const tmpDir = `/tmp/ocr-${Date.now()}-${Math.random().toString(36).substring(7)}`;
  fs.mkdirSync(tmpDir, { recursive: true });
  try {
    execSync(`pdftoppm -png -r 250 -f 1 -l 3 "${filePath}" "${tmpDir}/p"`, { timeout: 30000 });
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
  } catch { return ''; }
  finally { try { execSync(`rm -rf "${tmpDir}"`); } catch {} }
}

function extractHwpText(filePath) {
  try {
    const result = execSync(`hwp5txt "${filePath}" 2>/dev/null`, { timeout: 30000, maxBuffer: 10 * 1024 * 1024 });
    return result.toString('utf-8').trim();
  } catch { return ''; }
}

function extractImageText(filePath) {
  const tmpDir = `/tmp/ocr-${Date.now()}-${Math.random().toString(36).substring(7)}`;
  fs.mkdirSync(tmpDir, { recursive: true });
  try {
    const outBase = path.join(tmpDir, 'out');
    execSync(`tesseract "${filePath}" "${outBase}" -l kor 2>/dev/null`, { timeout: 30000 });
    return fs.readFileSync(`${outBase}.txt`, 'utf-8').trim();
  } catch { return ''; }
  finally { try { execSync(`rm -rf "${tmpDir}"`); } catch {} }
}

async function extractExcelText(filePath) {
  try {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(filePath);
    const texts = [];
    for (const ws of wb.worksheets) {
      ws.eachRow((row) => {
        const vals = row.values;
        if (vals) {
          const rowText = vals.slice(1).map(v => v ? v.toString() : '').join(' ').trim();
          if (rowText) texts.push(rowText);
        }
      });
    }
    return texts.join('\n');
  } catch { return ''; }
}

async function main() {
  console.log('[1/3] 소스 엑셀 읽기...');
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(SOURCE_EXCEL);
  const ws = wb.worksheets[0];

  const records = [];
  for (let r = 3; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const purpose = String(row.getCell(6).value || '').trim();
    if (!purpose) continue;
    records.push({
      rowNum: r - 2,
      executionDate: formatDate(row.getCell(1).value),
      registDate: formatDate(row.getCell(2).value),
      writeDate: formatDate(row.getCell(3).value),
      evidenceType: String(row.getCell(4).value || '').trim(),
      evidenceSub: String(row.getCell(5).value || '').trim(),
      purpose,
      budgetCategory: String(row.getCell(7).value || '').trim(),
      subCategory: String(row.getCell(8).value || '').trim(),
      itemName: String(row.getCell(9).value || '').trim(),
      vendorName: String(row.getCell(10).value || '').trim(),
      depositorName: String(row.getCell(11).value || '').trim(),
      bizType: String(row.getCell(16).value || '').trim(),
      supplyAmount: parseNumber(row.getCell(17).value),
      vat: parseNumber(row.getCell(18).value),
      cancelAmount: parseNumber(row.getCell(19).value),
      totalAmount: parseNumber(row.getCell(20).value),
      disallowedAmount: parseNumber(row.getCell(22).value),
      reviewStatus: String(row.getCell(23).value || '').trim(),
      files: [],
    });
  }
  console.log(`  ${records.length}건 로드`);

  console.log('[2/3] 다운로드 파일 OCR...');
  let done = 0;
  for (const rec of records) {
    const dlDir = path.join(BASE_DIR, `r${rec.rowNum}`);
    if (!fs.existsSync(dlDir)) { done++; continue; }

    const exts = ['.pdf', '.xlsx', '.xls', '.hwp', '.jpg', '.jpeg', '.png', '.pptx'];
    const fileNames = fs.readdirSync(dlDir).filter(f => exts.some(e => f.toLowerCase().endsWith(e)));
    for (const fn of fileNames) {
      const fp = path.join(dlDir, fn);
      const fnLower = fn.toLowerCase();
      let text = '';
      if (fnLower.endsWith('.pdf')) {
        text = await extractPdfText(fp);
      } else if (fnLower.endsWith('.xlsx') || fnLower.endsWith('.xls')) {
        text = await extractExcelText(fp);
      } else if (fnLower.endsWith('.hwp')) {
        text = extractHwpText(fp);
      } else if (fnLower.endsWith('.jpg') || fnLower.endsWith('.jpeg') || fnLower.endsWith('.png')) {
        text = extractImageText(fp);
      } else if (fnLower.endsWith('.pptx')) {
        text = '[PPTX file - text extraction skipped]';
      }
      rec.files.push({ name: fn, text: text.substring(0, 4000) });
    }
    done++;
    if (done % 5 === 0 || done === records.length) {
      console.log(`  [${done}/${records.length}] ${rec.purpose.substring(0, 30)}`);
    }
  }

  console.log('[3/3] JSON 저장...');
  fs.writeFileSync(OUTPUT_JSON, JSON.stringify(records, null, 2), 'utf-8');
  const sizeMB = (fs.statSync(OUTPUT_JSON).size / 1024 / 1024).toFixed(1);
  console.log(`  ${OUTPUT_JSON} (${sizeMB}MB)`);

  // 요약
  const cats = new Map();
  for (const r of records) {
    const key = `${r.budgetCategory}/${r.subCategory}` || '(미분류)';
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
