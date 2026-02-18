/**
 * 보조금전용카드 사용 확인
 *
 * 보조사업비카드 외 카드(개인카드, 법인카드 등) 사용 → 불인정 대상.
 * 단, 카드 발급 전 법인카드/개인카드 일시 사용은 예외.
 *
 * 근거: guidelines/보조금/common.md §1.2 (통합관리지침 제18조, 제19조)
 * 적용: 보조금법 사업만
 */
module.exports = {
  id: 'subsidy-card-usage',
  name: '보조금전용카드 사용 확인',
  scope: '보조금',
  phase: 'per-row',

  analyze(row, config) {
    const evidenceType = row.evidenceType || '';

    // 카드 결제인데 보조금전용카드가 아닌 경우
    if (/카드/.test(evidenceType) && evidenceType !== '보조금전용카드') {
      return {
        flags: ['보조금전용카드_외_카드사용'],
        fields: { cardType: evidenceType },
      };
    }

    return null;
  },
};
