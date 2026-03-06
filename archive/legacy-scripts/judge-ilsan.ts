/**
 * 국민건강보험 일산병원 119건 검증 프레임워크 적용
 * ilsan-data.json → 비목별 규칙 적용 → 판단 결과 JSON + 엑셀
 */
import fs from 'fs';
import ExcelJS from 'exceljs';

const DATA_JSON = '/mnt/c/projects/e-naradomum-rpa/ilsan-data.json';
const SOURCE_EXCEL = '/mnt/c/Users/정동회계법인/Documents/2025 지역책임의료기관사업_국민건강보험 일산병원/B0070225000683_사업집행내역_20260205150410.xlsx';
const RESULT_DIR = '/mnt/c/projects/e-naradomum-rpa/results';

interface FileInfo {
  name: string; text: string; docType: string; amounts: number[];
}
interface Record {
  rowNum: number; executionDate: string; evidenceType: string;
  purpose: string; budgetCategory: string; subCategory: string;
  itemName: string; vendorName: string; supplyAmount: number;
  totalAmount: number; reviewStatus: string; files: FileInfo[];
}
interface Judgment {
  status: '적정' | '확인필요' | '부적정';
  reasons: string[];
  checks: string[];  // 통과한 검증 항목
  flags: string[];   // 주의/위반 사항
}

// ===== 비목 분류 =====
function categorize(rec: Record): string {
  const cat = rec.budgetCategory;
  const sub = rec.subCategory;
  const purpose = rec.purpose;
  const item = rec.itemName;

  if (cat.includes('인건비')) return '인건비';
  if (cat.includes('여비')) return '여비';
  if (cat.includes('업무추진비')) return '업무추진비';
  if (cat.includes('연구') || cat.includes('용역')) return '연구용역비';

  // 복리후생비 먼저 체크 (4대보험, 사대보험 등)
  if (sub.includes('복리후생비') || purpose.includes('4대보험') || purpose.includes('사대보험') ||
      purpose.includes('보험료') || (purpose.includes('보험') && purpose.includes('사용자'))) {
    return '복리후생비';
  }

  // 운영비 세부 분류
  if (sub.includes('일반수용비') || cat.includes('운영비')) {
    if (purpose.includes('회의참석사례') || purpose.includes('참석사례')) return '회의참석사례금';
    if (purpose.includes('자문') || purpose.includes('수당') || item.includes('자문')) {
      if (purpose.includes('사례금') || purpose.includes('사례비')) return '회의참석사례금';
      return '자문수당';
    }
    if (purpose.includes('인센티브') || item.includes('인센티브')) return '협력인센티브';
    if (purpose.includes('홍보') || purpose.includes('안내') || item.includes('홍보')) return '안내홍보물';
    if (purpose.includes('피복') || purpose.includes('가운') || item.includes('피복')) return '피복비';
    if (purpose.includes('유류') || item.includes('유류')) return '유류비';
    if (purpose.includes('교육') && !purpose.includes('수당')) return '교육훈련비';
    if (purpose.includes('임차') || item.includes('임차')) return '임차료';
    if (purpose.includes('chatgpt') || purpose.includes('사용료') || item.includes('수수료')) return '수수료사용료';
    return '일반수용비';
  }

  if (cat.includes('자산') || cat.includes('유형')) return '유형자산';
  return '일반수용비';
}

// ===== 금액 추출 =====
function extractAmountsFromTexts(files: FileInfo[]): number[] {
  const all: number[] = [];
  for (const f of files) {
    all.push(...f.amounts);
  }
  return [...new Set(all)].sort((a, b) => b - a);
}

