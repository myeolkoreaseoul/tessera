/**
 * write-result-to-excel.js — 판정 결과를 원본 엑셀에 업데이트
 *
 * 사용자가 "G/H열에 기입"을 요청.
 * 빈 열이면 G/H 사용, 차있으면 그 다음 빈 열을 사용.
 */
const ExcelJS = require('exceljs');
const fs = require('fs');
const path = require('path');

// 색상 상수
const COLORS = {
  okBg: 'E8F5E9',       // 연초록 (적정)
  checkBg: 'FFFCE4EC',    // 연분홍 (확인)
  skipBg: 'FFF5F5F5',     // 연회색 (SKIP)
  headerBg: 'D9E1F2',   // 헤더 배경
};

/**
 * 엑셀 업데이트 함수
 * @param {string} originalExcelPath 원본 엑셀 경로
 * @param {Array} results 판정 결과 (gemini-judge-paper 결과)
 * @param {Array} enrichedData 정규화된 데이터 (excelRowNum 포함)
 * @param {object} options { headerRow: 1, ... }
 */
async function writeResultToExcel(originalExcelPath, results, enrichedData, options = {}) {
  const { headerRow = 1 } = options;
  
  if (!fs.existsSync(originalExcelPath)) {
    throw new Error(`[writeResultToExcel] 파일 없음: ${originalExcelPath}`);
  }

  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(originalExcelPath);
  const ws = wb.worksheets[0]; // 첫 번째 시트 가정

  // 1. 기입할 컬럼 위치 결정 (G/H열 확인)
  // G열=7, H열=8 (1-based index)
  let resultColIdx = 7;
  let reasonColIdx = 8;
  
  // 헤더 행 확인
  const headerR = ws.getRow(headerRow);
  
  // 사용 가능한 빈 열 찾기 (G열부터 시작)
  let targetCol = 7;
  while (true) {
    const cellVal = String(headerR.getCell(targetCol).value || '').trim();
    const nextVal = String(headerR.getCell(targetCol + 1).value || '').trim();
    
    // 1) 둘 다 비어있거나
    // 2) 이미 우리가 작성한 '검토결과' 헤더인 경우
    if ((cellVal === '' && nextVal === '') || cellVal.includes('검토결과')) {
      resultColIdx = targetCol;
      reasonColIdx = targetCol + 1;
      break;
    }
    
    // 옆으로 이동 (2칸씩)
    targetCol++;
    
    // 무한루프 방지 (AZ열까지만 체크)
    if (targetCol > 52) { 
        // 너무 멀리감, 그냥 맨 끝 다음 열에 추가
        resultColIdx = ws.columnCount + 1;
        reasonColIdx = resultColIdx + 1;
        break;
    }
  }

  console.log(`  [엑셀기입] 결과: 열${resultColIdx}(${getColumnLetter(resultColIdx)}), 사유: 열${reasonColIdx}(${getColumnLetter(reasonColIdx)}) (헤더행: ${headerRow})`);

  // 헤더 작성
  const resHeader = headerR.getCell(resultColIdx);
  const reasHeader = headerR.getCell(reasonColIdx);

  resHeader.value = '검토결과';
  reasHeader.value = '검토사유';
  
  [resHeader, reasHeader].forEach(cell => {
    cell.font = { bold: true };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF' + COLORS.headerBg } };
    cell.border = { bottom: { style: 'thin' } };
    cell.alignment = { horizontal: 'center', vertical: 'middle' };
  });

  // 2. 결과 매핑 (rowNum -> result)
  const resultMap = {};
  for (const r of results) {
    resultMap[r.rowNum] = r;
  }

  // 3. 데이터 행 업데이트
  let updateCount = 0;
  for (const item of enrichedData) {
      if (!item.excelRowNum) continue; // 엑셀 행 번호 없으면 스킵
      
      const row = ws.getRow(item.excelRowNum);
      const res = resultMap[item.rowNum];
      
      if (!res) continue;

      const status = res.status || '확인';
      const issues = res.issues || [];
      const reason = res.reasoning || issues.join(', ');

      // 결과 기입
      const statusCell = row.getCell(resultColIdx);
      statusCell.value = status;
      statusCell.alignment = { horizontal: 'center' };

      // 사유 기입
      const reasonCell = row.getCell(reasonColIdx);
      reasonCell.value = reason;

      // 색상 적용
      let bg = null;
      if (status === '적정') bg = COLORS.okBg;
      else if (status === '확인') bg = COLORS.checkBg;
      else if (status === 'SKIP') bg = COLORS.skipBg;

      if (bg) {
          statusCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF' + bg } };
      }
      updateCount++;
  }

  // 4. 저장 (사본 생성)
  const dir = path.dirname(originalExcelPath);
  const ext = path.extname(originalExcelPath);
  const name = path.basename(originalExcelPath, ext);
  // 충돌 방지를 위해 시간 추가
  const timestamp = new Date().toISOString().replace(/[-:T]/g, '').substring(8, 14);
  const outPath = path.join(dir, `${name}_검토완료_${timestamp}${ext}`);
  
  await wb.xlsx.writeFile(outPath);
  console.log(`  [저장완료] ${outPath} (${updateCount}건 업데이트)`);
  return outPath;
}

// 1 -> A, 2 -> B 변환 유틸
function getColumnLetter(colIndex) {
  let temp, letter = '';
  while (colIndex > 0) {
    temp = (colIndex - 1) % 26;
    letter = String.fromCharCode(temp + 65) + letter;
    colIndex = (colIndex - temp - 1) / 26;
  }
  return letter;
}

module.exports = { writeResultToExcel };
