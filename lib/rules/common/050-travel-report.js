/**
 * 출장복명서 vs 출장신청서 판별
 *
 * 불인정 기준: "출장복명서가 없거나 출장목적이 명확하지 않은 여비" (OR 조건)
 * 출장신청서 ≠ 출장복명서. 복명서(결과보고) 섹션 존재 여부 확인.
 *
 * 근거: guidelines/common.md §1.4
 * 적용: 모든 정산 (행정 원칙)
 */
const { hasFileByName, hasFileByContent } = require('../../utils');

module.exports = {
  id: 'travel-report',
  name: '출장복명서 판별',
  scope: 'common',
  phase: 'per-row',

  analyze(row, config) {
    const p = (row.purpose || '').toLowerCase();
    const cat = row.budgetCategory || '';
    const sub = row.subCategory || '';

    // 여비 건만 대상
    const isTravel = sub === '국내여비' || sub === '국외여비' ||
      /출장/.test(p) || cat === '여비';
    if (!isTravel) return null;
    if (row.totalAmount <= 0) return null;

    // 교통비 부속건은 제외 (본 출장건에서 확인)
    if (/교통비|기차표/.test(p) && !/출장/.test(p)) return null;

    const files = row.files || [];

    // 1) 파일명에 "복명" 포함
    const hasReturnReportByName = hasFileByName(files, '복명', '결과보고', '출장결과');

    // 2) 파일명에 "출장" 있지만 "신청"만 → OCR에서 복명 키워드 검색
    const hasReturnReportByContent = hasFileByContent(files,
      '복명', '출장결과', '출장보고', '결과보고', '복명사항', '출장 결과');

    // 3) 지출결의서 내에 복명서 섹션이 포함된 경우 (통합 서식)
    const hasIntegratedForm = hasFileByContent(files,
      '복명서', '출장복명', '결과 보고');

    const hasReturnReport = hasReturnReportByName || hasReturnReportByContent || hasIntegratedForm;

    // 출장신청서만 있는지
    const hasApplicationOnly = hasFileByName(files, '출장', '신청') && !hasReturnReport;

    // 출장목적 명확성
    const purposeClear = /진도점검|연차평가|학회|세미나|워크숍|방문|현장|미팅|회의|발표|심사/.test(p);

    const flags = [];
    if (!hasReturnReport) {
      flags.push('출장복명서_미첨부');
    }
    if (hasApplicationOnly) {
      flags.push('출장신청서만_존재');
    }

    return {
      flags,
      fields: {
        type: '여비',
        hasReturnReport,
        hasApplicationOnly,
        purposeClear,
      },
    };
  },
};
