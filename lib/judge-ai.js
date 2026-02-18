/**
 * AI 기반 정산검토 Judge
 *
 * OCR 텍스트 키워드 매칭 대신, LLM이 문서 전체를 읽고 종합 판단합니다.
 *
 * 사용법:
 *   node lib/judge-ai.js --data=biolink-data.json --name=바이오링크 [--backend=claude|gemini] [--output=results.json]
 *
 * 환경변수:
 *   ANTHROPIC_API_KEY  - Claude API (기본)
 *   GOOGLE_API_KEY     - Gemini API
 *
 * 백엔드:
 *   claude  - Claude API (claude-haiku-4-5-20251001, 빠르고 저렴)
 *   gemini  - Gemini API (gemini-2.0-flash)
 */
const fs = require('fs');
const path = require('path');

// ── 가이드라인 로드 ──
const GUIDELINES_DIR = path.join(__dirname, '..', 'guidelines');
let guidelineCache = null;

function loadGuidelines() {
  if (guidelineCache) return guidelineCache;
  const dhPath = path.join(GUIDELINES_DIR, 'digital-healthcare.md');
  guidelineCache = fs.existsSync(dhPath) ? fs.readFileSync(dhPath, 'utf-8') : '';
  return guidelineCache;
}

// ── 유형별 가이드라인 추출 ──
function getGuidelineForType(type) {
  const full = loadGuidelines();

  const sections = {
    '회의비': `## 회의비 증빙서류 및 기준
- 내부결재문서 (회의목적, 일시, 장소, 대상, 산출내역 포함)
- 회의록 (또는 회의결과보고서) 및 방명록(서명포함)
- 동일 기관 사업추진비 집행 시 과제 미참여인력 참석 필수
- 회의비 1인당 50,000원 초과 불가
- 주류 등 유흥성 경비 포함 시 불인정
- 단일 참여기관 참여인력만으로 회의비 집행 불인정
- 회의록 없이 집행 시 불인정`,

    '자문료': `## 전문가 활용비(자문료) 기준
- 필수 증빙: 자문의견서(또는 결과자료/자문확인서), 자문확인서(또는 전문가활용경비지급신청서)
- 참고 증빙: 이력서/이력카드, 신분증, 통장사본, 지급명세서
- 사업 참여인력에 지급하는 자문료 및 수당 불인정
- 단가기준: 2시간이하 20만원, 3시간이하 30만원, 3시간초과 40만원, 1일 한도 60만원
- 공직자의 경우 부정청탁법 참조`,

    '임상사례금': `## 임상사례금 기준
- 필수: 증례기록지, 수납영수증(진료비), 보호자 신분증, 통장사본
- 참고: 서면동의서/보호자설명서`,

    '여비': `## 여비 기준
- 내부결재, 출장계획서, 출장복명서(결과보고서)
- 교통비 증빙 (기차표, 영수증 등)
- 과제와 관련 없는 개인 목적 여비 불인정
- 출장복명서 없거나 출장목적 불명확 시 불인정
- 여비지급규정 초과액 불인정`,

    '인건비': `## 인건비 기준
- 인건비 지급: 소득지급명세서(또는 급여명세서) 필수
- 4대보험 기관부담금: 4대보험 산출내역서 필수
- 근로계약서, 참여율 확인
- 총 사업비(국비+지방비)의 30% 이하
- 참여연구원 이외 지원인력 급여를 인건비로 집행 시 불인정`,

    '임차': `## 임차료 기준
- 계약서, 검수조서 필수
- 수의계약 시 견적서 2개 이상
- 세금계산서
- 범용성 장비(PC, 주변기기 등) 구입 또는 대여 불인정`,

    '장소임차': `## 장소임차(대관료) 기준
- 견적서, 세금계산서(또는 보조금전용카드 결제)
- 내부결재
- 사업 목적 부합 여부 확인`,

    '용역': `## 일반용역비 기준
- 계약서 필수
- 수의계약 시 견적서 2개 이상 (국고보조금 통합관리지침 제21조)
- 결과보고서 필수
- 세금계산서 필수
- 공급가액 2천만원 초과 시 일반경쟁 원칙
- 외주용역 계약기간이 사업기간 초과 시 불인정`,

    '사무용품': `## 사무용품 기준
- 세금계산서 (보조금전용카드면 카드전표 대체 가능)
- 범용성 장비(노트북, PC 등) 구매 불인정
- 50만원 초과 시 자산취득 해당 여부 확인`,

    '수수료': `## 수수료 기준
- 세금계산서 또는 영수증
- 일반수용비 적정`,

    '재료비': `## 재료비 기준
- 세금계산서 필수
- 소모성 재료비 → 사업 관련성 확인`,
  };

  return sections[type] || `## ${type} 기준\n- 수동 확인 필요`;
}

