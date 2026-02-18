const ExcelJS = require('exceljs');
const path = '/mnt/c/Users/정동회계법인/Documents/2025 보조금 본정산/2025년2월_이나라도움_본정산리스트.xlsx';

// 완료 기관 기록
const updates = [
  // 기관명(C6열 참조용) → 순번(B열)으로 매칭, 정산상태(Q열) 업데이트, 기타특이사항(Y열) 추가
  { seq: 174, status: 'RPA 검토완료', note: '네오폰스 - 이전 완료' },
  { seq: 175, status: 'RPA 검토완료', note: '경북대학교병원(2차) 49건, 적정5/확인44' },
  { seq: 176, status: 'RPA 검토완료', note: '바이오링크 54건, 적정22/확인32' },
  { seq: 177, status: 'RPA 검토완료', note: '계명대동산(2차) 31건, 적정6/확인25' },
  { seq: 178, status: 'RPA 검토완료', note: '빔웍스 - 경북대+칠곡경북대로 처리' },
  { seq: 179, status: 'RPA 검토완료', note: '칠곡경북대(2차) 49건, 적정28/확인21' },
  { seq: 180, status: 'RPA 검토완료(중간)', note: '신라시스템(2차) 60건, 적정8/확인52, 중간정산으로 입력됨' },
  { seq: 181, status: 'RPA 검토완료', note: '대구가톨릭대 26건, 적정0/확인26' },
  { seq: 182, status: 'RPA 검토완료', note: '비욘드메디슨 29건, 적정11/확인18' },
  { seq: 183, status: 'e나라 검색불가', note: '한림대학교성심병원(DH) - 검증기관 미배정' },
  { seq: 184, status: 'e나라 검색불가', note: 'SYM헬스케어 - 검증기관 미배정' },
  { seq: 185, status: 'e나라 검색불가', note: '가천대길병원 - 검증기관 미배정' },
  { seq: 186, status: 'RPA 검토완료', note: '웨이센 13건, 적정4/확인9' },
  { seq: 187, status: 'e나라 검색불가', note: '강남세브란스 - 검증기관 미배정' },
  { seq: 188, status: 'e나라 검색불가', note: '서울성모(2차) - 검증기관 미배정' },
  { seq: 189, status: 'RPA 검토완료(중간)', note: '신라시스템(1차) 60건, 적정8/확인52, 중간정산으로 입력됨' },
  { seq: 190, status: 'e나라 검색불가', note: '원주세브란스 - e나라 검색 결과 없음' },
  { seq: 191, status: 'RPA 검토완료', note: '인트인 27건, 적정11/확인16' },
  { seq: 192, status: 'RPA 검토완료', note: '계명대동산(1차) 31건, 적정6/확인25' },
  { seq: 193, status: 'RPA 검토완료', note: '메디웨일 14건, 적정4/확인10, 중간정산' },
  { seq: 194, status: 'e나라 검색불가', note: '용인세브란스 - e나라 검색 결과 없음' },
  { seq: 195, status: 'RPA 검토완료', note: '임프리메드코리아 19건, 적정8/확인11, 최종정산' },
  { seq: 196, status: 'e나라 검색불가', note: '서울성모(1차) - 검증기관 미배정' },
  { seq: 197, status: 'RPA 검토완료', note: '에이아이트릭스 31건, 적정7/확인24, 중간정산' },
  { seq: 198, status: 'e나라 검색불가', note: '경북대학교병원(1차) - 별도 확인 필요' },
  { seq: 199, status: 'RPA 검토완료', note: '실비아헬스 14건, 적정2/확인12, 중간정산' },
  { seq: 200, status: 'e나라 검색불가', note: '서울대학교병원 - e나라 검색 결과 없음' },
  // 201(스키아)는 현재 진행 중
  { seq: 202, status: 'e나라 검색불가', note: '이대목동 - e나라 검색 결과 없음' },
];

(async () => {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(path);
  const ws = wb.worksheets[0];

  let updated = 0;
  ws.eachRow((row, rowNum) => {
    if (rowNum === 1) return; // 헤더
    const seqVal = row.getCell(2).value; // B열 = 순번
    const seq = typeof seqVal === 'number' ? seqVal : parseInt(String(seqVal));
    const match = updates.find(u => u.seq === seq);
    if (match) {
      row.getCell(17).value = match.status; // Q열 = 정산상태
      // Y열 = 기타특이사항 - 기존 값에 추가
      const existing = String(row.getCell(25).value || '');
      const newNote = existing ? `${existing} | ${match.note}` : match.note;
      row.getCell(25).value = newNote;
      updated++;
      console.log(`  [${seq}] ${match.status} | ${match.note}`);
    }
  });

  await wb.xlsx.writeFile(path);
  console.log(`\n${updated}건 업데이트 완료`);
})().catch(e => { console.error('Error:', e.message); process.exit(1); });
