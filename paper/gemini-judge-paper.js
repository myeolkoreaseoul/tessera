#!/usr/bin/env node
/**
 * gemini-judge-paper.js — Gemini CLI 기반 페이퍼 정산 판정
 *
 * enriched data + criteria.md → Gemini CLI 호출 → 판정 결과 JSON
 *
 * 사용법:
 *   const { judgePaper } = require('./gemini-judge-paper');
 *   const results = await judgePaper(enrichedData, { criteriaPath, project, institution, outDir });
 *
 *   CLI:
 *   node paper/gemini-judge-paper.js --data=data-enriched.json --criteria=criteria.md --out=projects/사업명-기관명/
 */
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const DEFAULT_BATCH_SIZE = 150;
const GEMINI_TIMEOUT = 600000; // 10분
const GEMINI_MODEL = 'gemini-3-pro-preview';

// ── 프롬프트 생성 ──

function buildPrompt(items, criteria, meta = {}) {
  const { project = '', institution = '' } = meta;

  // 각 항목을 Gemini에 전달할 축약 형식으로 변환
  const dataForPrompt = items.map(item => {
    const entry = {
      rowNum: item.rowNum,
      date: item.date || '',
      purpose: item.purpose || '',
      budgetCategory: item.budgetCategory || '',
      subCategory: item.subCategory || '',
      amount: item.amount || item.totalAmount || 0,
      vendorName: item.vendorName || '',
      memo: item.memo || '',
    };

    // PDF 텍스트 (증빙 내용)
    if (item.files && item.files.length > 0) {
      entry.evidenceFiles = item.files.length;
      entry.pdfTexts = item.files.map(f => ({
        name: f.name,
        text: (f.text || '').substring(0, 2000),
      }));
    } else {
      entry.evidenceFiles = 0;
      entry.pdfTexts = [];
    }

    // 심층분석 플래그
    if (item.analysis && item.analysis.flags && item.analysis.flags.length > 0) {
      entry.flags = item.analysis.flags.map(f => {
        if (typeof f === 'string') return f;
        return f.id || f.description || JSON.stringify(f);
      });
    }

    return entry;
  });

  return `당신은 정부 보조금 정산검토 전문가입니다.
${institution ? `${institution}의 ` : ''}"${project || '사업'}" 집행내역을 검토합니다.

## 판정 기준
${criteria}

## 페이퍼정산 특이사항
- 이 데이터는 웹 시스템이 아닌 기관이 직접 제출한 엑셀 + PDF 기반 자료입니다.
- evidenceType이 없습니다. 증빙 유형은 PDF 내용으로 판단하세요.
- 각 항목의 pdfTexts에 증빙 PDF 텍스트가 포함되어 있습니다.
- flags는 자동분석 엔진의 사전 검토 결과입니다. 참고하되, 최종 판단은 직접 하세요.

## 판정 원칙
1. **적정**: 증빙서류가 충분하고, 금액이 확인되며, 기준에 부합
2. **확인**: 증빙 불충분, 금액 불일치, 기준 초과, 서류 미비 등
3. **SKIP**: 0원(취소전표) 등 검토 불필요

## 데이터 (${dataForPrompt.length}건)
${JSON.stringify(dataForPrompt, null, 2)}

## 출력 형식
순수 JSON 배열만 출력하세요. 마크다운 코드블록이나 설명 없이 순수 JSON만.
[
  {"rowNum":1, "status":"적정", "issues":[], "confidence":"high", "reasoning":"세금계산서 금액 확인"},
  {"rowNum":2, "status":"확인", "issues":["회의록 미첨부"], "confidence":"medium", "reasoning":"회의비 지출이나 회의록 없음"}
]

status는 반드시 "적정", "확인", "SKIP" 중 하나.
모든 ${dataForPrompt.length}건에 대해 빠짐없이 판정하세요.`;
}

// ── JSON 추출 (parse-results.js의 extractJSON 로직) ──

function extractJSON(text) {
  // 1) 직접 파싱 시도
  try {
    const parsed = JSON.parse(text);
    if (Array.isArray(parsed)) return parsed;
  } catch {}

  // 2) 마크다운 코드블록 제거 후 파싱
  const jsonBlock = text.match(/```(?:json)?\s*(\[\s*\{[\s\S]*\}\s*\])\s*```/);
  if (jsonBlock) {
    try {
      return JSON.parse(jsonBlock[1]);
    } catch {}
  }

  // 3) 대괄호([])로 감싸진 가장 긴 문자열 찾기 (가장 강력한 방법)
  const start = text.indexOf('[');
  const end = text.lastIndexOf(']');
  if (start !== -1 && end !== -1 && end > start) {
    const potentialJson = text.substring(start, end + 1);
    try {
      return JSON.parse(potentialJson);
    } catch (e) {
      // JSON 내부에 에러가 있는 경우 (Trailing comma 등)
      // 여기서는 간단히 실패 처리하지만, 필요하면 cleaning 로직 추가 가능
      console.warn('  [extractJSON] 부분 JSON 파싱 실패, Cleaning 시도...');
      try {
          // Trailing comma 제거 등 간단한 정제
          const cleaned = potentialJson.replace(/,\s*([\]}])/g, '$1');
          return JSON.parse(cleaned);
      } catch {}
    }
  }

  return null;
}

function normalizeResult(item) {
  return {
    rowNum: item.rowNum || item.row_num || item.row,
    status: item.status || item.judgment || item.result || '확인',
    issues: Array.isArray(item.issues) ? item.issues :
            Array.isArray(item.reasons) ? item.reasons :
            item.reason ? [item.reason] : [],
    confidence: item.confidence || 'medium',
    reasoning: item.reasoning || '',
  };
}