// ── 분류 (기존 classify와 동일) ──
function classify(rec) {
  const p = (rec.purpose || '').toLowerCase();
  const sub = rec.subCategory || '';

  if (/회의비|식대|점심|저녁|식비/.test(p) && !/자문/.test(p)) return '회의비';
  if (/자문료|자문수당|자문비|전문가활용비|전문가자문|전문가활용.*지급|사용적합성.*사례비|평가사례비/.test(p)) return '자문료';
  if (/사례금|임상.*참여자|임상.*사례비/.test(p)) return '임상사례금';
  if (/출장.*여비|출장.*교통비|국내.*출장|기차표/.test(p)) return '여비';
  if (/인건비|기관부담금/.test(p)) return '인건비';
  if (/대관료|대관|장소.*임차|시설.*임차|호텔/.test(p)) return '장소임차';
  if (/장비임차|임차/.test(p)) return '임차';
  if (/cro|용역비|fda|pre-submission|edc|셋업/.test(p)) return '용역';
  if (/사무용품/.test(p)) return '사무용품';
  if (/소모성.*물품|소모성|소모품|전산비품|비품/.test(p)) return '사무용품';
  if (/수수료|정산|irb|심의비|인지세|수입인지|인쇄비|보증보험|drb|심사비/.test(p)) return '수수료';
  if (/홍보물|안내.*제작|배너|현수막|제작비/.test(p)) return '수수료';
  if (/재료비|시약|시료/.test(p)) return '재료비';
  if (/부대비용|기타부대/.test(p)) return '장소임차';
  if (sub === '국내여비') return '여비';
  if (sub === '일용임금' || sub === '상용임금') return '인건비';
  if (sub === '임차료') {
    if (/대관|호텔|장소|시설|부대/.test(p)) return '장소임차';
    return '임차';
  }
  if (sub === '일반용역비') return '용역';
  if (sub === '재료비') return '재료비';
  return '기타';
}

// ── AI 호출 프롬프트 생성 ──
function buildPrompt(rec, type, guideline) {
  const filesSection = rec.files.map((f, i) => {
    const text = (f.text || '').trim();
    return `### 첨부파일 ${i + 1}: ${f.name}\n${text ? text : '(텍스트 추출 불가)'}`;
  }).join('\n\n');

  return `당신은 정부 보조금 정산검토 전문가입니다. 아래 집행건의 첨부 증빙서류를 검토하고 판정해주세요.

## 검토 대상
- 비목 분류: ${type}
- 집행 목적: ${rec.purpose}
- 금액: ${(rec.totalAmount || 0).toLocaleString()}원 (공급가액: ${(rec.supplyAmount || 0).toLocaleString()}원, 부가세: ${(rec.vat || 0).toLocaleString()}원)
- 거래처/수취인: ${rec.vendorName || '(없음)'}
- 증빙유형: ${rec.evidenceType || '(없음)'}
- 세부증빙: ${rec.evidenceSub || '(없음)'}
- 예산 비목: ${rec.budgetCategory || ''} / ${rec.subCategory || ''}

## 첨부 파일 (OCR 텍스트)
※ OCR 특성상 글자 사이에 불필요한 공백이나 오인식이 있을 수 있습니다. 문맥을 고려하여 판단하세요.

${filesSection || '(첨부파일 없음)'}

${guideline}

## 공통 불인정 사항
- 사업기간 종료 후 집행, 증빙 미비
- 환급받을 수 있는 세금(부가세)을 집행액에 포함
- 상품권/유가증권 구매

## 판정 기준
- **"적정"**: 해당 비목의 필수 증빙서류가 첨부되어 있고, 금액/내용이 기준에 부합
- **"확인"**: 필수 증빙 미비, 금액 기준 초과, 또는 추가 확인 필요한 사항이 있는 경우

## 중요 지침
1. OCR 텍스트에서 문서 종류를 정확히 파악하세요 (제목, 서식명 등)
2. 파일명도 문서 종류 판단의 단서로 활용하세요
3. 한 파일에 여러 문서가 합본되어 있을 수 있습니다 (예: 지출결의서+세금계산서)
4. 보수적으로 판단하되, 증빙이 실질적으로 존재하면 인정하세요
5. 부가세 관련: 영리법인이 매입세액공제를 받을 수 있는 경우만 이슈로 지적

아래 JSON 형식으로만 응답하세요 (다른 텍스트 없이):
{
  "status": "적정" 또는 "확인",
  "issues": ["이슈가 있으면 기재"],
  "ok": ["확인된 증빙 항목"],
  "reasoning": "판단 근거 1-2문장"
}`;
}

