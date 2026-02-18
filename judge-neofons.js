/**
 * 네오폰스 51건 정산검토 - 자동 판정
 *
 * 검토 기준:
 *  1) common/common-rules.md (보조금법, 국고보조금지침, 정산보고서지침, 국가계약법시행령)
 *  2) projects/digital-healthcare/guideline.md (디지털헬스케어 운영세칙)
 */
const fs = require('fs');
const data = require('./neofons-data.json');

// ── 네오폰스 참여인력 (4대보험 산출내역에서 확인) ──
const STAFF = [
  '강혜지','구하연','권성은','김규희','김민경','김민지','김예지','김은혜',
  '문범수','박한빈','황수민','황은혜','이지호','박기수','유재형','김아림',
  '이호수','곽소영'
];

// ── 주류 키워드 ──
// 주류키워드: 1글자('럼')은 OCR 오탐 빈발하므로 제외
const ALCOHOL = ['맥주','소주','와인','위스키','사케','주류','막걸리','하이볼',
  '칵테일','보드카','데킬라','생맥주','병맥주','beer','wine','soju',
  '참이슬','처음처럼','진로','카스맥주','하이트맥주','테라맥주'];

// ── 유틸 함수 ──
function hasFileByName(files, ...keywords) {
  return files.some(f => {
    const n = f.name.toLowerCase();
    return keywords.some(kw => n.includes(kw.toLowerCase()));
  });
}
function hasFileByContent(files, ...keywords) {
  return files.some(f => {
    const t = (f.text || '').toLowerCase();
    return keywords.some(kw => t.includes(kw.toLowerCase()));
  });
}
function getTexts(files) {
  return files.map(f => f.text || '').join('\n');
}

