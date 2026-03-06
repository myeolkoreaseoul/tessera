/**
 * normalize.js — 시스템별 data.json → 표준 포맷 변환
 *
 * 각 시스템(e나라도움, 보탬e, 이지바로, 페이퍼) 고유 필드명을
 * 공통 스키마로 정규화.
 *
 * deep-analyze.js는 이 표준 포맷에서만 동작.
 */

/**
 * e나라도움 data.json → 표준 포맷
 * 현재 data.json이 이미 거의 표준에 가까움 — 필드명 매핑만 수행
 */
function fromEnaradomum(rows, meta = {}) {
  return rows.map(r => ({
    // 기존 필드 유지 (하위호환)
    ...r,
    // 표준 필드 보장
    rowNum: r.rowNum,
    date: r.executionDate || r.registDate || '',
    purpose: r.purpose || '',
    budgetCategory: r.budgetCategory || '',
    subCategory: r.subCategory || '',
    amount: r.totalAmount || 0,
    totalAmount: r.totalAmount || 0,
    supplyAmount: r.supplyAmount || 0,
    vat: r.vat || 0,
    vendor: r.vendorName || '',
    vendorName: r.vendorName || '',
    depositor: r.depositorName || '',
    depositorName: r.depositorName || '',
    evidenceType: r.evidenceType || '',
    evidenceSub: r.evidenceSub || '',
    files: r.files || [],
    // 메타
    source: 'enaradomum',
    legalBasis: meta.legalBasis || '보조금',
    project: meta.project || '',
    institution: meta.institution || '',
  }));
}

/**
 * 보탬e data.json → 표준 포맷
 * TODO: 보탬e 수집 구현 후 필드 매핑 확정
 */
function fromBotame(rows, meta = {}) {
  return rows.map(r => ({
    ...r,
    rowNum: r.rowNum || r.순번 || 0,
    date: r.집행일자 || r.executionDate || '',
    purpose: r.집행용도 || r.purpose || '',
    budgetCategory: r.비목 || r.budgetCategory || '',
    subCategory: r.세목 || r.subCategory || '',
    amount: r.집행금액 || r.totalAmount || 0,
    totalAmount: r.집행금액 || r.totalAmount || 0,
    supplyAmount: r.공급가액 || r.supplyAmount || 0,
    vat: r.부가세 || r.vat || 0,
    vendor: r.거래처명 || r.vendorName || '',
    vendorName: r.거래처명 || r.vendorName || '',
    depositor: r.입금자명 || r.depositorName || '',
    depositorName: r.입금자명 || r.depositorName || '',
    evidenceType: r.증빙유형 || r.evidenceType || '',
    evidenceSub: r.증빙상세 || r.evidenceSub || '',
    files: r.files || [],
    source: 'botame',
    legalBasis: meta.legalBasis || '보조금',
    project: meta.project || '',
    institution: meta.institution || '',
  }));
}

/**
 * 페이퍼정산 Excel → 표준 포맷
 * read-paper-excel.js가 이미 표준 필드명으로 변환하므로 보완만 수행
 */
function fromPaper(rows, meta = {}) {
  return rows.map(r => ({
    ...r,
    rowNum: r.rowNum || 0,
    date: r.date || '',
    purpose: r.purpose || '',
    budgetCategory: r.budgetCategory || '',
    subCategory: r.subCategory || '',
    amount: r.amount || r.totalAmount || 0,
    totalAmount: r.totalAmount || r.amount || 0,
    supplyAmount: r.supplyAmount || 0,
    vat: r.vat || 0,
    vendor: r.vendorName || r.vendor || '',
    vendorName: r.vendorName || r.vendor || '',
    depositor: '',
    depositorName: '',
    evidenceType: '페이퍼',
    evidenceSub: '',
    files: r.files || [],
    memo: r.memo || '',
    source: 'paper',
    legalBasis: meta.legalBasis || '보조금',
    project: meta.project || '',
    institution: meta.institution || '',
  }));
}

/**
 * 자동 감지 정규화
 * source 필드가 있으면 그에 맞게, 없으면 필드명으로 추정
 */
function normalize(rows, meta = {}) {
  if (!rows || rows.length === 0) return [];

  const source = meta.source || meta.system || '';
  if (source === 'enaradomum' || source === 'e나라도움') return fromEnaradomum(rows, meta);
  if (source === 'botame' || source === '보탬e') return fromBotame(rows, meta);
  if (source === 'paper' || source === '페이퍼') return fromPaper(rows, meta);

  // 자동 감지: e나라도움 필드 존재 여부
  const sample = rows[0];
  if (sample.executionDate !== undefined || sample.evidenceType !== undefined) {
    return fromEnaradomum(rows, meta);
  }
  if (sample.집행일자 !== undefined || sample.거래처명 !== undefined) {
    return fromBotame(rows, meta);
  }

  // 기본: 그대로 반환 (이미 표준이거나 알 수 없는 포맷)
  console.warn('[normalize] 시스템 자동감지 실패 — 원본 반환');
  return rows.map(r => ({ ...r, source: 'unknown', ...meta }));
}

module.exports = { normalize, fromEnaradomum, fromBotame, fromPaper };
