/**
 * 자문료 교통비 역산
 *
 * 자문료 실지급액이 한도를 초과하는 것처럼 보일 때, 교통비가 합산되어 있을 수 있음.
 * 역산: 실지급액 ÷ (1 - 원천세율) = 세전 총액 → 세전 - 한도 = 교통비 추정
 *
 * 근거: guidelines/common.md §1.3
 * 적용: 모든 정산 (세법 기반)
 */
const { hasFileByName, hasFileByContent } = require('../../utils');

module.exports = {
  id: 'consult-fee-calc',
  name: '자문료 교통비 역산',
  scope: 'common',
  phase: 'per-row',

  analyze(row, config) {
    const p = (row.purpose || '').toLowerCase();
    const sub = row.subCategory || '';

    // 자문료 건만 대상
    const isConsult = /자문료|자문수당|자문비|전문가활용비|전문가자문|평가사례비/.test(p);
    if (!isConsult) return null;
    if (row.totalAmount <= 0) return null;
    if (/원천세/.test(p)) return null;  // 원천세 건 제외

    const RATE = config.withholdingRate || 0.088;
    const LIMIT = config.consultFeeLimit || 600000;

    // 기타소득 원천세 역산 (8.8%)
    const netAmount = row.totalAmount;
    const grossAmount = Math.round(netAmount / (1 - RATE));
    const estimatedTransport = grossAmount > LIMIT ? grossAmount - LIMIT : 0;

    // 교통비 영수증 존재 여부
    const files = row.files || [];
    const hasTransportReceipt =
      hasFileByName(files, '교통비', 'KTX', '기차표', '열차', '택시') ||
      hasFileByContent(files, 'KTX', '코레일', '열차승차권', '택시영수증');

    // 지출발의서에 산출근거 명시 여부
    const hasBreakdown = hasFileByContent(files, '교통비', '자문수당.*교통비', '교통비.*합산');

    const flags = [];
    const fields = {
      type: '자문료',
      netAmount,
      grossAmount,
      consultFeeLimit: LIMIT,
      estimatedTransport,
      hasTransportReceipt,
      hasBreakdown,
    };

    if (estimatedTransport > 0) {
      if (hasTransportReceipt) {
        flags.push('자문료_교통비합산_영수증있음');  // 적정이나 비목분류 보완요청 가능
      } else {
        flags.push('자문료_한도초과_교통비영수증_없음');
      }
    }

    if (grossAmount > LIMIT && estimatedTransport === 0) {
      // 한도 이하인데 세전이 한도 근처
      // 교통비 없이 순수 자문료만으로 한도 이내
    }

    return { flags, fields };
  },
};