// ===== 공통 검증 =====
function commonChecks(rec: Record, j: Judgment): void {
  const allTexts = rec.files.map(f => f.text).join('\n');
  const docTypes = rec.files.map(f => f.docType);
  const amounts = extractAmountsFromTexts(rec.files);

  // 1. 증빙서류 존재
  if (rec.files.length === 0) {
    j.flags.push('증빙서류 미첨부');
    j.status = '부적정';
    return;
  }
  j.checks.push(`증빙파일 ${rec.files.length}개`);

  // 2. 유효 증빙 유형 확인
  const validTypes = ['세금계산서', '영수증/카드', '거래명세서', '이체증', '통장사본'];
  const hasValid = docTypes.some(d => validTypes.includes(d));
  if (hasValid) {
    j.checks.push('유효증빙 확인');
  }

  // 3. 지출결의서 확인
  if (docTypes.includes('지출결의서')) {
    j.checks.push('지출결의서 확인');
  }

  // 4. 기안문 확인
  if (docTypes.includes('기안문')) {
    j.checks.push('기안문 확인');
  }

  // 5. 금액 대조
  const target = rec.totalAmount;
  if (amounts.length > 0 && target > 0) {
    const exactMatch = amounts.some(a => a === target);
    const closeMatch = amounts.some(a => Math.abs(a - target) / target < 0.05);
    const supplyMatch = rec.supplyAmount > 0 && amounts.some(a => a === rec.supplyAmount || Math.abs(a - rec.supplyAmount) / rec.supplyAmount < 0.05);

    if (exactMatch) {
      j.checks.push(`집행금액 ${target.toLocaleString()}원 일치`);
    } else if (closeMatch) {
      j.checks.push(`집행금액 근사치 일치`);
    } else if (supplyMatch) {
      j.checks.push('공급가액 일치');
    } else {
      j.flags.push(`금액불일치(집행:${target.toLocaleString()}, 증빙최대:${amounts[0]?.toLocaleString() || '없음'})`);
    }
  }

  // 6. 거래처 일치
  if (rec.vendorName && rec.vendorName.length >= 2) {
    if (allTexts.includes(rec.vendorName)) {
      j.checks.push(`거래처(${rec.vendorName}) 확인`);
    }
  }

  // 7. 상품권/유가증권 체크 (우체국 영수증의 "기프트카드잔액:" 필드는 제외)
  const forbidden = ['상품권', '쿠폰', '기프티콘', '문화상품권', '유가증권'];
  for (const kw of forbidden) {
    if (rec.purpose.includes(kw) || rec.itemName.includes(kw)) {
      j.flags.push(`금지항목: ${kw} 감지(용도/품명)`);
      j.status = '부적정';
    } else if (allTexts.includes(kw)) {
      // 증빙 본문에서 발견 - 우체국 영수증 "기프트카드잔액" 패턴 제외
      const isPostalReceipt = allTexts.includes('우체국') || allTexts.includes('우편') || allTexts.includes('등기');
      if (!isPostalReceipt) {
        j.flags.push(`금지항목: ${kw} 감지(증빙내)`);
        j.status = '부적정';
      }
    }
  }

  // 8. 문서 불일치 체크 (첨부파일 내용이 해당 건과 무관한 경우)
  if (rec.files.length > 0 && rec.totalAmount > 100000) {
    const purposeKws = rec.purpose.replace(/[0-9년월일분기차.]/g, '').split(/[\s,_()（）\-]+/).filter(w => w.length >= 2);
    const matchedInFiles = purposeKws.filter(kw => allTexts.includes(kw));
    if (purposeKws.length >= 2 && matchedInFiles.length === 0) {
      j.flags.push(`문서불일치 의심: 용도 키워드(${purposeKws.slice(0,3).join(',')})가 증빙에서 미발견`);
    }
  }
}

// ===== 비목별 검증 =====

function checkIngunbi(rec: Record, j: Judgment): void {
  const docTypes = rec.files.map(f => f.docType);
  const allTexts = rec.files.map(f => f.text).join('\n');

  // 필수 증빙: 급여명세서
  if (docTypes.some(d => ['급여명세', '이체증', '통장사본'].includes(d))) {
    j.checks.push('인건비 증빙(급여명세/이체증) 확인');
  } else {
    j.flags.push('인건비 필수증빙(급여명세서/이체증) 미확인');
  }

  // 주의 키워드
  if (rec.purpose.includes('당직') || allTexts.includes('당직')) {
    j.flags.push('주의: 당직수당 - 전담업무 관련성 확인 필요');
  }
  if (rec.purpose.includes('겸임') || allTexts.includes('겸임')) {
    j.flags.push('주의: 겸임 관련 - 복지부 승인 확인 필요');
  }
  if (rec.purpose.includes('퇴직금') || rec.purpose.includes('퇴직')) {
    j.flags.push('주의: 퇴직금 - 사업수행기간분만 가능');
  }
}

