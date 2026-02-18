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
};

function getConfig(projectName, overrides = {}) {
  const base = configs[projectName];
  if (!base) {
    console.warn(`[configs] "${projectName}" 설정 없음 — 기본값 사용`);
    return {
      legalBasis: '보조금',
      system: 'unknown',
      consultFeeLimit: 600000,
      meetingFeePerPerson: 50000,
      salaryCapRatio: 0.30,
      withholdingRate: 0.088,
      ...overrides,
    };
  }
  return { ...base, ...overrides };
}

function listConfigs() {
  return Object.keys(configs);
}

module.exports = { getConfig, listConfigs, configs };