// ── Gemini CLI 호출 ──

function callGemini(promptFile, rawFile) {
  try {
    execSync(
      `cat "${promptFile}" | gemini -p "" -m ${GEMINI_MODEL} > "${rawFile}" 2>&1`,
      { timeout: GEMINI_TIMEOUT, maxBuffer: 100 * 1024 * 1024, shell: '/bin/bash' }
    );
    return true;
  } catch (e) {
    console.error(`  [Gemini 오류] ${e.message}`);
    return false;
  }
}

// ── 메인 판정 함수 ──

async function judgePaper(enrichedData, options = {}) {
  const {
    criteriaPath,
    project = '',
    institution = '',
    outDir = '.',
    batchSize = DEFAULT_BATCH_SIZE,
  } = options;

  // criteria 읽기
  let criteria = '';
  if (criteriaPath && fs.existsSync(criteriaPath)) {
    criteria = fs.readFileSync(criteriaPath, 'utf-8');
  } else {
    console.warn('  [경고] criteria 파일 없음 — 기본 원칙으로 판정');
    criteria = '공통 정산검토 원칙에 따라 판정하세요. 증빙서류 확인, 금액 대조, 비목별 한도 검토.';
  }

  fs.mkdirSync(outDir, { recursive: true });

  // 배치 분할
  const batches = [];
  for (let i = 0; i < enrichedData.length; i += batchSize) {
    batches.push(enrichedData.slice(i, i + batchSize));
  }

  console.log(`  [Gemini 판정] ${enrichedData.length}건, ${batches.length}배치 (배치당 최대 ${batchSize}건)`);

  const allResults = [];

  for (let b = 0; b < batches.length; b++) {
    const batch = batches[b];
    const batchLabel = batches.length > 1 ? `-batch${b + 1}` : '';

    // 프롬프트 생성
    const prompt = buildPrompt(batch, criteria, { project, institution });
    const promptFile = path.join(outDir, `gemini-prompt${batchLabel}.txt`);
    const rawFile = path.join(outDir, `gemini-raw${batchLabel}.txt`);
    fs.writeFileSync(promptFile, prompt, 'utf-8');

    const promptSize = (Buffer.byteLength(prompt) / 1024).toFixed(0);
    console.log(`  [배치 ${b + 1}/${batches.length}] ${batch.length}건, 프롬프트 ${promptSize}KB`);

    // Gemini 호출
    const t0 = Date.now();
    const ok = callGemini(promptFile, rawFile);
    const elapsed = ((Date.now() - t0) / 1000).toFixed(1);

    if (!ok || !fs.existsSync(rawFile)) {
      console.error(`  [배치 ${b + 1}] Gemini 호출 실패 (${elapsed}s)`);
      // 실패한 건은 모두 '확인'으로 처리
      for (const item of batch) {
        allResults.push({ rowNum: item.rowNum, status: '확인', issues: ['Gemini 호출 실패'], confidence: 'low', reasoning: '' });
      }
      continue;
    }

    const rawText = fs.readFileSync(rawFile, 'utf-8');
    console.log(`  [배치 ${b + 1}] Gemini 응답 ${(rawText.length / 1024).toFixed(0)}KB (${elapsed}s)`);

    // 파싱
    const parsed = extractJSON(rawText);
    if (!parsed) {
      console.error(`  [배치 ${b + 1}] JSON 파싱 실패`);
      for (const item of batch) {
        allResults.push({ rowNum: item.rowNum, status: '확인', issues: ['응답 파싱 실패'], confidence: 'low', reasoning: '' });
      }
      continue;
    }

    const normalized = parsed.map(normalizeResult);
    allResults.push(...normalized);
    console.log(`  [배치 ${b + 1}] ${normalized.length}건 파싱 완료 (적정: ${normalized.filter(r => r.status === '적정').length}, 확인: ${normalized.filter(r => r.status === '확인').length})`);
  }

  // 누락 건 체크
  const resultRowNums = new Set(allResults.map(r => r.rowNum));
  for (const item of enrichedData) {
    if (!resultRowNums.has(item.rowNum)) {
      console.warn(`  [경고] R${item.rowNum} 판정 누락 — '확인'으로 처리`);
      allResults.push({ rowNum: item.rowNum, status: '확인', issues: ['판정 누락'], confidence: 'low', reasoning: '' });
    }
  }

  // 결과 저장
  const resultsFile = path.join(outDir, 'results.json');
  fs.writeFileSync(resultsFile, JSON.stringify(allResults, null, 2), 'utf-8');
  console.log(`  [저장] ${resultsFile} (${allResults.length}건)`);

  return allResults;
}

module.exports = { judgePaper, buildPrompt, extractJSON, normalizeResult };

// ── CLI ──
if (require.main === module) {
  const args = Object.fromEntries(
    process.argv.slice(2).filter(a => a.startsWith('--')).map(a => {
      const [k, ...v] = a.slice(2).split('=');
      return [k, v.length ? v.join('=') : true];
    })
  );

  const dataFile = args.data;
  const criteriaPath = args.criteria;
  const outDir = args.out || '.';
  const batchSize = parseInt(args['batch-size']) || DEFAULT_BATCH_SIZE;
  const project = args.project || '';
  const institution = args.institution || '';

  if (!dataFile) {
    console.log('사용법: node paper/gemini-judge-paper.js --data=data-enriched.json --criteria=criteria.md [--out=outdir] [--batch-size=150]');
    process.exit(1);
  }

  const data = JSON.parse(fs.readFileSync(dataFile, 'utf-8'));
  judgePaper(data, { criteriaPath, project, institution, outDir, batchSize }).catch(console.error);
}