function checkIlbansuyongbi(rec: Record, j: Judgment): void {
  const docTypes = rec.files.map(f => f.docType);
  const purpose = rec.purpose;

  // 개인 수당/사례금 건인지 판단 (세금계산서 아닌 이체증/통장사본이 정상 증빙)
  const isPersonalPayment = purpose.includes('사례금') || purpose.includes('사례비') ||
    purpose.includes('수당') || purpose.includes('인센티브') || purpose.includes('원천징수');

  if (isPersonalPayment) {
    // 개인 지급건: 지출결의서 + 이체증/통장사본/영수증 확인
    if (docTypes.some(d => ['지출결의서', '입금의뢰서', '이체증', '통장사본', '수당지급조서'].includes(d))) {
      j.checks.push('개인지급 증빙(지출결의서/이체증) 확인');
    } else {
      j.flags.push('개인지급 필수증빙(지출결의서/이체증) 미확인');
    }
  } else {
    // 물품/용역 구매건: 세금계산서 또는 카드영수증
    if (docTypes.some(d => ['세금계산서', '영수증/카드', '거래명세서'].includes(d))) {
      j.checks.push('일반수용비 증빙 확인');
    } else {
      j.flags.push('일반수용비 필수증빙(세금계산서/카드영수증) 미확인');
    }
  }

  // 취득단가 50만원 한도 (인쇄비/용역/수당/사용료/심포지엄 제외)
  const isService = purpose.includes('용역') || purpose.includes('수당') || purpose.includes('인쇄') ||
    purpose.includes('제작') || purpose.includes('사용료') || purpose.includes('사례금') ||
    purpose.includes('사례비') || purpose.includes('인센티브') || purpose.includes('원천징수') ||
    purpose.includes('배송') || purpose.includes('수수료') || purpose.includes('심포지엄') ||
    purpose.includes('워크숍') || purpose.includes('교육');
  if (rec.totalAmount >= 500000 && !isService) {
    j.flags.push(`취득단가 50만원 이상(${rec.totalAmount.toLocaleString()}원) - 자산취득비 해당 여부 확인`);
  }

  // 환자 직접 지급 물품
  if (rec.purpose.includes('환자') && (rec.purpose.includes('지급') || rec.purpose.includes('배부'))) {
    j.flags.push('주의: 환자 직접 지급 물품 해당 여부 확인');
  }
}

function checkAnnaehongbo(rec: Record, j: Judgment): void {
  const docTypes = rec.files.map(f => f.docType);

  // 증빙 확인
  if (docTypes.some(d => ['세금계산서', '영수증/카드', '견적서', '거래명세서'].includes(d))) {
    j.checks.push('안내홍보물 증빙 확인');
  } else {
    j.flags.push('안내홍보물 필수증빙 미확인');
  }

  // 단가 5만원 한도 체크 (총액이 아닌 개별 단가 기준)
  // 증빙 텍스트에서 수량 추출 시도
  const allTexts = rec.files.map(f => f.text).join('\n');
  const qtyMatch = allTexts.match(/(\d+)\s*[개ea세트건]/i);
  if (qtyMatch && rec.purpose.includes('홍보물품')) {
    const qty = parseInt(qtyMatch[1]);
    if (qty > 0) {
      const unitPrice = Math.round(rec.totalAmount / qty);
      if (unitPrice > 50000) {
        j.flags.push(`홍보물품 단가 ${unitPrice.toLocaleString()}원/개(${qty}개) - 5만원 초과`);
      } else {
        j.checks.push(`홍보물품 단가 ${unitPrice.toLocaleString()}원/개(${qty}개) - 5만원 이하`);
      }
    }
  } else if (rec.totalAmount > 50000 && rec.purpose.includes('홍보물품')) {
    // 수량 추출 불가시 총액으로 주의 표기 (다수 구매 가능성)
    j.checks.push(`홍보물품 총액 ${rec.totalAmount.toLocaleString()}원 - 개별단가 확인 필요`);
  }
}

