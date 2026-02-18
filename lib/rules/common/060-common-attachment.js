/**
 * 공용첨부파일 플래그
 *
 * files=0이지만 시스템에 공용첨부파일이 존재할 수 있는 경우.
 * e나라도움의 cmnuseAtchmnflId, 이지바로의 유사 구조 등.
 *
 * 근거: guidelines/common.md §1.6
 * 적용: 시스템 기반 정산 (e나라도움, 이지바로 등)
 */
module.exports = {
  id: 'common-attachment',
  name: '공용첨부파일 플래그',
  scope: 'common',
  phase: 'per-row',

  analyze(row, config) {
    const files = row.files || [];

    // 개별 파일이 0개이고, 공용첨부 ID가 있는 경우
    if (files.length === 0 && row.cmnuseAtchmnflId) {
      return {
        flags: ['공용첨부파일_미수집'],
        fields: {
          hasCommonAttachment: true,
          cmnuseAtchmnflId: row.cmnuseAtchmnflId,
        },
      };
    }

    // evidenceSub가 있는데 files가 없는 경우
    if (files.length === 0 && row.evidenceSub && row.evidenceSub !== '') {
      // evidenceSub에 "소득 지급명세서" 등 시스템 내장 증빙이면 OK
      if (/소득\s*지급명세서/.test(row.evidenceSub)) {
        return {
          flags: [],
          fields: { systemBuiltinEvidence: true },
        };
      }
    }

    return null;
  },
};
