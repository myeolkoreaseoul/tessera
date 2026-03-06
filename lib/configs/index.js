/**
 * 사업별 설정 레지스트리
 *
 * 새 사업 추가: 이 파일에 config 추가 + guidelines/*.md 작성
 */
const path = require('path');
const guidelinesRoot = path.join(__dirname, '..', '..', 'guidelines');

const configs = {
  '디지털헬스케어': {
    legalBasis: '보조금',
    system: 'enaradomum',
    agency: 'KHIDI',
    consultFeeLimit: 600000,        // 1일 자문료 한도
    meetingFeePerPerson: 50000,     // 1인당 회의비 한도
    salaryCapRatio: 0.30,           // 인건비 상한 비율 (총사업비 대비)
    withholdingRate: 0.088,         // 기타소득 원천세율 (8.8%)
    guidelinesPath: path.join(guidelinesRoot, '보조금/e나라도움/KHIDI/디지털헬스케어.md'),
  },

  '지역책임의료기관': {
    legalBasis: '보조금',
    system: 'enaradomum',
    agency: 'KHIDI',
    consultFeeLimit: 400000,
    meetingFeePerPerson: 50000,
    salaryCapRatio: 0.30,
    withholdingRate: 0.088,
    guidelinesPath: path.join(guidelinesRoot, '보조금/e나라도움/KHIDI/지역책임의료기관.md'),
  },

  '캠퍼스타운': {
    legalBasis: '보조금',
    system: 'botame',
    consultFeeLimit: 500000,
    meetingFeePerPerson: 50000,
    salaryCapRatio: 0.30,
    withholdingRate: 0.088,
    guidelinesPath: path.join(guidelinesRoot, '보조금/보탬e/common.md'),
  },

  '국산의료기기교육훈련': {
    legalBasis: '보조금',
    system: 'enaradomum',
    agency: 'KHIDI',
    consultFeeLimit: 400000,        // 자문수당 3시간 초과 400,000원 (1일 한도 명시 없음)
    meetingFeePerPerson: 30000,     // 별표2 불인정: 1인당 3만원 초과 (별표1은 5만원, 보수적 적용)
    salaryCapRatio: 0.30,           // 명시적 상한 없으나 기본값 적용
    withholdingRate: 0.088,
    mealFeePerPerson: 30000,        // 식사비 1인당 30,000원 이하
    assetAcquisitionCap: 0.40,      // 유형자산취득비 정부지원금의 40% 초과 불가
    medicalDeviceAssetCap: 0.30,    // 교육훈련용 의료기기 30% 이내
    aliases: ['국산의료기기 교육훈련지원센터', '국산의료기기 교육훈련 지원센터'],
    guidelinesPath: path.join(guidelinesRoot, '보조금/e나라도움/KHIDI/국산의료기기교육훈련.md'),
  },

  '사용자임상평가': {
    legalBasis: '보조금',
    system: 'enaradomum',
    agency: 'KHIDI',
    consultFeeLimit: 400000,        // 자문수당 3시간 초과 400,000원
    meetingFeePerPerson: 50000,     // 별표1+별표2 동일: 1인당 5만원
    salaryCapRatio: 0.50,           // 주관기업+참여기관 인건비 합 ≤ 총 예산의 50%
    withholdingRate: 0.088,
    mealFeePerPerson: 50000,        // 식사비 1인당 50,000원 이내
    researchAllowanceRatio: 0.20,   // 연구수당 총 인건비의 20% 이내
    researchAllowanceCap: 10000000, // 연구수당 총액 1천만원 이내 권고
    serviceContractRatio: 0.80,     // 일반용역비 총 예산의 80% 내외
    aliases: ['사용자 임상평가 지원사업', '사용자 임상평가'],
    guidelinesPath: path.join(guidelinesRoot, '보조금/e나라도움/KHIDI/사용자임상평가.md'),
  },

  // ============================================================
  // 페이퍼정산 — 엑셀+PDF 기반 (웹 시스템 없음)
  // ============================================================

  '페이퍼-템플릿': {
    legalBasis: '보조금',
    system: 'paper',
    consultFeeLimit: 600000,
    meetingFeePerPerson: 50000,
    salaryCapRatio: 0.30,
    withholdingRate: 0.088,
    evidenceStrategy: 'folder',     // 'folder' | 'filename'
    guidelinesPath: path.join(guidelinesRoot, '보조금/페이퍼정산/common.md'),
  },

  // ============================================================
  // 이지바로 (혁신법) — 국가R&D 과제
  // ============================================================

  '이지바로-공통': {
    legalBasis: '혁신법',
    system: 'ezbaro',
    withholdingRate: 0.088,         // 기타소득 원천세율 (8.8%)
    researchAllowanceRatio: 0.20,   // 연구수당: 수정인건비의 20% 이내 (고시 제26조①)
    researchAllowanceMaxPerPerson: 0.70, // 연구수당 1인 70% 초과 불가 (고시 제26조⑥)
    equipmentRegistrationCap: 30000000,  // 3천만원 이상 ZEUS 등록 필수
    delegationCap: 0.40,            // 위탁연구개발비: 직접비의 40% 이내
    equipmentDeadlineMonths: 2,     // 연구시설장비 종료 2개월 전 구입완료
    researchAllowanceDeadlineDays: 30, // 연구수당 단계종료 후 1개월 이내
    criteriaPath: path.join(__dirname, '..', '..', 'projects', '이지바로-공통', 'criteria-v2.md'),
    guidelinesPath: path.join(guidelinesRoot, '혁신법/이지바로/common.md'),
  },

  '이지바로-농림식품': {
    legalBasis: '혁신법',
    system: 'ezbaro',
    agency: '농림식품기술기획평가원',
    withholdingRate: 0.088,
    researchAllowanceRatio: 0.20,
    researchAllowanceMaxPerPerson: 0.70,
    equipmentRegistrationCap: 30000000,
    delegationCap: 0.40,
    aliases: ['농림식품기술기획평가원', '농림식품', '동물용의약품국산화', '노지스마트', '차세대 융합'],
    criteriaPath: path.join(__dirname, '..', '..', 'projects', '이지바로-공통', 'criteria-v2.md'),
    guidelinesPath: path.join(guidelinesRoot, '혁신법/이지바로/common.md'),
  },

  '이지바로-국토교통': {
    legalBasis: '혁신법',
    system: 'ezbaro',
    agency: '국토교통과학기술진흥원',
    withholdingRate: 0.088,
    researchAllowanceRatio: 0.20,
    researchAllowanceMaxPerPerson: 0.70,
    equipmentRegistrationCap: 30000000,
    delegationCap: 0.40,
    aliases: ['국토교통과학기술진흥원', '국토교통', '국토정보고도화', '국토교통 데이터'],
    criteriaPath: path.join(__dirname, '..', '..', 'projects', '이지바로-공통', 'criteria-v2.md'),
    guidelinesPath: path.join(guidelinesRoot, '혁신법/이지바로/common.md'),
  },

  '이지바로-범부처재생의료': {
    legalBasis: '혁신법',
    system: 'ezbaro',
    agency: '범부처재생의료기술개발사업단',
    withholdingRate: 0.088,
    researchAllowanceRatio: 0.20,
    researchAllowanceMaxPerPerson: 0.70,
    equipmentRegistrationCap: 30000000,
    delegationCap: 0.40,
    aliases: ['범부처재생의료기술개발사업단', '범부처재생', '범부처재생의료'],
    criteriaPath: path.join(__dirname, '..', '..', 'projects', '이지바로-공통', 'criteria-v2.md'),
    guidelinesPath: path.join(guidelinesRoot, '혁신법/이지바로/common.md'),
  },

  '이지바로-국가신약': {
    legalBasis: '혁신법',
    system: 'ezbaro',
    agency: '국가신약개발재단',
    withholdingRate: 0.088,
    researchAllowanceRatio: 0.20,
    researchAllowanceMaxPerPerson: 0.70,
    equipmentRegistrationCap: 30000000,
    delegationCap: 0.40,
    aliases: ['국가신약개발재단', '국가신약', '국가신약개발사업단'],
    criteriaPath: path.join(__dirname, '..', '..', 'projects', '이지바로-공통', 'criteria-v2.md'),
    guidelinesPath: path.join(guidelinesRoot, '혁신법/이지바로/common.md'),
  },

  '이지바로-KHIDI': {
    legalBasis: '혁신법',
    system: 'ezbaro',
    agency: 'KHIDI',
    withholdingRate: 0.088,
    researchAllowanceRatio: 0.20,
    researchAllowanceMaxPerPerson: 0.70,
    equipmentRegistrationCap: 30000000,
    delegationCap: 0.40,
    aliases: ['한국보건산업진흥원'],
    criteriaPath: path.join(__dirname, '..', '..', 'projects', '이지바로-공통', 'criteria-v2.md'),
    guidelinesPath: path.join(guidelinesRoot, '혁신법/이지바로/common.md'),
  },
};