function checkJamunsuddang(rec: Record, j: Judgment): void {
  const docTypes = rec.files.map(f => f.docType);

  // 필수 증빙: 수당지급조서 또는 자문의뢰서/회신서
  if (docTypes.some(d => ['수당지급조서', '지출결의서', '입금의뢰서', '자문의뢰서', '자문회신서', '자문요청서'].includes(d))) {
    j.checks.push('자문수당 증빙 확인');
  } else {
    j.flags.push('자문수당 필수증빙(수당지급조서) 미확인');
  }

  // 건당 단가 한도
  if (rec.totalAmount > 200000) {
    if (rec.purpose.includes('심포지엄') || rec.purpose.includes('발표')) {
      if (rec.totalAmount > 400000) {
        j.flags.push(`심포지엄 자문수당 40만원 초과(${rec.totalAmount.toLocaleString()}원)`);
      }
    } else {
      j.flags.push(`자문수당 20만원 초과(${rec.totalAmount.toLocaleString()}원) - 2시간 초과 여부 확인`);
    }
  }
}

function checkHoeui(rec: Record, j: Judgment): void {
  const docTypes = rec.files.map(f => f.docType);

  if (docTypes.some(d => ['수당지급조서', '지출결의서', '입금의뢰서'].includes(d))) {
    j.checks.push('회의참석사례금 증빙 확인');
  } else {
    j.flags.push('회의참석사례금 필수증빙 미확인');
  }

  // 건당 20만원 한도
  if (rec.totalAmount > 200000) {
    j.flags.push(`회의참석사례금 20만원 초과(${rec.totalAmount.toLocaleString()}원)`);
  }
}

function checkIncentive(rec: Record, j: Judgment): void {
  const docTypes = rec.files.map(f => f.docType);
  const allTexts = rec.files.map(f => f.text).join('\n');

  // 증빙 확인 (인센티브지급내역, 퇴원케어플랜 포함)
  if (docTypes.some(d => ['지출결의서', '인센티브', '입금의뢰서', '인센티브지급내역', '퇴원케어플랜'].includes(d))) {
    j.checks.push('협력인센티브 증빙 확인');
  } else {
    j.flags.push('협력인센티브 증빙 미확인');
  }

  // 건당 5만원 한도 (합산 지급건은 개별건 확인)
  // 증빙에서 개별 건당 금액 추출 시도
  const perCaseAmounts = allTexts.match(/50,000원|100,000원|150,000원/g) || [];
  const hasOverLimit = perCaseAmounts.some(a => parseInt(a.replace(/[^0-9]/g, '')) > 50000);

  if (hasOverLimit) {
    j.flags.push(`협력인센티브 개별건 5만원 초과 감지 - 1건당 한도 확인 필요`);
  } else if (rec.totalAmount > 50000) {
    // 다건 합산일 가능성 - 건수 추출
    const caseMatch = rec.purpose.match(/(\d+)\s*[건월]/);
    if (caseMatch) {
      const cases = parseInt(caseMatch[1]);
      if (cases > 0) {
        const perCase = Math.round(rec.totalAmount / cases);
        if (perCase > 50000) {
          j.flags.push(`협력인센티브 건당 ${perCase.toLocaleString()}원(${cases}건) - 5만원 초과`);
        } else {
          j.checks.push(`협력인센티브 건당 ${perCase.toLocaleString()}원(${cases}건) - 5만원 이하`);
        }
      }
    } else {
      j.checks.push(`협력인센티브 총 ${rec.totalAmount.toLocaleString()}원 - 다건 합산 가능성, 개별단가 확인`);
    }
  }
}

function checkYeobi(rec: Record, j: Judgment): void {
  const docTypes = rec.files.map(f => f.docType);

  // 필수 증빙: 출장서류
  if (docTypes.some(d => ['출장서류', '지출결의서', '기안문'].includes(d))) {
    j.checks.push('여비 증빙(출장서류) 확인');
  } else {
    j.flags.push('여비 필수증빙(출장명령서/출장보고서) 미확인');
  }
}

