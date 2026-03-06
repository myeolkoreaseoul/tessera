/**
 * 경북대학교병원 31건 정산검토 judge
 * - 회의비 21건, 자문료 2건, 인건비 2건, 기관부담금 2건, 사무용품 1건, 소모성물품 1건, 노트북임차 1건
 */
const fs = require('fs');
const data = require('./knuh-data.json');

// === 유틸 ===
function hasFileByName(files, ...keywords) {
  return files.some(f => keywords.some(k => f.name.includes(k)));
}
function hasFileByContent(files, ...keywords) {
  return files.some(f => keywords.some(k => (f.text || '').includes(k)));
}
function getAllText(rec) {
  return rec.files.map(f => f.text || '').join('\n');
}

// 참석 인원 추출 (OCR 오류 감안, 유연한 패턴)
function extractParticipantCount(text) {
  let part = 0, intern = 0, ext = 0;

  // 참여인력(N명) - OCR 변형 대응
  const m1 = text.match(/참여인력\((\d{1,2})/);
  if (m1) part = parseInt(m1[1]);

  // 내부인력(N명) - OCR 변형: 내부인략, 개부인랙, 네부인력, 4부인력 등
  // 숫자 뒤에 @, 8, 명, ) 등 다양한 garble 허용
  const m2 = text.match(/[내개네4]부\s*인[력랙략]\(?(\d{1,2})/);
  if (m2 && parseInt(m2[1]) <= 10) {
    intern = parseInt(m2[1]);
  } else if (/[내개네4]부\s*인[력랙략]/.test(text) || /경북대학교병원\s*생명/.test(text)) {
    // 내부인력 언급은 있지만 숫자 garble → 최소 1명
    intern = 1;
  }

  // 외부인력(N명) - OCR 변형: 의부인력 등
  const m3 = text.match(/[외의]부인력\((\d{1,2})/);
  if (m3) ext = parseInt(m3[1]);

  // 대안: "부인력(N명)" 패턴 (내부/외부 구분 어려울 때)
  if (ext === 0 && intern === 0) {
    const mAlt = text.match(/부인력\((\d{1,2})명?\)/);
    if (mAlt) ext = parseInt(mAlt[1]);
  }

  // 외부인력 숫자 못 읽었지만 외부기관명이 보이면 카운트
  if (ext === 0) {
    const extOrgs = ['대구대학교', '대구대', '경북권역재활병원', '한영한마음', '해피아이',
      '건국대학교', '대구가톨릭', '가톨릭대'];
    const orgCount = extOrgs.filter(o => text.includes(o)).length;
    if (orgCount > 0) ext = Math.max(orgCount, 2); // 최소 2명 추정
  }

  let total = part + intern + ext;
  if (total > 0 && total < 20) {
    return { total, part, intern, ext, reliable: total >= 3 };
  }

  // 대안: 참석자명단에서 이름 패턴 카운트 (한글이름 2-3자 + 숫자/서명)
  const nameSection = text.substring(text.indexOf('참석자') || 0);
  const nameMatches = nameSection.match(/[가-힣]{2,3}\s*\d{2,}/g);
  if (nameMatches && nameMatches.length >= 2) {
    return { total: nameMatches.length, part: 0, intern: 0, ext: 0, estimated: true, reliable: false };
  }

  return null;
}

const ALCOHOL = ['맥주', '소주', '와인', '위스키', '사케', '주류', '막걸리', '하이볼',
  '칵테일', '보드카', '데킬라', '생맥주', '병맥주', 'beer', 'wine', 'soju',
  '참이슬', '처음처럼', '진로', '카스맥주', '하이트맥주', '테라맥주'];

function classifyType(rec) {
  const p = rec.purpose.toLowerCase();
  if (p.includes('자문료') || p.includes('자문비')) return '자문료';
  if (p.includes('기관부담금') || (p.includes('인건비') && p.includes('기관부담'))) return '기관부담금';
  if (p.includes('인건비')) return '인건비';
  if (p.includes('노트북') && p.includes('임차')) return '노트북임차';
  if (p.includes('회의비')) return '회의비';
  if (p.includes('사무용품')) return '사무용품';
  if (p.includes('소모성물품') || p.includes('소모성')) return '소모성물품';
  return '기타';
}

// === 메인 ===
const results = [];

for (const rec of data) {
  const type = classifyType(rec);
  const issues = [];
  const ok = [];
  const allText = getAllText(rec);

  // 공통: 첨부파일 유무
  if (rec.files.length === 0) {
    issues.push('첨부파일 없음 (증빙 미비)');
  }

  // --- 회의비 ---
  if (type === '회의비') {
    // 회의록
    if (rec.files.length > 0) {
      if (hasFileByName(rec.files, '회의록') || hasFileByContent(rec.files, '회의록', '회의 내용', '회의 목적')) {
        ok.push('회의록 첨부');
      } else {
        issues.push('회의록 미첨부');
      }

      // 영수증/카드
      if (hasFileByName(rec.files, '영수증', '카드') || hasFileByContent(rec.files, '영수증', '승인번호', '카드')) {
        ok.push('영수증 첨부');
      } else {
        issues.push('영수증 미첨부');
      }

      // 참석인원 & 1인 5만원 한도
      const pInfo = extractParticipantCount(allText);
      if (pInfo && pInfo.total > 0) {
        const perPerson = Math.round(rec.totalAmount / pInfo.total);
        if (perPerson > 50000) {
          if (pInfo.reliable !== false) {
            // 신뢰할 수 있는 인원 추출
            issues.push(`1인당 ${perPerson.toLocaleString()}원 (${pInfo.total}명) → 5만원 한도 초과`);
          } else {
            // OCR 인원 추출 불확실 → 검토 필요로만 표시
            issues.push(`OCR 참석인원 ${pInfo.total}명 추출 (불확실) → 1인당 금액 확인 필요`);
          }
        } else {
          ok.push(`참석 ${pInfo.total}명, 1인 ${perPerson.toLocaleString()}원`);
        }
      }

      // 외부참석자 확인
      const extPatterns = ['외부인력', '외부참석', '외부'];
      const hasExternal = extPatterns.some(p => allText.includes(p));
      const extOrgs = ['대구대학교', '대구대', '경북권역재활병원', '한영한마음', '해피아이',
        '건국대학교', '대구가톨릭', '가톨릭대', '칠곡경북대'];
      const hasExtOrg = extOrgs.some(o => allText.includes(o));
      if (hasExternal || hasExtOrg) {
        ok.push('외부참석자 확인');
      } else {
        issues.push('외부참석자 미확인 → 내부인력만으로 회의비 집행 의심');
      }

      // 주류 체크
      const lower = allText.toLowerCase();
      for (const kw of ALCOHOL) {
        if (lower.includes(kw)) {
          // 문맥 확인 (OCR 노이즈 제거)
          const idx = lower.indexOf(kw);
          const context = allText.substring(Math.max(0, idx - 20), idx + 30);
          if (!/보험|우편|배송|택배/.test(context)) {
            issues.push(`주류 의심: "${kw}" 발견`);
            break;
          }
        }
      }
    }
  }

  // --- 자문료 ---
  else if (type === '자문료') {
    // 자문확인서
    if (hasFileByName(rec.files, '자문확인서') || hasFileByContent(rec.files, '자문 확인서', '자문확인서', '자 문 확 인 서')) {
      ok.push('자문확인서 첨부');
    } else {
      issues.push('자문확인서 미첨부');
    }

    // 자문의견서(결과물)
    if (hasFileByName(rec.files, '자문의견서') || hasFileByContent(rec.files, '자문 의견서', '자문의견서', '자문의견')) {
      ok.push('자문의견서 첨부');
    } else {
      issues.push('자문의견서 미첨부');
    }

    // 지급명세서
    if (hasFileByName(rec.files, '지급명세서', '지급 명세서') || hasFileByContent(rec.files, '지급명세서', '지급 명세서')) {
      ok.push('지급명세서 첨부');
    } else {
      issues.push('지급명세서 미첨부');
    }

    // 단가 확인: 2시간 이하 20만원
    if (rec.totalAmount <= 200000) {
      ok.push(`자문료 ${rec.totalAmount.toLocaleString()}원 (한도 내)`);
    } else {
      issues.push(`자문료 ${rec.totalAmount.toLocaleString()}원 → 2시간 한도 20만원 초과 확인 필요`);
    }

    // 원천징수 확인 (기타소득 8.8%)
    if (allText.includes('소득세') || allText.includes('기타소득') || allText.includes('원천징수')) {
      ok.push('원천징수 확인');
    }

    // 프로필/신분증
    if (hasFileByName(rec.files, '프로필', '이력', '신분증', '강사')) {
      ok.push('전문가 프로필/신분증 첨부');
    }
  }

  // --- 인건비 ---
  else if (type === '인건비') {
    if (rec.files.length > 0) {
      // 근로계약서
      if (hasFileByName(rec.files, '근로계약서') || hasFileByContent(rec.files, '근로계약서', '근로계약')) {
        ok.push('근로계약서 첨부');
      } else {
        issues.push('근로계약서 미첨부');
      }

      // 급여명세서/지급명세서
      if (hasFileByName(rec.files, '급여명세', '지급명세') || hasFileByContent(rec.files, '급여명세', '지급명세')) {
        ok.push('급여/지급명세서 첨부');
      } else {
        issues.push('급여/지급명세서 미첨부');
      }

      // 내부결재
      if (hasFileByName(rec.files, '내부결재', '결재문서') || hasFileByContent(rec.files, '내부결재', '결재')) {
        ok.push('내부결재문서 첨부');
      }

      // 4대보험
      if (hasFileByName(rec.files, '4대보험', '보험') || hasFileByContent(rec.files, '4대보험', '국민연금', '건강보험')) {
        ok.push('4대보험 산출내역 첨부');
      }

      // 이체확인
      if (hasFileByName(rec.files, '이체확인', '입금완료', '입금') || hasFileByContent(rec.files, '이체확인증', '입금완료', '이체')) {
        ok.push('이체확인증 첨부');
      }
    }
  }

  // --- 기관부담금 ---
  else if (type === '기관부담금') {
    if (rec.files.length > 0) {
      if (hasFileByName(rec.files, '4대보험', '4대 보험') || hasFileByContent(rec.files, '4대보험', '건강보험료', '국민연금', '고용보험')) {
        ok.push('4대보험 산출내역 첨부');
      } else {
        issues.push('4대보험 산출내역 미첨부');
      }

      if (hasFileByName(rec.files, '기관부담금') || hasFileByContent(rec.files, '기관부담금')) {
        ok.push('기관부담금 지급명세서 첨부');
      }

      if (hasFileByName(rec.files, '근로계약서') || hasFileByContent(rec.files, '근로계약')) {
        ok.push('근로계약서 첨부');
      }
    }
  }

  // --- 사무용품 / 소모성물품 ---
  else if (type === '사무용품' || type === '소모성물품') {
    if (rec.files.length > 0) {
      // 거래명세서/세금계산서
      if (hasFileByName(rec.files, '거래명세서', '세금계산서') || hasFileByContent(rec.files, '거래명세서', '세금계산서')) {
        ok.push('거래명세서/세금계산서 첨부');
      } else {
        issues.push('거래명세서/세금계산서 미첨부');
      }

      // 검수조서
      if (hasFileByName(rec.files, '검수조서') || hasFileByContent(rec.files, '검수조서')) {
        ok.push('검수조서 첨부');
      }

      // 카드영수증
      if (hasFileByName(rec.files, '영수증', '카드') || hasFileByContent(rec.files, '영수증', '승인번호')) {
        ok.push('카드영수증 첨부');
      }

      // 견적서 (수의계약 기준: 공급가액 2천만원 이하)
      if (rec.supplyAmount > 20000000) {
        issues.push(`공급가액 ${rec.supplyAmount.toLocaleString()}원 → 2천만원 초과, 일반경쟁 필요`);
      }

      // 50만원 초과 자산취득
      if (rec.totalAmount > 500000) {
        issues.push(`${rec.totalAmount.toLocaleString()}원 → 50만원 초과, 자산취득 해당 여부 확인`);
      }
    }
  }

  // --- 노트북임차 ---
  else if (type === '노트북임차') {
    // 범용성 장비 체크
    if (allText.includes('노트북') || allText.includes('LG') || allText.includes('그램') || allText.includes('PC')) {
      issues.push('★ 범용성 장비(노트북/PC) 대여 → 지침 별표2 불인정 항목 해당 (범용성 장비 구입 또는 대여)');
    }

    // 계약서
    if (hasFileByName(rec.files, '계약서') || hasFileByContent(rec.files, '계약서', '계약')) {
      ok.push('임차계약서 첨부');
    }

    // 세금계산서
    if (hasFileByName(rec.files, '세금계산서') || hasFileByContent(rec.files, '세금계산서')) {
      ok.push('세금계산서 첨부');
    }

    // 검수조서
    if (hasFileByName(rec.files, '검수') || hasFileByContent(rec.files, '검수')) {
      ok.push('검수조서 첨부');
    }
  }

  // === 상태 결정 ===
  const status = issues.length > 0 ? '확인' : '적정';
  results.push({
    rowNum: rec.rowNum,
    type,
    purpose: rec.purpose,
    amount: rec.totalAmount,
    vendor: rec.vendorName,
    status,
    issues,
    ok,
  });
}

// === 출력 ===
const okCnt = results.filter(r => r.status === '적정').length;
const chkCnt = results.filter(r => r.status === '확인').length;
console.log(`\n경북대학교병원 정산검토 결과: 총 ${results.length}건`);
console.log(`적정 ${okCnt}건 | 확인 ${chkCnt}건\n`);

for (const r of results) {
  const mark = r.status === '적정' ? '✓' : '✗';
  console.log(`${mark} R${r.rowNum} [${r.type}] ${r.purpose.substring(0, 35)} | ${r.amount.toLocaleString()}원 | ${r.status}`);
  if (r.issues.length) console.log('   이슈: ' + r.issues.join(' | '));
  if (r.ok.length) console.log('   확인: ' + r.ok.join(', '));
}

// JSON 저장
fs.writeFileSync('/mnt/c/projects/e-naradomum-rpa/knuh-results.json', JSON.stringify(results, null, 2));
console.log('\n→ knuh-results.json 저장 완료');
