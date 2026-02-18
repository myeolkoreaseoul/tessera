/**
 * 0원 항목 (취소전표) 자동 SKIP
 *
 * 적용: 모든 정산
 */
module.exports = {
  id: 'zero-amount',
  name: '0원 항목 SKIP',
  scope: 'common',
  phase: 'per-row',

  analyze(row, config) {
    if (row.totalAmount === 0) {
      return {
        flags: ['SKIP_0원'],
        fields: { type: '취소전표', skipReason: '0원 항목' },
      };
    }
    return null;
  },
};