function checkUpmu(rec: Record, j: Judgment): void {
  const docTypes = rec.files.map(f => f.docType);
  const allTexts = rec.files.map(f => f.text).join('\n');

  // 필수 증빙: 카드영수증
  if (docTypes.some(d => ['영수증/카드', '세금계산서', '지출결의서'].includes(d))) {
    j.checks.push('업무추진비 증빙 확인');
  } else {
    j.flags.push('업무추진비 필수증빙(카드영수증) 미확인');
  }

  // 인당 5만원 한도 추정 (참석인원 추출 - "총 N명" 또는 "N명 참석" 패턴 우선)
  const totalPersonMatch = allTexts.match(/총\s*(\d+)\s*[명인]/) || allTexts.match(/(\d+)\s*명\s*참석/) || allTexts.match(/참석[^0-9]*(\d+)\s*[명인]/);
  if (totalPersonMatch) {
    const numPeople = parseInt(totalPersonMatch[1]);
    if (numPeople > 1) {
      const perPerson = rec.totalAmount / numPeople;
      if (perPerson > 50000) {
        j.flags.push(`업무추진비 인당 ${Math.round(perPerson).toLocaleString()}원 (${numPeople}명) - 5만원 초과`);
      } else {
        j.checks.push(`업무추진비 인당 ${Math.round(perPerson).toLocaleString()}원 (${numPeople}명) - 5만원 이하`);
      }
    }
  }

  // 내부회의 체크
  if (!allTexts.includes('외부') && !allTexts.includes('협의체') && !allTexts.includes('간담회')) {
    if (rec.purpose.includes('내부') || (allTexts.includes('내부') && !allTexts.includes('외부'))) {
      j.flags.push('주의: 내부회의 업무추진비 - 외부인사 참여 여부 확인');
    }
  }
}

function checkYeongu(rec: Record, j: Judgment): void {
  const docTypes = rec.files.map(f => f.docType);

  // 필수 증빙: 계약서 + 세금계산서
  if (docTypes.includes('계약서')) j.checks.push('계약서 확인');
  else j.flags.push('연구용역비 필수증빙(계약서) 미확인');

  if (docTypes.some(d => ['세금계산서', '영수증/카드'].includes(d))) {
    j.checks.push('연구용역비 세금계산서 확인');
  } else {
    j.flags.push('연구용역비 필수증빙(세금계산서) 미확인');
  }
}

function checkBokri(rec: Record, j: Judgment): void {
  // 4대보험/사대보험료 - 이체증 + 보험관련 서류가 정상 증빙
  const docTypes = rec.files.map(f => f.docType);

  // 사대보험료는 세금계산서가 필요 없음 - 이체증/보험관련이 증빙
  if (docTypes.some(d => ['이체증', '보험관련', '지출결의서', '기안문', '통장사본'].includes(d))) {
    j.checks.push('복리후생비(사대보험) 증빙 확인');
  } else {
    j.flags.push('복리후생비 증빙(이체증/보험납부확인서) 미확인');
  }

  // 사업 연관성: 인건비 관련 사대보험이므로 당연히 연관
  j.checks.push('사업 연관성 인정 (인건비 관련 사대보험)');
}

function checkGyoyuk(rec: Record, j: Judgment): void {
  const docTypes = rec.files.map(f => f.docType);
  if (docTypes.some(d => ['영수증/카드', '세금계산서', '지출결의서'].includes(d))) {
    j.checks.push('교육훈련비 증빙 확인');
  } else {
    j.flags.push('교육훈련비 증빙 미확인');
  }
}

// ===== 사업 연관성 검증 =====
function checkRelevance(rec: Record, j: Judgment): void {
  const purpose = rec.purpose.toLowerCase();
  // 책임의료기관 사업 관련 키워드
  const relevant = [
    '급여', '인건비', '보수', '4대보험', '사대보험', '보험료', '사용자분', '보험금', '퇴직금',
    '회의', '협의체', '간담회', '자문', '교육', '워크숍', '심포지엄',
    '출장', '여비',
    '홍보', '안내', '제작', '인쇄',
    '사무', '소모품', '용지', '잉크', '토너',
    '용역', '위탁', '연구', '조사', '기초조사',
    '인센티브', '수당', '사례금', '사례비',
    '피복', '가운',
    '유류', '임차', '차량',
    'chatgpt', '사용료', '업무폰',
    '퇴원', '감염', '응급', '공공보건', '협력', '네트워크',
    '물품', '비품', '태블릿',
    '식비', '다과',
    '등기', '우편', '배송', '현수막', '볼펜', '웨건', '카트',
    '학술', '참석', '구독', '포스터', '어워즈',
    '심전도', '구강', '장기요양', '브로셔', '지침서',
    '구급대원', 'cpr', '중증', '공공의료', '연계망', '리플렛',
  ];
  const hasRelevance = relevant.some(kw => purpose.includes(kw));
  if (hasRelevance) {
    j.checks.push('사업 연관성 인정');
  } else {
    j.flags.push(`사업 연관성 미확인: "${rec.purpose.substring(0, 30)}"`);
  }
}

