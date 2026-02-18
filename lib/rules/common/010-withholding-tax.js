/**
 * 원천세 납부증빙 확인
 *
 * 원천세가 별도 집행건으로 등록된 경우, 납부 증빙(원천징수이행상황신고서 등)이
 * 첨부되어 있는지 확인. 또한 본건(자문료 등)과 쌍으로 연결.
 *
 * 근거: guidelines/common.md §1.1
 * 적용: 모든 정산 (세법 기반)
 */
const { hasFileByName, hasFileByContent } = require('../../utils');

module.exports = {
  id: 'withholding-tax',
  name: '원천세 납부증빙 확인',
  scope: 'common',
  phase: 'cross-row',

  analyze(rows, config) {
    const results = {};
    const RATE = config.withholdingRate || 0.088;

    // 1) 원천세 건 식별
    const taxRows = rows.filter(r =>
      /원천세/.test(r.purpose || '') &&
      r.totalAmount > 0
    );

    // 2) 각 원천세 건에 대해 본건 매칭
    for (const tax of taxRows) {
      // purpose에서 이름 추출: "원천세(김용진)" → "김용진"
      const nameMatch = (tax.purpose || '').match(/원천세\s*\(([^)]+)\)/);
      const personName = nameMatch ? nameMatch[1] : '';

      // 본건 후보: 같은 사람 이름 + 자문료/사례비 등 + 금액 비율 맞는 건
      let linkedRow = null;
      if (personName) {
        const candidates = rows.filter(r =>
          r.rowNum !== tax.rowNum &&
          (r.vendorName || '').includes(personName) &&
          !/원천세/.test(r.purpose || '') &&
          r.totalAmount > 0
        );

        // 금액 비율 검증: 본건 실지급액 × RATE ≈ 원천세액
        for (const c of candidates) {
          const expectedTax = Math.round((c.totalAmount / (1 - RATE)) * RATE);
          const tolerance = Math.max(expectedTax * 0.05, 100); // 5% 또는 100원 허용
          if (Math.abs(tax.totalAmount - expectedTax) <= tolerance) {
            linkedRow = c;
            break;
          }
        }

        // 비율 안 맞아도 이름 매칭이면 연결
        if (!linkedRow && candidates.length > 0) {
          linkedRow = candidates[0];
        }
      }

      // 3) 납부 증빙 확인
      const hasTaxProof =
        hasFileByName(tax.files || [], '납부', '신고서', '원천징수이행') ||
        hasFileByContent(tax.files || [], '원천징수이행상황신고서', '납부확인서', '홈택스');

      const flags = [];
      const fields = {
        type: '원천세',
        personName,
        linkedTo: linkedRow ? linkedRow.rowNum : null,
        taxPaymentProof: hasTaxProof,
      };

      if (!hasTaxProof) {
        flags.push('원천세_납부증빙_미첨부');
      }

      results[tax.rowNum] = { flags, fields };

      // 본건에도 원천세 연결 정보 추가
      if (linkedRow && !results[linkedRow.rowNum]) {
        results[linkedRow.rowNum] = {
          flags: [],
          fields: { linkedWithholdingTax: tax.rowNum },
        };
      }
    }

    return results;
  },
};
