/**
 * 디지털헬스케어 의료기기 실증지원 사업 - 통합 Judge
 *
 * 검토 기준:
 *  1) guidelines/common.md (보조금법, 국고보조금지침, 정산보고서지침)
 *  2) guidelines/보조금/e나라도움/KHIDI/디지털헬스케어.md (운영세칙)
 *
 * 사용법:
 *   const judge = require('./lib/judge-digital-healthcare');
 *   const results = judge.run(data, { staff: [...], institutionName: '...' });
 *
 *   또는 CLI:
 *   node lib/judge-digital-healthcare.js --data=neofons-data.json --staff='이름1,이름2' --name=네오폰스
 */
const fs = require('fs');
const path = require('path');
const {
  hasFileByName, hasFileByContent, getTexts,
  extractParticipants, extractConsultHours, hasAlcohol,
  grossFromNet, ALCOHOL,
} = require('./utils');

// ── 유형 분류 ──
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

  // fallback: 세목 기반
  if (sub === '국내여비') return '여비';
  if (sub === '일용임금' || sub === '상용임금') return '인건비';
  if (sub === '임차료') {
    // 장소/시설 임차 vs 장비 임차 구분
    if (/대관|호텔|장소|시설|부대/.test(p)) return '장소임차';
    return '임차';
  }
  if (sub === '일반용역비') return '용역';
  if (sub === '재료비') return '재료비';
  return '기타';
}