function getConfig(projectName, overrides = {}) {
  // 직접 매칭
  let base = configs[projectName];
  // alias 매칭
  if (!base) {
    for (const [key, cfg] of Object.entries(configs)) {
      if (cfg.aliases && cfg.aliases.some(a => projectName.includes(a) || a.includes(projectName))) {
        base = cfg;
        break;
      }
    }
  }
  if (!base) {
    console.warn(`[configs] "${projectName}" 설정 없음 — 기본값 사용`);
    // 시스템 자동 감지
    const isEzbaro = projectName.includes('이지바로') || overrides.system === 'ezbaro';
    const isPaper = projectName.includes('페이퍼') || overrides.system === 'paper';
    return {
      legalBasis: isEzbaro ? '혁신법' : '보조금',
      system: isEzbaro ? 'ezbaro' : isPaper ? 'paper' : 'unknown',
      evidenceStrategy: isPaper ? 'folder' : undefined,
      consultFeeLimit: 600000,
      meetingFeePerPerson: 50000,
      salaryCapRatio: 0.30,
      withholdingRate: 0.088,
      researchAllowanceRatio: 0.20,
      researchAllowanceMaxPerPerson: 0.70,
      ...overrides,
    };
  }
  return { ...base, ...overrides };
}

function listConfigs() {
  return Object.keys(configs);
}

module.exports = { getConfig, listConfigs, configs };