// ── Claude API 호출 ──
async function callClaude(prompt, apiKey) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1024,
      messages: [{ role: 'user', content: prompt }],
    }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Claude API error ${res.status}: ${err}`);
  }
  const data = await res.json();
  return data.content[0].text;
}

// ── Gemini API 호출 ──
async function callGemini(prompt, apiKey) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.1, maxOutputTokens: 1024 },
    }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Gemini API error ${res.status}: ${err}`);
  }
  const data = await res.json();
  return data.candidates[0].content.parts[0].text;
}

// ── 응답 파싱 ──
function parseResponse(text) {
  // JSON 블록 추출
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    return { status: '확인', issues: ['AI 응답 파싱 실패'], ok: [], reasoning: text.substring(0, 200) };
  }
  try {
    const parsed = JSON.parse(jsonMatch[0]);
    return {
      status: parsed.status === '적정' ? '적정' : '확인',
      issues: Array.isArray(parsed.issues) ? parsed.issues : [],
      ok: Array.isArray(parsed.ok) ? parsed.ok : [],
      reasoning: parsed.reasoning || '',
    };
  } catch {
    return { status: '확인', issues: ['AI 응답 JSON 파싱 실패'], ok: [], reasoning: text.substring(0, 200) };
  }
}

// ── 단건 판정 ──
async function judgeOne(rec, opts = {}) {
  const { apiKey, backend = 'claude', staff = [] } = opts;
  const type = classify(rec);
  const guideline = getGuidelineForType(type);
  const prompt = buildPrompt(rec, type, guideline);

  let response;
  if (backend === 'gemini') {
    response = await callGemini(prompt, apiKey);
  } else {
    response = await callClaude(prompt, apiKey);
  }

  const result = parseResponse(response);

  // 참여인력 자문료 체크 (AI가 놓칠 수 있으므로 하드코딩)
  if (type === '자문료' && staff.length > 0) {
    const consultant = rec.vendorName;
    if (consultant && staff.includes(consultant)) {
      result.issues.push(`자문위원 ${consultant} = 사업 참여인력 → 자문비 불인정`);
      result.status = '확인';
    }
  }

  return { type, ...result };
}

// ── 배치 실행 ──
async function run(data, opts = {}) {
  const { apiKey, backend = 'claude', staff = [], institutionName = '', concurrency = 3 } = opts;
  const results = [];
  let done = 0;

  // 동시 처리 (rate limit 고려 concurrency 제한)
  const queue = [...data];
  const workers = [];

  for (let w = 0; w < concurrency; w++) {
    workers.push((async () => {
      while (queue.length > 0) {
        const rec = queue.shift();
        if (!rec) break;
        try {
          const r = await judgeOne(rec, { apiKey, backend, staff });
          results.push({
            rowNum: rec.rowNum,
            type: r.type,
            purpose: rec.purpose,
            amount: rec.totalAmount,
            vendor: rec.vendorName,
            status: r.status,
            issues: r.issues,
            ok: r.ok,
            reasoning: r.reasoning,
          });
        } catch (err) {
          console.error(`  R${rec.rowNum} 오류: ${err.message}`);
          results.push({
            rowNum: rec.rowNum,
            type: classify(rec),
            purpose: rec.purpose,
            amount: rec.totalAmount,
            vendor: rec.vendorName,
            status: '확인',
            issues: [`AI 판정 오류: ${err.message}`],
            ok: [],
          });
        }
        done++;
        if (done % 5 === 0 || done === data.length) {
          process.stdout.write(`  [${done}/${data.length}] 판정 완료\r`);
        }

        // rate limit 대응 딜레이
        await new Promise(r => setTimeout(r, backend === 'gemini' ? 500 : 300));
      }
    })());
  }

  await Promise.all(workers);
  console.log(`  [${data.length}/${data.length}] 판정 완료`);

  // rowNum 순 정렬
  results.sort((a, b) => a.rowNum - b.rowNum);
  return results;
}