// ── 단건 판정 ──
function judge(rec, opts = {}) {
  const { staff = [] } = opts;
  const type = classify(rec);
  const issues = [];
  const ok = [];
  const allText = getTexts(rec.files);

  switch (type) {

  // ═══════════ 회의비 ═══════════
  case '회의비': {
    // 1) 내부결재 (파일명 + 내용 모두 검색)
    if (hasFileByName(rec.files, '내부결재', '결재') ||
        hasFileByContent(rec.files, '내부결재', '결재'))
      ok.push('내부결재문서 ✓');
    else issues.push('내부결재문서 미첨부');

    // 2) 회의록 (필수 - 미첨부 시 불인정, OCR 공백 대응은 hasFileByContent에서 자동 처리)
    if (hasFileByName(rec.files, '회의록') ||
        hasFileByContent(rec.files, '회의록', '회의내용', '회의 내용', '회의 목적', '회의안건', '회의일시'))
      ok.push('회의록 ✓');
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

    // 6) 외부참석자 (과제 미참여인력 필수)
    if (/외부참석자|외부인력|외부/.test(allText) ||
        /교수|병원|대학|재단|의료원/.test(allText)) {
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
    // 1) 자문의견서 (또는 강연/강의자료/발표자료/결과자료/자문내용 등 실질 결과물)
    if (hasFileByName(rec.files, '자문의견서') ||
        hasFileByName(rec.files, '강연자료', '강의자료', '발표자료', '결과자료', '자문결과', '자문내용') ||
        hasFileByContent(rec.files, '자문의견서', '자문 의견서'))
      ok.push('자문의견서/결과물 ✓');
    else issues.push('자문의견서 미첨부');

    // 2) 자문확인서 (또는 전문가 활용경비 지급 신청서 등)
    if (hasFileByName(rec.files, '자문확인서', '확인서') ||
        hasFileByName(rec.files, '활용경비', '지급 신청서', '지급신청서') ||
        hasFileByContent(rec.files, '자문확인서', '활용경비 지급 신청서', '전문가 활용경비'))
      ok.push('자문확인서/지급신청서 ✓');
    else issues.push('자문확인서 미첨부');

    // 3) 참여인력 중복 체크 (불인정)
    const consultant = rec.vendorName;
    if (staff.length > 0 && staff.includes(consultant)) {
      issues.push(`자문위원 ${consultant} = 사업 참여인력 → 자문비 불인정`);
    } else if (consultant) {
      ok.push(`외부전문가(${consultant}) ✓`);
    }

    // 4) 이력카드
    if (hasFileByName(rec.files, '이력')) ok.push('이력서/이력카드 ✓');

    // 5) 신분증
    if (hasFileByName(rec.files, '신분증')) ok.push('신분증 ✓');

    // 6) 통장사본
    if (hasFileByName(rec.files, '통장')) ok.push('통장사본 ✓');

    // 7) 지급명세서
    if (hasFileByName(rec.files, '지급명세서', '지급 명세서') ||
        hasFileByContent(rec.files, '지급명세서', '지급 명세서'))
      ok.push('지급명세서 ✓');

    // 8) 단가 기준 (2h 20만, 3h 30만, 3h+ 40만, 1일 60만)
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

    // 5) 동의서
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

    // 6) 보조금전용카드
    if (rec.evidenceType === '보조금전용카드') ok.push('보조금전용카드 ✓');

    if (isSubItem) ok.push('교통비 부속건 → 본 출장 건에서 서류 확인');
    break;
  }

  // ═══════════ 인건비 ═══════════
  case '인건비': {
    if (/기관부담금/.test(rec.purpose)) {
      // 4대보험 기관부담금
      const has4 = hasFileByName(rec.files, '건강보험','고용보험','산재보험','연금보험','4대보험');
      if (has4) ok.push('4대보험 산출내역 ✓');
      else issues.push('4대보험 산출내역 미첨부');
      ok.push('기관부담금 산출근거 → 수동 크로스체크 권장');
    } else {
      // 인건비 지급
      if (hasFileByContent(rec.files, '지급명세') || hasFileByName(rec.files, '지급명세','급여') ||
          (rec.evidenceSub || '').includes('지급명세')) {
        ok.push('소득지급명세서 ✓');
      } else {
        issues.push('소득지급명세서 미첨부');
      }
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
      issues.push('★ 범용성 장비(노트북/PC) 대여 → 지침 별표2 3.4항 "범용성 장비 구입 또는 대여" 불인정');
    }
    break;
  }

  // ═══════════ 장소임차 (대관료/호텔/시설 임대) ═══════════
  case '장소임차': {
    // 1) 견적서
    const quotes = rec.files.filter(f => /견적/.test(f.name));
    if (quotes.length >= 1) ok.push(`견적서 ${quotes.length}개 ✓`);
    else issues.push('견적서 미첨부');

    // 2) 세금계산서
    if (hasFileByName(rec.files, '세금계산서') || hasFileByContent(rec.files, '전자세금계산서'))
      ok.push('세금계산서 ✓');
    else if (rec.evidenceType === '보조금전용카드')
      ok.push('보조금전용카드 결제 ✓');
    else issues.push('세금계산서 미첨부');

    // 3) 내부결재
    if (hasFileByName(rec.files, '내부결재', '결재')) ok.push('내부결재 ✓');

    // 4) 사업 목적 부합 (학회, 워크숍, 행사 등)
    if (/학회|워크숍|심포지엄|세미나|행사|교육/.test(allText + rec.purpose))
      ok.push('사업목적 관련 행사 ✓');
    else
      issues.push('장소 대관 사업목적 부합 여부 확인 필요');

    break;
  }

  // ═══════════ 용역 ═══════════
  case '용역': {
    // 1) 계약서
    if (hasFileByName(rec.files, '계약서')) ok.push('계약서 ✓');
    else issues.push('계약서 미첨부');

    // 2) 견적서 ("비교견적 검토서"만 제외)
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

    // 6) 내부결재
    if (hasFileByName(rec.files, '내부결재')) ok.push('내부결재(업체선정) ✓');

    // 7) 2천만원 경쟁입찰
    const supply = rec.supplyAmount || rec.totalAmount;
    if (supply > 20000000) {
      issues.push(`공급가액 ${supply.toLocaleString()}원 > 2천만원 → 경쟁입찰 필요 확인`);
    } else {
      ok.push(`공급가액 ${supply.toLocaleString()}원 ≤ 2천만원 → 수의계약 적정 ✓`);
    }

    // 8) 계약기간 확인
    if (/계약.*기간|계약일/.test(allText))
      ok.push('계약기간 명시 확인 (사업기간 내 여부 수동확인 권장)');
    break;
  }

  // ═══════════ 사무용품 ═══════════
  case '사무용품': {
    // 1) 내부결재
    if (hasFileByName(rec.files, '내부결재')) ok.push('내부결재 ✓');

    // 2) 견적서
    if (hasFileByName(rec.files, '견적서', '견적')) ok.push('견적서 ✓');

    // 3) 세금계산서 (보조금전용카드면 카드전표로 대체)
    if (hasFileByName(rec.files, '세금계산서') || hasFileByContent(rec.files, '전자세금계산서'))
      ok.push('세금계산서 ✓');
    else if (rec.evidenceType === '보조금전용카드')
      ok.push('보조금전용카드 결제 (카드전표 대체) ✓');
    else issues.push('세금계산서 미첨부');

    // 4) 검수조서
    if (hasFileByName(rec.files, '검수조서', '검수')) ok.push('검수조서 ✓');

    // 5) 거래명세서
    if (hasFileByName(rec.files, '거래명세서')) ok.push('거래명세서 ✓');

    // 6) 범용성 확인
    if (/노트북|laptop|pc|컴퓨터/i.test(allText)) {
      issues.push('★ 범용성 장비 구매 의심 → 지침 별표2 불인정 항목 확인');
    }

    // 7) 50만원 초과 자산취득
    if (rec.totalAmount > 500000) {
      issues.push(`${rec.totalAmount.toLocaleString()}원 → 50만원 초과, 자산취득 해당 여부 확인`);
    }
    break;
  }

  // ═══════════ 재료비 ═══════════
  case '재료비': {
    // 세금계산서
    if (hasFileByName(rec.files, '세금계산서') || hasFileByContent(rec.files, '전자세금계산서'))
      ok.push('세금계산서 ✓');
    else issues.push('세금계산서 미첨부');

    // 거래명세서
    if (hasFileByName(rec.files, '거래명세서')) ok.push('거래명세서 ✓');

    // 견적서
    if (hasFileByName(rec.files, '견적')) ok.push('견적서 ✓');

    // 사업 관련성
    ok.push('소모성 재료비 → 사업 관련성 수동 확인 권장');
    break;
  }

  // ═══════════ 수수료 ═══════════
  case '수수료': {
    if (hasFileByContent(rec.files, '세금계산서') || hasFileByName(rec.files, '세금계산서'))
      ok.push('세금계산서/가상계좌 ✓');
    if (hasFileByName(rec.files, '사업자등록증')) ok.push('사업자등록증 ✓');
    ok.push('수수료 → 일반수용비 적정');
    break;
  }

  default:
    issues.push('분류 불가 → 수동 확인 필요');
  }

  // ═══════════ 공통: 부가세 포함 집행 체크 ═══════════
  // supply=0이면서 total===vat인 경우는 기관의 데이터 입력 오류 (자문료 등)
  if (rec.vat > 0 && rec.totalAmount === rec.supplyAmount + rec.vat && rec.supplyAmount > 0) {
    issues.push(`부가세 ${rec.vat.toLocaleString()}원 포함 집행 → 영리법인 매입세액공제 가능분 불인정`);
  }

  // ═══════════ 공통: 상품권/유가증권 체크 ═══════════
  if (/상품권|기프트카드|유가증권/.test(allText)) {
    // 우체국 영수증 "기프트카드잔액", 보험문서 OCR 오인식, 쿠팡 보일러플레이트 제외
    if (!/우체국|우편|보험|insurance|쿠팡/i.test(allText) &&
        !/쿠팡/i.test(rec.vendorName || '')) {
      issues.push('상품권/유가증권 구매 의심');
    }
  }
  // 쿠폰은 쇼핑몰(쿠팡/네이버 등) 할인쿠폰 오탐이 많아 별도 처리
  if (/쿠폰/.test(allText) && /상품권|기프트/.test(allText) &&
      !/우체국|우편|보험|쿠팡|네이버|11번가/i.test(allText)) {
    issues.push('상품권/유가증권 구매 의심 (쿠폰)');
  }

  const status = issues.length === 0 ? '적정' : '확인';
  return { type, status, issues, ok };
}

// ── 배치 실행 ──
function run(data, opts = {}) {
  const { staff = [], institutionName = '' } = opts;
  const results = [];

  for (const rec of data) {
    const r = judge(rec, { staff });
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

  return results;
}

// ── 결과 출력 ──
function printResults(results, institutionName) {
  const okCnt = results.filter(r => r.status === '적정').length;
  const chkCnt = results.filter(r => r.status === '확인').length;

  console.log('╔══════════════════════════════════════════════════╗');
  console.log(`║   ${institutionName} ${results.length}건 정산검토 결과`);
  console.log('╠══════════════════════════════════════════════════╣');
  console.log(`║   적정: ${okCnt}건  |  확인: ${chkCnt}건`);
  console.log('╚══════════════════════════════════════════════════╝\n');

  // 확인 필요 건
  console.log('━━━━ 확인 필요 건 ━━━━\n');
  for (const r of results.filter(x => x.status === '확인')) {
    console.log(`R${r.rowNum} [${r.type}] ${r.purpose} | ${r.amount.toLocaleString()}원 | ${r.vendor}`);
    for (const i of r.issues) console.log(`  ⚠ ${i}`);
    for (const o of r.ok)     console.log(`  ✓ ${o}`);
    console.log('');
  }

  // 적정 건
  console.log('\n━━━━ 적정 건 ━━━━\n');
  for (const r of results.filter(x => x.status === '적정')) {
    console.log(`R${r.rowNum} [${r.type}] ${r.purpose} | ${r.amount.toLocaleString()}원`);
    for (const o of r.ok) console.log(`  ✓ ${o}`);
    console.log('');
  }

  // 유형별 요약
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

  // 주요 이슈 요약
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
}

module.exports = { classify, judge, run, printResults };

// ── CLI 실행 ──
if (require.main === module) {
  const args = process.argv.slice(2);
  const getArg = (prefix) => {
    const a = args.find(x => x.startsWith(prefix));
    return a ? a.substring(prefix.length) : null;
  };

  const dataFile = getArg('--data=');
  const staffStr = getArg('--staff=');
  const name = getArg('--name=') || '기관';
  const outputFile = getArg('--output=');

  if (!dataFile) {
    console.log('사용법: node lib/judge-digital-healthcare.js --data=xxx-data.json --name=기관명 [--staff=이름1,이름2] [--output=xxx-results.json]');
    process.exit(1);
  }

  const data = JSON.parse(fs.readFileSync(dataFile, 'utf-8'));
  const staff = staffStr ? staffStr.split(',') : [];
  const results = run(data, { staff, institutionName: name });

  printResults(results, name);

  const outPath = outputFile || dataFile.replace('-data.json', '-results.json');
  fs.writeFileSync(outPath, JSON.stringify(results, null, 2), 'utf-8');
  console.log(`\n결과 저장: ${outPath}`);
}
