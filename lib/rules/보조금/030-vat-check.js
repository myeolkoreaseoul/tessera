/**
 * 부가세 포함 집행 체크
 *
 * 환급받을 수 있는 부가세를 집행액에 포함하면 불인정.
 *
 * 근거: guidelines/보조금/common.md §3.1 8번 (정산보고서 작성지침 제5조)
 * 적용: 보조금법 사업
 */
module.exports = {
  id: 'vat-included',
  name: '부가세 포함 집행 확인',
  scope: '보조금',
  phase: 'per-row',

  analyze(row, config) {
    // supply > 0, vat > 0, total = supply + vat → 부가세 포함 집행
    if (row.vat > 0 && row.supplyAmount > 0 &&
        row.totalAmount === row.supplyAmount + row.vat) {
      return {
        flags: ['부가세_포함_집행'],
        fields: {
          vat: row.vat,
          supplyAmount: row.supplyAmount,
        },
      };
    }
    return null;
  },
};