// ── 결과 출력 ──
function printResults(results, institutionName) {
  const okCnt = results.filter(r => r.status === '적정').length;
  const chkCnt = results.filter(r => r.status === '확인').length;

  console.log('╔══════════════════════════════════════════════════╗');
  console.log(`║   ${institutionName} ${results.length}건 AI 정산검토 결과`);
  console.log('╠══════════════════════════════════════════════════╣');
  console.log(`║   적정: ${okCnt}건  |  확인: ${chkCnt}건`);
  console.log('╚══════════════════════════════════════════════════╝\n');

  console.log('━━━━ 확인 필요 건 ━━━━\n');
  for (const r of results.filter(x => x.status === '확인')) {
    console.log(`R${r.rowNum} [${r.type}] ${r.purpose} | ${(r.amount || 0).toLocaleString()}원 | ${r.vendor || ''}`);
    for (const i of r.issues) console.log(`  ⚠ ${i}`);
    for (const o of r.ok) console.log(`  ✓ ${o}`);
    if (r.reasoning) console.log(`  💡 ${r.reasoning}`);
    console.log('');
  }

  console.log('\n━━━━ 적정 건 ━━━━\n');
  for (const r of results.filter(x => x.status === '적정')) {
    console.log(`R${r.rowNum} [${r.type}] ${r.purpose} | ${(r.amount || 0).toLocaleString()}원`);
    for (const o of r.ok) console.log(`  ✓ ${o}`);
    console.log('');
  }

  // 유형별 요약
  console.log('\n━━━━ 유형별 요약 ━━━━\n');
  const byType = {};
  for (const r of results) {
    if (!byType[r.type]) byType[r.type] = { ok: 0, check: 0, total: 0, amount: 0 };
    byType[r.type].total++;
    byType[r.type].amount += (r.amount || 0);
    if (r.status === '적정') byType[r.type].ok++;
    else byType[r.type].check++;
  }
  for (const [t, v] of Object.entries(byType).sort((a, b) => b[1].total - a[1].total)) {
    console.log(`${t}: ${v.total}건 (적정${v.ok}/확인${v.check}) | ${v.amount.toLocaleString()}원`);
  }
}

module.exports = { classify, judgeOne, run, printResults, buildPrompt, getGuidelineForType };

// ── CLI 실행 ──
if (require.main === module) {
  const args = process.argv.slice(2);
  const getArg = (prefix) => {
    const a = args.find(x => x.startsWith(prefix));
    return a ? a.substring(prefix.length) : null;
  };

  const dataFile = getArg('--data=');
  const name = getArg('--name=') || '기관';
  const outputFile = getArg('--output=');
  const staffStr = getArg('--staff=');
  const backendArg = getArg('--backend=');

  if (!dataFile) {
    console.log('사용법: node lib/judge-ai.js --data=xxx-data.json --name=기관명 [--backend=claude|gemini] [--output=xxx-results.json] [--staff=이름1,이름2]');
    console.log('\n환경변수:');
    console.log('  ANTHROPIC_API_KEY  - Claude API');
    console.log('  GOOGLE_API_KEY     - Gemini API');
    process.exit(1);
  }

  // 백엔드 결정
  let backend = backendArg;
  let apiKey;

  if (!backend) {
    if (process.env.ANTHROPIC_API_KEY) { backend = 'claude'; apiKey = process.env.ANTHROPIC_API_KEY; }
    else if (process.env.GOOGLE_API_KEY) { backend = 'gemini'; apiKey = process.env.GOOGLE_API_KEY; }
    else {
      console.error('오류: ANTHROPIC_API_KEY 또는 GOOGLE_API_KEY 환경변수가 필요합니다.');
      console.error('  export ANTHROPIC_API_KEY=sk-ant-...');
      console.error('  export GOOGLE_API_KEY=AI...');
      process.exit(1);
    }
  } else {
    apiKey = backend === 'gemini' ? process.env.GOOGLE_API_KEY : process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      console.error(`오류: ${backend === 'gemini' ? 'GOOGLE_API_KEY' : 'ANTHROPIC_API_KEY'} 환경변수가 필요합니다.`);
      process.exit(1);
    }
  }

  const data = JSON.parse(fs.readFileSync(dataFile, 'utf-8'));
  const staff = staffStr ? staffStr.split(',') : [];

  console.log(`\n[AI Judge] ${name} ${data.length}건 (${backend})\n`);

  run(data, { apiKey, backend, staff, institutionName: name }).then(results => {
    printResults(results, name);

    const outPath = outputFile || dataFile.replace('-data.json', '-results.json');
    fs.writeFileSync(outPath, JSON.stringify(results, null, 2), 'utf-8');
    console.log(`\n결과 저장: ${outPath}`);
  }).catch(err => {
    console.error('오류:', err);
    process.exit(1);
  });
}
