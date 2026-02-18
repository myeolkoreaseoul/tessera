#!/usr/bin/env node
/**
 * 캠퍼스타운-고려대 집행내역 자동 판정
 * criteria-v3.md 기준 적용 → results.json 생성
 */
const fs = require('fs');
const path = require('path');

const DATA = path.join(__dirname, 'data.json');
const OUTPUT = path.join(__dirname, 'results.json');

const data = JSON.parse(fs.readFileSync(DATA, 'utf-8'));

// ── 금액 파싱 (콤마 제거) ──
function parseAmt(s) {
  if (!s) return 0;
  return Number(String(s).replace(/,/g, '')) || 0;
}

// ── 보조세목 → 비목 카테고리 매핑 ──
function mapCategory(atitNm, purpose) {
  const p = (purpose || '').toLowerCase();

  // 보조세목 기반 1차 매핑
  if (atitNm === '국내여비') return { code: '5-4', name: '여비' };
  if (atitNm === '포상금') return { code: '3-2', name: '창업시상금' };
  if (atitNm === '기간제근로자등보수') return { code: '4-2', name: '프로그램기획비(전담인력인건비)' };
  if (atitNm === '시험연구비') return { code: '2-10', name: '교육·연구 프로그램 개발·운영비' };

  // 보수 → 사업단장수당 vs 프로그램기획비
  if (atitNm === '보수') {
    if (p.includes('사업단장') || p.includes('보직') || p.includes('겸직'))
      return { code: '4-1', name: '사업단장 보직/겸직수당' };
    return { code: '4-2', name: '프로그램기획비(전담인력인건비)' };
  }

  // 공공운영비 → 세부 분류
  if (atitNm === '공공운영비') {
    if (p.includes('임차') && !p.includes('물품') && !p.includes('장비'))
      return { code: '5-1', name: '공간임차료' };
    return { code: '5-2', name: '공간운영비' };
  }

  // 사무관리비 → 세부 분류 (집행목적 키워드 기반)
  if (atitNm === '사무관리비') {
    if (p.includes('강사') || p.includes('강의'))
      return { code: '2-1', name: '강사비' };
    if (p.includes('심사') || p.includes('평가'))
      return { code: '2-2', name: '심사및평가비' };
    if (p.includes('멘토'))
      return { code: '2-3', name: '멘토비' };
    if (p.includes('회의') || p.includes('자문'))
      return { code: '2-4', name: '회의비및자문비' };
    if (p.includes('단순인건비') || p.includes('일용'))
      return { code: '2-5', name: '단순인건비' };
    if (p.includes('용역'))
      return { code: '2-6', name: '프로그램용역비' };
    if (p.includes('임차'))
      return { code: '2-7', name: '단기임차료' };
    if (p.includes('행사') || p.includes('현수막') || p.includes('포스터') || p.includes('설치') || p.includes('해체'))
      return { code: '2-8', name: '행사비' };
    if (p.includes('식비') || p.includes('다과') || p.includes('식사') || p.includes('케이터링') || p.includes('도시락'))
      return { code: '2-9', name: '식비및다과비' };
    if (p.includes('교육') || p.includes('연구') || p.includes('프로그램'))
      return { code: '2-10', name: '교육·연구 프로그램 개발·운영비' };
    if (p.includes('특근') || p.includes('야근') || p.includes('매식'))
      return { code: '5-5', name: '특근매식비' };
    if (p.includes('홍보') || p.includes('팜플릿') || p.includes('브로셔') || p.includes('리플렛'))
      return { code: '5-7', name: '홍보비' };
    if (p.includes('회계감사'))
      return { code: '5-6', name: '회계감사비' };
    if (p.includes('교육훈련'))
      return { code: '4-3', name: '교육훈련비' };
    if (p.includes('물품') || p.includes('소모품') || p.includes('사무용품') || p.includes('토너') || p.includes('복사'))
      return { code: '5-3', name: '소모성물품구입' };
    if (p.includes('창업지원') || p.includes('사업화') || p.includes('시제품'))
      return { code: '3-1', name: '창업지원금' };
    if (p.includes('우편') || p.includes('운송') || p.includes('택배'))
      return { code: '5-2', name: '공간운영비' };
    // 기본: 사무관리비 → 일반 운영비성으로 분류
    return { code: 'ETC', name: '사무관리비(세부분류필요)' };
  }

  return { code: 'UNKNOWN', name: atitNm || '(미분류)' };
}