function extractParticipants(text) {
  // "참석자: 15명" / "15명(" / "참석인원: 10명"
  const patterns = [
    /참석자[:\s]*(\d+)\s*명/,
    /참석인원[:\s]*(\d+)\s*명/,
    /(\d+)\s*명\s*\(/,
  ];
  for (const p of patterns) {
    const m = text.match(p);
    if (m) return parseInt(m[1]);
  }
  // 회의록 서명 인원 세기 - 이름 패턴 카운트 (fallback)
  return 0;
}

function extractConsultHours(text) {
  // "14~16시" → 2, "10:00~12:30" → 2.5
  const m1 = text.match(/(\d{1,2})\s*[~\-–]\s*(\d{1,2})\s*시/);
  if (m1) return parseInt(m1[2]) - parseInt(m1[1]);
  const m2 = text.match(/(\d{1,2}):(\d{2})\s*[~\-–]\s*(\d{1,2}):(\d{2})/);
  if (m2) return (parseInt(m2[3]) * 60 + parseInt(m2[4]) - parseInt(m2[1]) * 60 - parseInt(m2[2])) / 60;
  return 0;
}

function hasAlcohol(text) {
  const lower = text.toLowerCase();
  return ALCOHOL.some(kw => lower.includes(kw));
}

function grossFromNet(net) {
  // 3.3% 원천징수 (소득세 3% + 주민세 0.3%)
  return Math.round(net / 0.967);
}

// ── 유형 분류 ──
function classify(rec) {
  const p = rec.purpose;
  if (/회의비/.test(p)) return '회의비';
  if (/자문료|자문수당/.test(p)) return '자문료';
  if (/사례금|임상.*참여자/.test(p)) return '임상사례금';
  if (/출장.*여비|출장.*교통비|국내.*출장|기차표/.test(p)) return '여비';
  if (/인건비|기관부담금/.test(p)) return '인건비';
  if (/장비임차|임차/.test(p)) return '임차';
  if (/cro|용역비/.test(p.toLowerCase())) return '용역';
  if (/사무용품/.test(p)) return '사무용품';
  if (/수수료|정산/.test(p)) return '수수료';
  // fallback: 세목 기반
  if (rec.subCategory === '국내여비') return '여비';
  if (rec.subCategory === '일용임금') return '인건비';
  if (rec.subCategory === '임차료') return '임차';
  if (rec.subCategory === '일반용역비') return '용역';
  return '기타';
}

// ── 판정 로직 ──
function judge(rec) {
  const type = classify(rec);
  const issues = [];   // 확인 사유
  const ok = [];       // 적정 확인 항목
  const allText = getTexts(rec.files);

  switch (type) {

  // ═══════════ 회의비 ═══════════
  case '회의비': {
    // 1) 내부결재
    if (hasFileByName(rec.files, '내부결재', '결재')) ok.push('내부결재문서 ✓');
    else issues.push('내부결재문서 미첨부');

    // 2) 회의록
    if (hasFileByName(rec.files, '회의록')) ok.push('회의록 ✓');
    else issues.push('회의록 미첨부 → 불인정 대상');

    // 3) 영수증
    if (hasFileByName(rec.files, '영수증') || rec.evidenceType === '보조금전용카드')
      ok.push('영수증/카드전표 ✓');

    // 4) 1인당 5만원
    const cnt = extractParticipants(allText);
    if (cnt > 0) {
      const pp = Math.round(rec.totalAmount / cnt);
      if (pp > 50000) issues.push(`1인당 ${pp.toLocaleString()}원 (${cnt}명) → 5만원 한도 초과`);
      else ok.push(`1인당 ${pp.toLocaleString()}원 (${cnt}명) ✓`);
    } else {
      issues.push('참석인원수 확인 필요 (OCR 인원 미파악)');
    }

    // 5) 주류
    if (hasAlcohol(allText)) issues.push('주류 포함 의심');

    // 6) 외부참석자 존재 여부 (단일기관 회의비 불인정)
    if (allText.includes('칠곡경북대') || allText.includes('대구대학교') ||
        allText.includes('프라임요양병원') || allText.includes('첨복재단') ||
        allText.includes('첨단의료') || allText.includes('대구의료원') ||
        allText.includes('외부참석자') ||
        allText.includes('외부') || /교수|병원|대학|재단|의료원/.test(allText)) {
      ok.push('외부참석자 확인 ✓');
    } else {
      issues.push('외부참석자(과제 미참여인력) 확인 필요');
    }

    // 7) 보조금전용카드
    if (rec.evidenceType === '보조금전용카드') ok.push('보조금전용카드 ✓');
    break;
  }

  // ═══════════ 자문료 ═══════════
  case '자문료': {
    // 1) 자문의견서
    if (hasFileByName(rec.files, '자문의견서')) ok.push('자문의견서 ✓');
    else issues.push('자문의견서 미첨부');

    // 2) 자문확인서
    if (hasFileByName(rec.files, '자문확인서', '확인서')) ok.push('자문확인서 ✓');
    else issues.push('자문확인서 미첨부');

    // 3) 참여인력 중복 체크
    const consultant = rec.vendorName;
    if (STAFF.includes(consultant)) {
      issues.push(`자문위원 ${consultant} = 사업 참여인력 → 자문비 불인정`);
    } else {
      ok.push(`외부전문가(${consultant}) ✓`);
    }

    // 4) 이력카드
    if (hasFileByName(rec.files, '이력')) ok.push('이력서/이력카드 ✓');

    // 5) 신분증
    if (hasFileByName(rec.files, '신분증')) ok.push('신분증 ✓');

    // 6) 통장사본
    if (hasFileByName(rec.files, '통장')) ok.push('통장사본 ✓');

    // 7) 단가 기준 확인
    const hours = extractConsultHours(allText);
    const gross = grossFromNet(rec.totalAmount);
    let allowed = 0;
    if (hours > 0 && hours <= 2) allowed = 200000;
    else if (hours > 2 && hours <= 3) allowed = 300000;
    else if (hours > 3) allowed = Math.min(400000 + Math.floor(hours - 3) * 200000, 600000);

    if (hours > 0 && allowed > 0) {
      if (gross > allowed) {
        const excess = gross - allowed;
        issues.push(`자문 ${hours}시간 → 한도 ${allowed.toLocaleString()}원, 세전추정 ${gross.toLocaleString()}원 (${excess.toLocaleString()}원 초과)`);
      } else {
        ok.push(`자문 ${hours}시간, 세전 ${gross.toLocaleString()}원 ≤ ${allowed.toLocaleString()}원 ✓`);
      }
    } else {
      ok.push(`세전추정 ${gross.toLocaleString()}원 (자문시간 확인 필요)`);
    }
    break;
  }

  // ═══════════ 임상사례금 ═══════════
  case '임상사례금': {
    // 1) 증례기록지
    if (hasFileByName(rec.files, '증례기록') || hasFileByContent(rec.files, '증례 기록서', 'CRF', '증례기록'))
      ok.push('증례기록지 ✓');
    else issues.push('증례기록지 미첨부');

    // 2) 수납영수증 (진료비)
    if (hasFileByName(rec.files, '수납영수증', '영수증') || hasFileByContent(rec.files, '진료비 계산서', '수납영수증'))
      ok.push('수납영수증 ✓');
    else issues.push('수납영수증(진료비) 미첨부');

    // 3) 보호자 신분증
    if (hasFileByName(rec.files, '신분증')) ok.push('보호자 신분증 ✓');
    else issues.push('보호자 신분증 미첨부');

    // 4) 통장사본
    if (hasFileByName(rec.files, '통장')) ok.push('통장사본 ✓');
    else issues.push('보호자 통장사본 미첨부');

    // 5) 동의서 확인 (보호자설명서 및 서면동의서)
    if (hasFileByContent(rec.files, '보호자설명서', '서면동의서', '동의서'))
      ok.push('서면동의서 포함 ✓');

    break;
  }

  // ═══════════ 여비 ═══════════
  case '여비': {
    const isSubItem = /교통비|기차표/.test(rec.purpose);

    // 1) 내부결재
    if (hasFileByName(rec.files, '내부결재', '결재')) ok.push('내부결재 ✓');

    // 2) 출장계획서
    if (hasFileByName(rec.files, '출장계획')) ok.push('출장계획서 ✓');
    else if (!isSubItem) issues.push('출장계획서 미첨부');

    // 3) 출장복명서/결과보고서
    if (hasFileByName(rec.files, '출장결과', '복명서', '결과보고')) ok.push('출장복명서 ✓');
    else if (!isSubItem) issues.push('출장복명서(결과보고서) 미첨부');

    // 4) 교통비 증빙
    if (hasFileByName(rec.files, '기차표', '교통') || hasFileByContent(rec.files, '기차', '열차'))
      ok.push('교통비 증빙 ✓');
    if (hasFileByName(rec.files, '영수증') || hasFileByName(rec.files, '현지영수증'))
      ok.push('현지영수증 ✓');

    // 5) 여비지급 세칙
    if (hasFileByContent(rec.files, '연구관리규정', '시행세칙', '여비 정액표'))
      ok.push('여비지급 규정 첨부 ✓');

    // 6) 보조금전용카드 (기차표 등)
    if (rec.evidenceType === '보조금전용카드') ok.push('보조금전용카드 ✓');

    // 교통비/기차표는 본체 출장 건에 대응
    if (isSubItem) ok.push('교통비 부속건 → 본 출장 건에서 서류 확인');

    break;
  }

  // ═══════════ 인건비 ═══════════
  case '인건비': {
    if (/기관부담금/.test(rec.purpose)) {
      // 4대보험 기관부담금
      const has4 = hasFileByName(rec.files, '건강보험','고용보험','산재보험','연금보험','4대보험');
      if (has4) {
        ok.push('4대보험 산출내역 ✓');
        // 대상자 이름 확인
        if (allText.includes('황은혜')) ok.push('대상자 황은혜 확인 ✓');
      } else {
        issues.push('4대보험 산출내역 미첨부');
      }
      // 기관부담금 금액 정합성은 수동 확인 필요
      ok.push('기관부담금 산출근거 → 수동 크로스체크 권장');
    } else {
      // 인건비 지급 - evidenceSub에 '소득 지급명세서'가 있으면 OK (OCR 실패해도)
      if (hasFileByContent(rec.files, '지급명세') || hasFileByName(rec.files, '지급명세','급여') ||
          (rec.evidenceSub || '').includes('지급명세')) {
        ok.push('소득지급명세서 ✓');
      } else {
        issues.push('소득지급명세서 미첨부');
      }
      // 근로계약서는 별도 확인 필요
      ok.push('근로계약서/참여율 → 별도 확인 필요');
    }
    break;
  }

  // ═══════════ 임차 ═══════════
  case '임차': {
    // 1) 계약서
    if (hasFileByName(rec.files, '계약서')) ok.push('계약서 ✓');
    else issues.push('계약서 미첨부');

    // 2) 검수조서
    if (hasFileByName(rec.files, '검수조서', '검수')) ok.push('검수조서 ✓');
    else issues.push('검수조서 미첨부');

    // 3) 견적서 (수의계약: 2개 이상)
    const quotes = rec.files.filter(f => /견적/.test(f.name) && !/비교견적/.test(f.name));
    if (quotes.length >= 2) ok.push(`견적서 ${quotes.length}개 ✓`);
    else if (quotes.length === 1 && rec.totalAmount <= 20000000)
      ok.push('견적서 1개 (2천만원 이하 → 1인견적 가능)');
    else issues.push(`견적서 ${quotes.length}개 (2개 이상 권장)`);

    // 4) 비교견적
    if (hasFileByName(rec.files, '비교견적')) ok.push('비교견적서 ✓');

    // 5) 세금계산서
    if (hasFileByName(rec.files, '세금계산서') || hasFileByContent(rec.files, '전자세금계산서'))
      ok.push('세금계산서 ✓');

    // 6) ★ 범용성 장비 확인 ★
    if (/노트북|laptop|pc|컴퓨터|그램|gram/i.test(allText)) {
      issues.push('★ 범용성 장비(노트북/PC) 대여 → 지침 불인정 항목 해당 (지침 별표2 3.4항 "범용성 장비 구입 또는 대여")');
    }
    break;
  }

  // ═══════════ 용역 ═══════════
  case '용역': {
    // 1) 계약서
    if (hasFileByName(rec.files, '계약서')) ok.push('계약서 ✓');
    else issues.push('계약서 미첨부');

    // 2) 견적서 (수의계약 2개 이상) - "비교견적 검토서"만 제외, "비교견적1/2"는 실제 견적서
    const quotes = rec.files.filter(f => /견적/.test(f.name) && !/비교견적\s*검토/.test(f.name));
    if (quotes.length >= 2) ok.push(`견적서 ${quotes.length}개 ✓`);
    else issues.push(`견적서 ${quotes.length}개 (수의계약 시 2개 이상 필요)`);

    // 3) 비교견적 검토서
    if (rec.files.some(f => /비교견적\s*검토/.test(f.name))) ok.push('비교견적검토서 ✓');

    // 4) 결과보고서
    if (hasFileByName(rec.files, '결과보고서') || hasFileByContent(rec.files, '용역 결과 보고서'))
      ok.push('결과보고서 ✓');
    else issues.push('용역 결과보고서 미첨부');

    // 5) 세금계산서
    if (hasFileByName(rec.files, '세금계산서') || hasFileByContent(rec.files, '전자세금계산서'))
      ok.push('세금계산서 ✓');
    else issues.push('세금계산서 미첨부');

    // 6) 내부결재 (업체 선정)
    if (hasFileByName(rec.files, '내부결재')) ok.push('내부결재(업체선정) ✓');

    // 7) 2천만원 경쟁입찰 여부
    const supply = rec.supplyAmount || rec.totalAmount;
    if (supply > 20000000) {
      issues.push(`공급가액 ${supply.toLocaleString()}원 > 2천만원 → 경쟁입찰 필요 (수의계약 가능 여부 확인)`);
    } else {
      ok.push(`공급가액 ${supply.toLocaleString()}원 ≤ 2천만원 → 수의계약 적정 ✓`);
    }

    // 8) 사업기간 내 계약기간 확인
    if (/계약.*기간/.test(allText) || /계약일/.test(allText))
      ok.push('계약기간 명시 확인 (사업기간 내 여부 수동확인 권장)');

    break;
  }

  // ═══════════ 사무용품 ═══════════
  case '사무용품': {
    // 1) 내부결재
    if (hasFileByName(rec.files, '내부결재')) ok.push('내부결재 ✓');

    // 2) 견적서
    if (hasFileByName(rec.files, '견적서', '견적')) ok.push('견적서 ✓');

    // 3) 세금계산서
    if (hasFileByName(rec.files, '세금계산서') || hasFileByContent(rec.files, '전자세금계산서'))
      ok.push('세금계산서 ✓');
    else issues.push('세금계산서 미첨부');

    // 4) 검수조서
    if (hasFileByName(rec.files, '검수조서', '검수')) ok.push('검수조서 ✓');

    // 5) 거래명세서
    if (hasFileByName(rec.files, '거래명세서')) ok.push('거래명세서 ✓');

    // 6) 범용성 확인 → 소모품(복사용지, 토너)은 OK
    ok.push('사무용 소모품(복사용지, 토너 등) → 일반수용비 적정');

    break;
  }

  // ═══════════ 수수료 ═══════════
  case '수수료': {
    if (hasFileByContent(rec.files, '세금계산서') || hasFileByName(rec.files, '세금계산서'))
      ok.push('세금계산서/가상계좌 ✓');
    if (hasFileByName(rec.files, '사업자등록증')) ok.push('사업자등록증 ✓');
    ok.push('회계검사수수료 → 일반수용비(수수료) 적정');
    break;
  }

  default:
    issues.push('분류 불가 → 수동 확인 필요');
  }

  // ═══════════ 공통: 부가세 포함 집행 체크 (영리법인 → 매입세액공제 가능) ═══════════
  if (rec.vat > 0 && rec.totalAmount === rec.supplyAmount + rec.vat) {
    issues.push(`부가세 ${rec.vat.toLocaleString()}원 포함 집행 → 영리법인 매입세액공제 가능분 불인정`);
  }

  const status = issues.length === 0 ? '적정' : '확인';
  return { type, status, issues, ok };
}


// ═══════════════════════════════════════════════════
//  메인 실행
// ═══════════════════════════════════════════════════
const results = [];
for (const rec of data) {
  const r = judge(rec);
  results.push({
    rowNum: rec.rowNum,
    type: r.type,
    purpose: rec.purpose,
    amount: rec.totalAmount,
    vendor: rec.vendorName,
    status: r.status,
    issues: r.issues,
    ok: r.ok,
  });
}

const okCnt = results.filter(r => r.status === '적정').length;
const chkCnt = results.filter(r => r.status === '확인').length;

console.log('╔══════════════════════════════════════════════════╗');
console.log('║   네오폰스 51건 정산검토 결과                    ║');
console.log('╠══════════════════════════════════════════════════╣');
console.log(`║   적정: ${okCnt}건  |  확인: ${chkCnt}건               ║`);
console.log('╚══════════════════════════════════════════════════╝\n');

// ── 확인 필요 건 ──
console.log('━━━━ 확인 필요 건 ━━━━\n');
for (const r of results.filter(x => x.status === '확인')) {
  console.log(`R${r.rowNum} [${r.type}] ${r.purpose} | ${r.amount.toLocaleString()}원 | ${r.vendor}`);
  for (const i of r.issues) console.log(`  ⚠ ${i}`);
  for (const o of r.ok)     console.log(`  ✓ ${o}`);
  console.log('');
}

// ── 적정 건 ──
console.log('\n━━━━ 적정 건 ━━━━\n');
for (const r of results.filter(x => x.status === '적정')) {
  console.log(`R${r.rowNum} [${r.type}] ${r.purpose} | ${r.amount.toLocaleString()}원`);
  for (const o of r.ok) console.log(`  ✓ ${o}`);
  console.log('');
}

// ── 유형별 요약 ──
console.log('\n━━━━ 유형별 요약 ━━━━\n');
const byType = {};
for (const r of results) {
  if (!byType[r.type]) byType[r.type] = { ok: 0, check: 0, total: 0, amount: 0 };
  byType[r.type].total++;
  byType[r.type].amount += r.amount;
  if (r.status === '적정') byType[r.type].ok++;
  else byType[r.type].check++;
}
for (const [t, v] of Object.entries(byType).sort((a, b) => b[1].total - a[1].total)) {
  console.log(`${t}: ${v.total}건 (적정${v.ok}/확인${v.check}) | ${v.amount.toLocaleString()}원`);
}

// ── 주요 이슈 요약 ──
console.log('\n━━━━ 주요 이슈 요약 ━━━━\n');
const issueMap = {};
for (const r of results) {
  for (const i of r.issues) {
    const key = i.replace(/\d[\d,.]+/g, 'N').replace(/\(.*?\)/g, '');
    if (!issueMap[key]) issueMap[key] = [];
    issueMap[key].push('R' + r.rowNum);
  }
}
for (const [issue, rows] of Object.entries(issueMap)) {
  console.log(`• ${issue}`);
  console.log(`  → ${rows.join(', ')} (${rows.length}건)`);
}

// ── JSON 저장 ──
fs.writeFileSync('/mnt/c/projects/e-naradomum-rpa/neofons-results.json',
  JSON.stringify(results, null, 2), 'utf-8');
console.log('\n결과 저장: neofons-results.json');