// ===== 비목 설정 적절성 =====
function checkBimokFit(rec: Record, j: Judgment): void {
  const cat = categorize(rec);
  const purpose = rec.purpose;

  // 인건비인데 물품 구매 키워드
  if (cat === '인건비' && (purpose.includes('구매') || purpose.includes('물품'))) {
    j.flags.push('비목 부적절 의심: 인건비 비목에 물품구매');
  }
  // 업무추진비인데 물품 키워드
  if (cat === '업무추진비' && (purpose.includes('구매') || purpose.includes('물품') || purpose.includes('비품'))) {
    j.flags.push('비목 부적절 의심: 업무추진비 비목에 물품구매');
  }
  // 일반수용비인데 50만원 이상 (자산취득비 해당) - 인쇄/제작/용역/수당/사용료/심포지엄/교육 제외
  if (cat === '일반수용비' && rec.totalAmount >= 500000) {
    const serviceKws = ['수당', '인센티브', '사용료', '용역', '인쇄', '제작', '사례금', '사례비', '원천징수', '배송', '수수료', '심포지엄', '워크숍', '교육', '행사'];
    if (!serviceKws.some(kw => purpose.includes(kw))) {
      j.flags.push('비목 확인: 일반수용비 50만원 이상 - 자산취득비 해당 가능성');
    }
  }
}

// ===== 종합 판단 =====
function judge(rec: Record): Judgment {
  const j: Judgment = { status: '적정', reasons: [], checks: [], flags: [] };
  const cat = categorize(rec);

  // 공통 검증
  commonChecks(rec, j);
  if (j.status === '부적정') {
    j.reasons = [...j.flags];
    return j;
  }

  // 비목별 검증
  switch (cat) {
    case '인건비': checkIngunbi(rec, j); break;
    case '일반수용비': checkIlbansuyongbi(rec, j); break;
    case '안내홍보물': checkAnnaehongbo(rec, j); break;
    case '자문수당': checkJamunsuddang(rec, j); break;
    case '회의참석사례금': checkHoeui(rec, j); break;
    case '협력인센티브': checkIncentive(rec, j); break;
    case '여비': checkYeobi(rec, j); break;
    case '업무추진비': checkUpmu(rec, j); break;
    case '연구용역비': checkYeongu(rec, j); break;
    case '복리후생비': checkBokri(rec, j); break;
    case '교육훈련비': checkGyoyuk(rec, j); break;
    case '피복비': break;
    case '임차료': break;
    case '유류비': break;
    case '수수료사용료': break;
    default: break;
  }

  // 사업 연관성
  checkRelevance(rec, j);

  // 비목 설정 적절성
  checkBimokFit(rec, j);

  // 종합 판단
  const criticalFlags = j.flags.filter(f =>
    f.includes('부적정') || f.includes('금지항목') || f.includes('미첨부') ||
    f.includes('초과') || f.includes('부적절 의심')
  );
  const warningFlags = j.flags.filter(f =>
    f.includes('불일치') || f.includes('미확인') || f.includes('확인 필요') || f.includes('주의')
  );

  if (criticalFlags.length > 0) {
    j.status = j.flags.some(f => f.includes('금지항목') || f.includes('미첨부')) ? '부적정' : '확인필요';
  } else if (warningFlags.length > 0) {
    j.status = '확인필요';
  } else if (j.checks.length >= 2) {
    j.status = '적정';
  } else {
    j.status = '확인필요';
  }

  j.reasons = [
    ...j.checks.map(c => `[OK] ${c}`),
    ...j.flags.map(f => `[!] ${f}`),
  ];

  return j;
}