// ── 판정 로직 ──
function judge(item) {
  const raw = item._raw || {};
  const purpose = item['집행목적 (용도)'] || '';
  const atitNm = item['보조세목(통계목)'] || '';
  const method = item['집행방식'] || '';
  const vendor = item['거래처명'] || '';
  const sibiAmt = parseAmt(item['지방비 집행금액']);
  const jabuAmt = parseAmt(item['자부담 집행금액']);
  const totalAmt = sibiAmt + jabuAmt;
  const date = item['집행실행일자'] || '';
  const rowNum = Number(item['순번']) || 0;

  const cat = mapCategory(atitNm, purpose);
  const issues = [];
  const ok = [];
  const evidence = [];

  // ── 전자세금계산서 → SKIP 후보 ──
  const isETax = method === '전자세금계산서';
  if (isETax) {
    evidence.push('전자세금계산서 자동연동');
  }

  // ── 공통 체크 ──

  // 1. 100만원 이상 비교견적서 필요 [지침 붙임6]
  if (totalAmt >= 1000000) {
    issues.push(`총액 ${totalAmt.toLocaleString()}원 ≥ 100만원: 비교견적서 첨부 확인 필요 [지침 붙임6]`);
  }

  // 2. 2천만원 초과 → 나라장터 이용 확인 [제17조]
  if (totalAmt > 20000000) {
    issues.push(`총액 ${totalAmt.toLocaleString()}원 > 2천만원: 나라장터 이용 확인 필요 [제17조]`);
  }

  // 3. 카드 사용 원칙 (인건비성 제외) [제16조②]
  const isIngeon = ['4-1', '4-2', '2-1', '2-2', '2-3', '2-4', '2-5'].includes(cat.code);
  if (!isIngeon && method === '기타') {
    issues.push('보조금결제 전용카드 또는 전자세금계산서 사용 원칙 확인 [제16조②]');
  }

  // 4. 12.31 이후 집행 → 회계연도 초과 [제16조⑤]
  if (date > '2025-12-31') {
    issues.push(`집행일 ${date}: 회계연도 말(12.31) 이후 집행 [제16조⑤]`);
  }

  // ── 비목별 세부 체크 ──
  switch (cat.code) {
    case '5-1': // 공간임차료
      if (sibiAmt > 0) {
        issues.push(`시비 ${sibiAmt.toLocaleString()}원 투입: 공간임차료는 대응자금으로만 집행 가능 [5-1]`);
      }
      ok.push('공간임차료 비목 확인');
      break;

    case '5-2': // 공간운영비
      if (purpose.includes('인테리어') || purpose.includes('interior')) {
        issues.push('인테리어 비용은 집행 불가 [제19조, 2025.7]');
      }
      if (purpose.includes('수선') || purpose.includes('수리') || purpose.includes('보수')) {
        issues.push('시설수선비: 임차시설 또는 전담조직만 입주한 시설에 집행 불가 확인 필요 [제15조⑧]');
      }
      // 공과금(수도, 전기, 가스 등)은 일반적으로 적정
      if (/수도|전기|가스|전화|인터넷|보험|우편|운송|청소/.test(purpose)) {
        ok.push(`공과금/운영비 해당 (${purpose.match(/수도|전기|가스|전화|인터넷|보험|우편|운송|청소/)?.[0]})`);
      }
      ok.push('공간운영비 비목 확인');
      break;

    case '5-3': // 소모성 물품구입
      issues.push('공간상주 인원 × 월 5만원 한도 확인 필요 [5-3]');
      ok.push('소모성 물품구입 비목 확인');
      break;

    case '5-4': // 여비
      if (purpose.includes('시외') || purpose.includes('출장') || purpose.includes('KTX') || purpose.includes('기차')) {
        issues.push('시외여비: 서울시 및 자치구 사전 승인 문서 필수 (2025.7 신설) [5-4]');
      }
      ok.push('여비 비목 확인');
      break;

    case '5-5': // 특근매식비
      if (sibiAmt > 12000) {
        issues.push('1인 12,000원 초과 여부 확인 [5-5]');
      }
      issues.push('평일 점심 불가, 출장비 중복 여부 확인 [5-5]');
      ok.push('특근매식비 비목 확인');
      break;

    case '5-6': // 회계감사비
      if (sibiAmt > 5000000) {
        issues.push(`금액 ${sibiAmt.toLocaleString()}원 > 500만원 한도 초과 [5-6]`);
      }
      ok.push('회계감사비 비목 확인');
      break;

    case '5-7': // 홍보비
      if (purpose.includes('책자') || purpose.includes('팜플릿') || purpose.includes('리플렛') || purpose.includes('브로셔')) {
        issues.push('책자형 홍보물: 배포계획서 필수 [5-7]');
      }
      if (purpose.includes('신문') || purpose.includes('방송') || purpose.includes('언론')) {
        issues.push('언론매체 홍보: 서울시 사전 협의 필요 [5-7]');
      }
      ok.push('홍보비 비목 확인');
      break;

    case '5-8': // 물품임차비
      if (sibiAmt > 60000000) {
        issues.push(`시비 ${sibiAmt.toLocaleString()}원 > 6천만원 한도 초과 [5-8]`);
      }
      issues.push('세부실행계획서 승인 여부 확인 [5-8]');
      ok.push('물품임차비 비목 확인');
      break;

    case '2-1': // 강사비
      issues.push('강의확인서(서명), 강의증빙자료 확인 필요 [2-1]');
      issues.push('서울시 인재개발원 강사료 기준 이내 확인 [2-1]');
      if (sibiAmt > 125000) {
        issues.push('기타소득 125,000원 초과: 원천징수영수증 확인 [제18조]');
      }
      ok.push('강사비 비목 확인');
      break;

    case '2-2': // 심사및평가비
      issues.push('시간당 10만원, 1일 50만원 한도 확인 [2-2]');
      issues.push('전담조직 소속 여부 확인 [2-2]');
      if (sibiAmt > 125000) {
        issues.push('기타소득 125,000원 초과: 원천징수영수증 확인 [제18조]');
      }
      ok.push('심사및평가비 비목 확인');
      break;

    case '2-3': // 멘토비
      if (sibiAmt > 300000) {
        issues.push(`1일 대면 30만원 한도 초과 가능성 (${sibiAmt.toLocaleString()}원) [2-3]`);
      }
      issues.push('멘토링내역서(서명), 동일멘토 월 200만원 한도 확인 [2-3]');
      if (sibiAmt > 125000) {
        issues.push('기타소득 125,000원 초과: 원천징수영수증 확인 [제18조]');
      }
      ok.push('멘토비 비목 확인');
      break;

    case '2-4': // 회의비및자문비
      if (sibiAmt > 200000) {
        issues.push(`대면 20만원 한도 초과 가능성 (${sibiAmt.toLocaleString()}원) [2-4]`);
      }
      issues.push('전담조직 소속 여부 확인, 회의록 확인 [2-4]');
      if (sibiAmt > 125000) {
        issues.push('기타소득 125,000원 초과: 원천징수영수증 확인 [제18조]');
      }
      ok.push('회의비/자문비 비목 확인');
      break;

    case '2-5': // 단순인건비
      issues.push('1인 8시간/일, 60시간/월 한도, 서울형 생활임금 기준 확인 [2-5]');
      if (sibiAmt > 125000) {
        issues.push('기타소득 125,000원 초과: 원천징수영수증 확인 [제18조]');
      }
      ok.push('단순인건비 비목 확인');
      break;

    case '2-6': // 프로그램용역비
      issues.push('일괄용역 불가 확인, 사업단 vs 외주 범위 구분 확인 [2-6]');
      issues.push('다른 비목(회의비, 식비 등) 중복 편성 확인 [2-6]');
      if (totalAmt >= 20000000) {
        issues.push('2천만원 이상: 나라장터 이용 필수 확인 [제17조]');
      }
      ok.push('프로그램용역비 비목 확인');
      break;

    case '2-7': // 단기임차료
      issues.push('임차 목적 및 일시 명확성 확인, 견적서 확인 [2-7]');
      ok.push('단기임차료 비목 확인');
      break;

    case '2-8': // 행사비
      issues.push('견적서(비교견적서) 확인, 행사 관련 사진 확인 [2-8]');
      ok.push('행사비 비목 확인');
      break;

    case '2-9': // 식비및다과비
      issues.push('1인당 식비 8천원, 다과비 4천원 한도 확인 [2-9]');
      issues.push('외부인 참석 여부, 연간 500만원 한도 확인 [2-9]');
      ok.push('식비/다과비 비목 확인');
      break;

    case '2-10': // 교육·연구 프로그램 개발·운영비
      issues.push('창업 인재 육성 정규 교과/비교과 프로그램 해당 여부 확인 [2-10]');
      issues.push('프로그램기획서, 참석자 서명부 확인 [2-10]');
      ok.push('교육·연구 프로그램 비목 확인');
      break;

    case '3-1': // 창업지원금
      issues.push('팀당 연간 3천만원 한도 확인 [3-1]');
      issues.push('인건비·자산취득비 해당 여부 확인 (지원불가항목) [3-1]');
      issues.push('당사자수령확인서(서명), 창업활동기록부 확인 [3-1]');
      ok.push('창업지원금 비목 확인');
      break;

    case '3-2': // 창업시상금
      if (sibiAmt > 3000000) {
        issues.push(`1팀당 3백만원 한도 초과 가능성 (${sibiAmt.toLocaleString()}원) [3-2]`);
      }
      issues.push('연간 1천만원 한도, 창업경진대회 선정 결과 확인 [3-2]');
      if (sibiAmt > 125000) {
        issues.push('기타소득 125,000원 초과: 원천징수영수증 확인 [제18조]');
      }
      ok.push('창업시상금 비목 확인');
      break;

    case '4-1': // 사업단장 보직/겸직수당
      if (sibiAmt > 1000000) {
        issues.push(`월 100만원 한도 초과 가능성 (${sibiAmt.toLocaleString()}원) [4-1]`);
      }
      issues.push('대학 내부규정 지급 근거 확인, 겸직수당 이중 수령 여부 확인 [4-1]');
      ok.push('사업단장 보직/겸직수당 비목 확인');
      break;

    case '4-2': // 프로그램기획비(전담인력인건비)
      issues.push('1인 연간 6천만원 한도, 시비 15% 이내 확인 [4-2]');
      issues.push('대학 정규직 여부 확인 (정규직 불가) [4-2]');
      issues.push('근로계약서 확인 [4-2]');
      ok.push('프로그램기획비 비목 확인');
      break;

    case '4-3': // 교육훈련비
      issues.push('사업 관련성, 연 200만원 한도, 자격증 시험 불인정 확인 [4-3]');
      ok.push('교육훈련비 비목 확인');
      break;

    default:
      if (cat.code === 'ETC' || cat.code === 'UNKNOWN') {
        issues.push(`비목 자동분류 불가: ${atitNm}, 집행목적으로 세부 확인 필요`);
      }
      break;
  }

  // ── 최종 status 결정 ──
  // 전자세금계산서 + 이슈가 금액 기반 일반이슈만 → SKIP
  // 그 외 → 확인
  let status = '확인';
  const criticalIssues = issues.filter(i =>
    i.includes('시비') && i.includes('투입') ||
    i.includes('한도 초과') ||
    i.includes('집행 불가') ||
    i.includes('회계연도') ||
    i.includes('인테리어')
  );

  if (isETax && criticalIssues.length === 0 && issues.length <= 2) {
    status = 'SKIP';
  }

  // 공과금(수도, 전기, 가스 등) + 소액 + 전자세금계산서 → SKIP
  if (isETax && /수도|전기|가스|전화|인터넷|보험료/.test(purpose) && totalAmt < 1000000) {
    status = 'SKIP';
  }

  // 이미 검토완료인 건
  if (item['검증검토 진행상태'] === '검토완료') {
    ok.push('보탬e 검토완료 상태');
  }

  return {
    rowNum,
    type: `${cat.code} ${cat.name}`,
    purpose,
    amount: totalAmt,
    sibiAmount: sibiAmt,
    jabuAmount: jabuAmt,
    vendor,
    date,
    method,
    status,
    issues,
    ok,
    evidence,
  };
}

