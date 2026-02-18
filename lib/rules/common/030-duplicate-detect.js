/**
 * 재원변경 재집행 중복건 식별
 *
 * 동일 지출결의서 번호가 다른 rowNum에 중복 등장하는 경우:
 * 원래 집행 취소 → 재원 변경 → 재집행. 이중 계상이 아님.
 *
 * 근거: guidelines/common.md §1.5
 * 적용: 모든 정산
 */
module.exports = {
  id: 'duplicate-detect',
  name: '재원변경 재집행 중복 식별',
  scope: 'common',
  phase: 'cross-row',

  analyze(rows, config) {
    const results = {};

    // 1) OCR 텍스트에서 지출결의서 번호 추출
    const docIdPattern = /(?:결의번호|결의서\s*번호|지출결의)\s*[:#]?\s*(\d{5,10})/g;

    const rowDocIds = {};  // rowNum → [docId, ...]
    for (const row of rows) {
      const allText = (row.files || []).map(f => f.text || '').join('\n');
      const ids = new Set();
      let m;
      while ((m = docIdPattern.exec(allText)) !== null) {
        ids.add(m[1]);
      }
      docIdPattern.lastIndex = 0;  // reset regex state
      if (ids.size > 0) {
        rowDocIds[row.rowNum] = [...ids];
      }
    }

    // 2) 동일 결의서 번호 그룹핑
    const docIdToRows = {};  // docId → [rowNum, ...]
    for (const [rowNum, docIds] of Object.entries(rowDocIds)) {
      for (const id of docIds) {
        if (!docIdToRows[id]) docIdToRows[id] = [];
        docIdToRows[id].push(parseInt(rowNum));
      }
    }

    // 3) 중복 그룹 (2건 이상 같은 결의서 번호)
    for (const [docId, rowNums] of Object.entries(docIdToRows)) {
      if (rowNums.length < 2) continue;

      // 금액과 purpose도 비슷한지 확인
      const rowData = rowNums.map(rn => rows.find(r => r.rowNum === rn)).filter(Boolean);

      // 같은 금액 + 같은 purpose → 재원변경 확실
      const amounts = rowData.map(r => r.totalAmount);
      const purposes = rowData.map(r => (r.purpose || '').replace(/\d{4}\.\d{2}/g, '').trim());
      const sameAmount = new Set(amounts).size === 1;
      const samePurpose = new Set(purposes).size === 1;

      if (sameAmount || samePurpose) {
        const primary = rowNums[0];  // 첫 번째가 원본
        for (let i = 1; i < rowNums.length; i++) {
          results[rowNums[i]] = {
            flags: ['재원변경_중복건'],
            fields: {
              duplicateOf: primary,
              docId,
              reason: '재원변경 재집행 (동일 지출결의서)',
            },
          };
        }
        // 원본에도 표시
        if (!results[primary]) {
          results[primary] = {
            flags: [],
            fields: { hasDuplicates: rowNums.slice(1), docId },
          };
        }
      }
    }

    return results;
  },
};