// ===== 누적 한도 검증 =====
interface CumulativeCheck {
  category: string;
  limit: number;
  actual: number;
  count: number;
  exceeded: boolean;
}

function checkCumulativeLimits(records: Record[]): CumulativeCheck[] {
  const accum = new Map<string, { total: number; count: number }>();

  for (const rec of records) {
    const cat = categorize(rec);
    const prev = accum.get(cat) || { total: 0, count: 0 };
    prev.total += rec.totalAmount;
    prev.count++;
    accum.set(cat, prev);
  }

  const totalBudget = records.reduce((s, r) => s + r.totalAmount, 0);

  const limits: { cat: string; limit: number; label: string }[] = [
    { cat: '자문수당', limit: 20000000, label: '자문수당 총 2,000만원' },
    { cat: '안내홍보물', limit: 50000000, label: '안내홍보물 총 5,000만원' },
    { cat: '협력인센티브', limit: 50000000, label: '협력인센티브 총 5,000만원' },
    { cat: '유류비', limit: 3000000, label: '유류비 총 300만원' },
    { cat: '교육훈련비', limit: 3000000, label: '교육훈련비 총 300만원' },
    { cat: '연구용역비', limit: 60000000, label: '연구용역비 총 6,000만원' },
    { cat: '업무추진비', limit: totalBudget * 0.05, label: `업무추진비 총 보조금5%(${(totalBudget * 0.05).toLocaleString()}원)` },
  ];

  const results: CumulativeCheck[] = [];
  for (const lim of limits) {
    const data = accum.get(lim.cat);
    if (data) {
      results.push({
        category: lim.label,
        limit: lim.limit,
        actual: data.total,
        count: data.count,
        exceeded: data.total > lim.limit,
      });
    }
  }

  return results;
}