// ── 전체 판정 실행 ──
console.log(`판정 시작: ${data.length}건`);
const results = data.map(judge);

// ── 통계 ──
const stats = { '적정': 0, '확인': 0, 'SKIP': 0 };
for (const r of results) stats[r.status] = (stats[r.status] || 0) + 1;
console.log('\n판정 결과:');
console.log(`  적정: ${stats['적정'] || 0}건`);
console.log(`  확인: ${stats['확인'] || 0}건`);
console.log(`  SKIP: ${stats['SKIP'] || 0}건`);

// 비목별 통계
const catStats = {};
for (const r of results) {
  catStats[r.type] = (catStats[r.type] || 0) + 1;
}
console.log('\n비목별 분류:');
Object.entries(catStats).sort((a, b) => b[1] - a[1]).forEach(([k, v]) => console.log(`  ${k}: ${v}건`));

// 주요 이슈 통계
const issueStats = {};
for (const r of results) {
  for (const i of r.issues) {
    const key = i.replace(/\d[\d,]+원/g, 'N원').replace(/\d{4}-\d{2}-\d{2}/g, 'DATE');
    issueStats[key] = (issueStats[key] || 0) + 1;
  }
}
console.log('\n주요 이슈 빈도 (상위 15):');
Object.entries(issueStats).sort((a, b) => b[1] - a[1]).slice(0, 15).forEach(([k, v]) => console.log(`  [${v}건] ${k}`));

// 저장
fs.writeFileSync(OUTPUT, JSON.stringify(results, null, 2), 'utf-8');
const kb = Math.round(fs.statSync(OUTPUT).size / 1024);
console.log(`\n저장: ${OUTPUT} (${kb}KB)`);
