/**
 * smart-collector.js — 맥락(Context) 기반 지능형 증빙 수집기
 *
 * "1번 폴더에 있겠지"라는 가정을 버리고,
 * 파일명, 폴더명, 파일내용, 날짜, 금액을 종합하여
 * 해당 지출건과 가장 관련성 높은 증빙파일을 찾아냅니다.
 */
const fs = require('fs');
const path = require('path');
const { extractPdfText, extractHwpText, extractExcelText, extractImageText } = require('../lib/collect-generic');

// 탐색할 파일 확장자
const EXTENSIONS = ['.pdf', '.jpg', '.jpeg', '.png', '.xlsx', '.xls', '.hwp', '.txt'];
const MAX_TEXT_LEN = 15000;

/**
 * 디렉토리 재귀 탐색하여 모든 파일 목록(메타데이터 포함) 반환
 */
function scanAllFiles(dir, rootDir = null) {
  if (!rootDir) rootDir = dir;
  let results = [];
  const list = fs.readdirSync(dir);

  for (const file of list) {
    const fullPath = path.join(dir, file);
    const stat = fs.statSync(fullPath);

    if (stat && stat.isDirectory()) {
      results = results.concat(scanAllFiles(fullPath, rootDir));
    } else {
      const ext = path.extname(fullPath).toLowerCase();
      if (EXTENSIONS.includes(ext)) {
        // 상대 경로 (루트 기준)
        const relPath = path.relative(rootDir, fullPath);
        results.push({
          path: fullPath,
          relPath: relPath,
          name: file,
          ext: ext,
          size: stat.size,
          parentDir: path.basename(path.dirname(fullPath)),
          grandParentDir: path.basename(path.dirname(path.dirname(fullPath))),
        });
      }
    }
  }
  return results;
}

/**
 * 텍스트 정규화 (매칭용)
 */
function normalizeStr(str) {
  return (str || '').replace(/[\s\-_.]/g, '').toLowerCase();
}

/**
 * 지출 건(Row)에 적합한 증빙 파일들을 찾아서 점수 매김
 */
async function findEvidence(row, allFiles) {
  const candidates = [];
  
  // 키워드 추출
  const dateStr = row.date ? row.date.replace(/-/g, '').substring(4, 6) : ''; // "06" (월)
  const monthName = dateStr ? parseInt(dateStr) + '월' : '';
  const vendor = normalizeStr(row.vendorName);
  const purpose = normalizeStr(row.purpose);
  const amount = row.amount || 0;
  const subCat = normalizeStr(row.subCategory); // "인건비", "회의비" 등
  const budgetCat = normalizeStr(row.budgetCategory);

  // 1차 필터링 (파일명/경로 기반)
  for (const file of allFiles) {
    let score = 0;
    const fName = normalizeStr(file.name);
    const pName = normalizeStr(file.parentDir);
    const gpName = normalizeStr(file.grandParentDir);
    const fullContext = fName + pName + gpName;

    // 1. 날짜(월) 매칭
    if (monthName && fullContext.includes(monthName)) score += 30;
    else if (dateStr && fullContext.includes(dateStr)) score += 10;

    // 2. 비목/세목 매칭 (폴더명)
    const isLabor = subCat.includes('인건비') || subCat.includes('급여') || subCat.includes('임금') || budgetCat.includes('인건비');
    const isMeeting = subCat.includes('회의') || budgetCat.includes('회의');
    const isTravel = subCat.includes('여비') || subCat.includes('출장') || budgetCat.includes('여비');

    if (isLabor) {
      if (fullContext.includes('인건비')) score += 50;
      if (fullContext.includes('급여')) score += 50;
    }
    if (isMeeting) {
      if (fullContext.includes('회의')) score += 40;
    }
    if (isTravel) {
      if (fullContext.includes('출장') || fullContext.includes('여비')) score += 40;
    }

    // 3. 거래처/사람 매칭
    if (vendor && vendor.length > 1 && fullContext.includes(vendor)) score += 60;
    
    // 4. 금액 매칭 (파일명에 금액이 있는 경우 드물지만)
    if (amount > 0 && fullContext.includes(String(amount))) score += 80;

    // 점수가 일정 수준 이상이면 후보 등록 (텍스트 추출 대상)
    if (score >= 40) {
      candidates.push({ file, score, reason: 'path_match' });
    }
  }

  // 2차 필터링 (내용 기반 - 후보군 중 상위권만)
  // 너무 많으면 상위 5개만 텍스트 추출
  candidates.sort((a, b) => b.score - a.score);
  const finalMatches = [];

  for (const cand of candidates.slice(0, 5)) {
    const { file } = cand;
    let text = '';
    
    // 텍스트 추출 (캐싱 필요하지만 여기선 생략)
    try {
      if (file.ext === '.pdf') text = await extractPdfText(file.path);
      else if (file.ext === '.hwp') text = await extractHwpText(file.path);
      else if (file.ext === '.xlsx') text = await extractExcelText(file.path);
      else if (file.ext === '.txt') text = fs.readFileSync(file.path, 'utf-8');
      // 이미지는 느리므로 정말 확실한 경우만? 일단 스킵하거나 필요시 추가
    } catch (e) { continue; }

    text = text || '';
    const normText = normalizeStr(text);

    // 내용 점수 추가
    let contentScore = 0;
    if (amount > 0 && (text.includes(String(amount)) || text.includes(amount.toLocaleString()))) {
      contentScore += 100; // 금액 일치하면 강력
    }
    
    // 인건비의 경우 '이체' 금액이 다를 수 있음 -> 로직 분리 필요하지만 일단 키워드
    const isLabor = subCat.includes('인건비') || subCat.includes('급여') || subCat.includes('임금') || budgetCat.includes('인건비');
    if (isLabor && (normText.includes('급여') || normText.includes('명세서'))) contentScore += 50;
    if (vendor && normText.includes(vendor)) contentScore += 50;

    if (cand.score + contentScore >= 80) { // 기준점
      finalMatches.push({
        name: file.name,
        path: file.path,
        text: text.substring(0, MAX_TEXT_LEN),
        score: cand.score + contentScore
      });
    }
  }

  return finalMatches;
}

module.exports = { scanAllFiles, findEvidence };
