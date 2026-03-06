/**
 * salary-check.js — 인건비 특화 검증 규칙 (세전/세후 논리)
 */
module.exports = {
  id: 'clinical-salary-check',
  name: '인건비 세전/세후 검증',
  scope: '보조금',
  phase: 'per-row',

  analyze(row, config) {
    // 1. 대상 필터링: 인건비, 급여, 상용임금 등
    const subCat = (row.subCategory || '').replace(/\s/g, '');
    if (!subCat.includes('인건비') && !subCat.includes('상용임금') && !subCat.includes('급여')) {
      return null;
    }

    const flags = [];
    const fields = {};

    // 2. 증빙 텍스트에서 금액 추출 (가장 큰 금액 = 세전 추정, 작은 금액 = 세후 추정)
    //    단, 단순 추출은 위험하므로 "실지급액", "차인지급액", "이체" 키워드 주변 숫자 탐색 필요
    
    // 간소화된 로직: 증빙 텍스트 내에 '집행금액(세전)'이 있거나 '이체금액(세후)'가 있는지 확인
    const execAmount = row.amount || row.totalAmount || 0;
    if (execAmount === 0) return null;

    let foundExactMatch = false;
    let foundNetMatch = false; // 세후 추정 금액 발견 여부
    let netAmountFound = 0;

    for (const file of row.files || []) {
      const text = (file.text || '').replace(/,/g, ''); // 콤마 제거
      
      // 집행금액(세전) 발견?
      if (text.includes(String(execAmount))) {
        foundExactMatch = true;
      }

      // 집행금액보다 작은 숫자들 중 '실수령', '차인', '이체', '입금' 키워드 근처의 숫자 탐색
      // (정규식: 키워드 뒤 100자 이내 숫자)
      const netKeywords = ['실수령', '차인지급', '이체', '입금', '지급액'];
      for (const kw of netKeywords) {
        const regex = new RegExp(`${kw}.{0,30}?(\\d{6,10})`, 'g'); // 10만~xx억 단위
        let match;
        while ((match = regex.exec(text)) !== null) {
          const val = parseInt(match[1]);
          // 집행금액보다 작고, 70% 이상이면 세후 금액일 가능성 높음
          if (val < execAmount && val > execAmount * 0.7) {
            foundNetMatch = true;
            netAmountFound = val;
          }
        }
      }
    }

    // 3. 판정 로직
    if (foundExactMatch) {
      // 세전 금액이 증빙에 있음.
      // 추가 검증: 실수령액이 집행액보다 큰지 체크 (과다지급)
       for (const file of row.files || []) {
        const text = file.text || '';
        const netKeywords = ['실수령', '차인지급', '이체', '입금', '지급액'];
        
        for (const kw of netKeywords) {
          let searchPos = 0;
          while (true) {
            const idx = text.indexOf(kw, searchPos);
            if (idx === -1) break;
            
            // 키워드 뒤 50자 내에서 금액(천원 단위 이상) 탐색
            const sub = text.substring(idx, idx + 50);
            // 관대한 숫자 매칭 (콤마 포함)
            const moneyMatch = sub.match(/[0-9,]+/);
            
            if (moneyMatch) {
              const val = parseInt(moneyMatch[0].replace(/,/g, ''));
              
              // 1000원 이상이고 집행액보다 크면 (소액 오차 무시 없이 엄격하게)
              if (val > 1000 && val > execAmount) {
                // 오탐 방지: 파일 내에 수령인(vendorName) 이름이 있는지 확인
                // (다른 사람의 급여명세서가 섞여 들어온 경우 방지)
                const vendorName = (row.vendorName || '').replace(/\s/g, '');
                if (vendorName && !text.includes(vendorName)) {
                   // 수령인 이름이 없으면 이 숫자는 무시 (남의 것일 수 있음)
                   searchPos = idx + 1;
                   continue;
                }

                const flagMsg = `과다지급의심(증빙:${val.toLocaleString()})`;
                if (!flags.includes(flagMsg)) {
                  flags.push(flagMsg);
                  fields.overPaid = val;
                }
              }
            }
            searchPos = idx + 1;
          }
        }
      }
    } else if (foundNetMatch) {
      // 세전 금액은 없지만, 세후 추정 금액이 발견됨 -> "세후지급확인" 플래그 (Gemini에게 힌트)
      flags.push(`세후지급의심(이체액:${netAmountFound.toLocaleString()})`);
      fields.netAmount = netAmountFound;
    } else if ((row.files || []).length > 0) {
      // 파일은 있는데 금액이 아예 안 맞음
      flags.push('인건비_금액미확인');
    }

    // 4. 필수 증빙 키워드 체크
    const allText = (row.files || []).map(f => f.text).join(' ');
    // 급여명세서도 대장에 준하는 증빙으로 인정
    if (!allText.includes('급여') && !allText.includes('명세서') && !allText.includes('대장')) {
      flags.push('급여대장_미발견');
    }
    if (!allText.includes('이체') && !allText.includes('확인증') && !allText.includes('출금') && !allText.includes('보낸분')) {
      flags.push('이체증_미발견');
    }

    return { flags, fields };
  }
};
