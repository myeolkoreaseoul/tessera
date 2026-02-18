/**
 * 내부인건비 흡수 식별 + 필수 증빙 확인
 *
 * 기관이 자기 자신에게 인건비를 지급하는 형태 (일반회계→사업비 환입).
 * 구조 자체는 합법이나 산출근거 증빙이 반드시 필요.
 *
 * 근거: guidelines/common.md §1.2
 * 적용: 모든 정산 (회계 구조)
 */
const { hasFileByName, hasFileByContent } = require('../../utils');

module.exports = {
  id: 'internal-salary',
  name: '내부인건비 흡수 검토',
  scope: 'common',
  phase: 'cross-row',

  analyze(rows, config) {
    const results = {};
    const instName = (config.institutionName || '').replace(/\s/g, '');

    // 1) 내부인건비 흡수 건 식별
    const internalRows = rows.filter(r => {
      const p = (r.purpose || '').toLowerCase();
      const vendor = (r.vendorName || '').replace(/\s/g, '');
      const cat = r.budgetCategory || '';

      // 핵심: purpose에 "내부인건비" 또는 "흡수"가 반드시 있어야 함
      // 위촉직 급여, 일용임금 등은 vendorName=기관이어도 내부인건비 흡수가 아님
      const isPurposeMatch = /내부인건비|인건비\s*흡수|흡수/.test(p);

      return isPurposeMatch && r.totalAmount > 0;
    });

    if (internalRows.length === 0) return results;

    // 2) 월별 반복 패턴 감지
    const monthPattern = internalRows.length >= 3;  // 3건 이상이면 반복 패턴

    // 3) 각 건별 증빙 확인
    const requiredDocs = [
      { key: '참여인력명단', keywords: ['참여인력', '명단', '참여율'] },
      { key: '급여대장', keywords: ['급여대장', '급여 대장', '급여명세', '급여지급'] },
      { key: '4대보험', keywords: ['4대보험', '건강보험', '국민연금', '고용보험', '산재보험'] },
    ];

    for (const row of internalRows) {
      const files = row.files || [];
      const allText = files.map(f => f.text || '').join('\n');
      const missingDocs = [];

      for (const doc of requiredDocs) {
        const found =
          hasFileByName(files, ...doc.keywords) ||
          doc.keywords.some(kw => allText.includes(kw));
        if (!found) missingDocs.push(doc.key);
      }

      const flags = [];
      if (missingDocs.length > 0) {
        flags.push('내부인건비_산출근거_미비');
      }

      results[row.rowNum] = {
        flags,
        fields: {
          type: '내부인건비흡수',
          monthlyPattern: monthPattern,
          missingDocs,
          fileCount: files.length,
        },
      };
    }

    return results;
  },
};
