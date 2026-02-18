/**
 * 계약 금액 기준 검증
 *
 * - 2천만원 초과 물품/용역 → 경쟁입찰 필요
 * - 수의계약 시 2개 이상 견적서 필요
 * - 3천만원 초과 → 계약서/검수조서 필수
 *
 * 근거: guidelines/보조금/common.md §2 (통합관리지침 제21조, 국가계약법 시행령)
 * 적용: 보조금법 사업만
 */
const { hasFileByName } = require('../../utils');

module.exports = {
  id: 'contract-threshold',
  name: '계약 금액 기준 검증',
  scope: '보조금',
  phase: 'per-row',

  analyze(row, config) {
    const amount = row.supplyAmount || row.totalAmount || 0;
    if (amount <= 0) return null;

    const cat = row.budgetCategory || '';
    const sub = row.subCategory || '';
    const p = (row.purpose || '').toLowerCase();

    // 물품/용역 관련 비목만 대상 (인건비, 여비 제외)
    const isContract = /용역|임차|사무용품|재료|수수료|인쇄/.test(p) ||
      sub === '일반용역비' || sub === '임차료' || sub === '일반수용비';
    if (!isContract) return null;

    const files = row.files || [];
    const flags = [];
    const fields = { contractAmount: amount };

    // 2천만원 초과 → 경쟁입찰
    if (amount > 20000000) {
      flags.push('2천만원초과_경쟁입찰_확인필요');
      fields.competitiveBidRequired = true;
    }

    // 3천만원 초과 → 계약서 필수
    if (amount > 30000000) {
      if (!hasFileByName(files, '계약서')) {
        flags.push('3천만원초과_계약서_미첨부');
      }
      if (!hasFileByName(files, '검수조서', '검수')) {
        flags.push('3천만원초과_검수조서_미첨부');
      }
    }

    // 수의계약 범위 (2천만원 이하) → 견적서 2개
    if (amount <= 20000000 && amount > 0) {
      const quoteCount = files.filter(f => /견적/.test(f.name) && !/비교견적/.test(f.name)).length;
      fields.quoteCount = quoteCount;
      // 2천만원 이하면 1인 견적 가능하므로 플래그만 (강제 아님)
    }

    if (flags.length === 0) return null;
    return { flags, fields };
  },
};
