/**
 * 증빙 완전 부재 감지
 *
 * files=0 + evidenceSub="" + 시스템 내장 증빙 없음 → 증빙 없음
 *
 * 적용: 모든 정산
 */
module.exports = {
  id: 'no-evidence',
  name: '증빙 완전 부재',
  scope: 'common',
  phase: 'per-row',

  analyze(row, config) {
    const files = row.files || [];
    const evidenceSub = row.evidenceSub || '';
    const evidenceType = row.evidenceType || '';

    if (row.totalAmount <= 0) return null;

    // 시스템 내장 증빙 (카드전표, 세금계산서)
    const hasSystemEvidence =
      evidenceType === '보조금전용카드' ||
      evidenceType === '전자세금계산서' ||
      evidenceType === '전자계산서' ||
      /소득\s*지급명세서/.test(evidenceSub);

    if (files.length === 0 && !hasSystemEvidence && evidenceSub === '') {
      return {
        flags: ['증빙_완전부재'],
        fields: { noEvidence: true },
      };
    }

    return null;
  },
};