// ===== 메인 =====
async function main() {
  console.log('=== 국민건강보험 일산병원 119건 검증 ===\n');

  const records: Record[] = JSON.parse(fs.readFileSync(DATA_JSON, 'utf-8'));
  console.log(`데이터 로드: ${records.length}건\n`);

  // 1. 개별 판단
  const results: { rec: Record; judgment: Judgment; category: string }[] = [];

  for (const rec of records) {
    const judgment = judge(rec);
    const category = categorize(rec);
    results.push({ rec, judgment, category });
  }

  // 2. 누적 한도
  const cumChecks = checkCumulativeLimits(records);

  // 1일 다건 회의참석사례금 체크
  const saregumByDate = new Map<string, Record[]>();
  for (const r of results) {
    if (r.category === '회의참석사례금') {
      const key = r.rec.executionDate;
      const list = saregumByDate.get(key) || [];
      list.push(r.rec);
      saregumByDate.set(key, list);
    }
  }
  for (const [date, recs] of saregumByDate) {
    // 동일인 동일일 다건 체크 (거래처 = 수령인으로 간주)
    const byVendor = new Map<string, number>();
    for (const r of recs) {
      byVendor.set(r.vendorName, (byVendor.get(r.vendorName) || 0) + 1);
    }
    for (const [vendor, cnt] of byVendor) {
      if (cnt > 1 && vendor) {
        // 해당 건들에 플래그 추가
        for (const res of results) {
          if (res.category === '회의참석사례금' && res.rec.executionDate === date && res.rec.vendorName === vendor) {
            res.judgment.flags.push(`1일 다건 회의참석사례금: ${vendor} ${date} ${cnt}건`);
            if (res.judgment.status === '적정') res.judgment.status = '확인필요';
          }
        }
      }
    }
  }

  // 3. 통계
  const stats = { 적정: 0, 확인필요: 0, 부적정: 0 };
  for (const r of results) stats[r.judgment.status]++;

  console.log('=== 검증 결과 요약 ===');
  console.log(`적정: ${stats.적정}건`);
  console.log(`확인필요: ${stats.확인필요}건`);
  console.log(`부적정: ${stats.부적정}건`);

  console.log('\n=== 누적 한도 검증 ===');
  for (const c of cumChecks) {
    const pct = (c.actual / c.limit * 100).toFixed(1);
    const mark = c.exceeded ? ' *** 초과! ***' : '';
    console.log(`${c.category}: ${c.actual.toLocaleString()}원 / ${c.limit.toLocaleString()}원 (${pct}%, ${c.count}건)${mark}`);
  }

  // 비목별 통계
  const catStats = new Map<string, { 적정: number; 확인필요: number; 부적정: number; total: number }>();
  for (const r of results) {
    const prev = catStats.get(r.category) || { 적정: 0, 확인필요: 0, 부적정: 0, total: 0 };
    prev[r.judgment.status]++;
    prev.total += r.rec.totalAmount;
    catStats.set(r.category, prev);
  }
  console.log('\n=== 비목별 통계 ===');
  for (const [cat, s] of [...catStats.entries()].sort((a, b) => b[1].total - a[1].total)) {
    console.log(`${cat}: 적정${s.적정}/확인${s.확인필요}/부적정${s.부적정} (${s.total.toLocaleString()}원)`);
  }

  // 4. 확인필요/부적정 건 상세 출력
  console.log('\n=== 확인필요/부적정 건 상세 ===');
  for (const r of results) {
    if (r.judgment.status !== '적정') {
      const flags = r.judgment.flags.join(' | ');
      console.log(`[${r.judgment.status}] r${r.rec.rowNum} ${r.rec.executionDate} ${r.rec.purpose.substring(0, 40)}`);
      console.log(`  비목: ${r.category} | 금액: ${r.rec.totalAmount.toLocaleString()}원 | 거래처: ${r.rec.vendorName}`);
      console.log(`  사유: ${flags}`);
      console.log(`  파일: ${r.rec.files.map(f => f.docType).join(', ')}`);
    }
  }

  // 5. 결과 엑셀 생성
  console.log('\n=== 결과 엑셀 생성 ===');
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(SOURCE_EXCEL);
  const ws = wb.worksheets[0];

  // 헤더 추가 (Y열=검증결과, Z열=검증사유, AA열=비목분류, AB열=검증상세)
  const headerRow = ws.getRow(2);
  headerRow.getCell(25).value = '검증결과';
  headerRow.getCell(26).value = '검증사유';
  headerRow.getCell(27).value = '비목분류';
  headerRow.getCell(28).value = '검증상세';

  for (const r of results) {
    const row = ws.getRow(r.rec.rowNum + 2);
    row.getCell(25).value = r.judgment.status;
    row.getCell(26).value = r.judgment.flags.join('; ') || '이상없음';
    row.getCell(27).value = r.category;
    row.getCell(28).value = r.judgment.reasons.join('; ');

    // 색상
    const color = r.judgment.status === '적정' ? '92D050' : r.judgment.status === '확인필요' ? 'FFC000' : 'FF0000';
    row.getCell(25).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: color } };
  }

  const now = new Date();
  const ts = `${now.getFullYear()}${String(now.getMonth()+1).padStart(2,'0')}${String(now.getDate()).padStart(2,'0')}_${String(now.getHours()).padStart(2,'0')}${String(now.getMinutes()).padStart(2,'0')}`;
  const outPath = `${RESULT_DIR}/일산병원_검증결과_${ts}.xlsx`;
  fs.mkdirSync(RESULT_DIR, { recursive: true });
  await wb.xlsx.writeFile(outPath);
  console.log(`결과 파일: ${outPath}`);

  // 6. 상세 JSON 저장
  const jsonOut = `${RESULT_DIR}/일산병원_검증상세_${ts}.json`;
  fs.writeFileSync(jsonOut, JSON.stringify({
    summary: stats,
    cumulative: cumChecks,
    categoryStats: Object.fromEntries(catStats),
    flagged: results.filter(r => r.judgment.status !== '적정').map(r => ({
      rowNum: r.rec.rowNum,
      date: r.rec.executionDate,
      purpose: r.rec.purpose,
      category: r.category,
      amount: r.rec.totalAmount,
      vendor: r.rec.vendorName,
      status: r.judgment.status,
      flags: r.judgment.flags,
      checks: r.judgment.checks,
      files: r.rec.files.map(f => ({ name: f.name, docType: f.docType })),
    })),
  }, null, 2), 'utf-8');
  console.log(`상세 JSON: ${jsonOut}`);
}

main().catch(console.error);
