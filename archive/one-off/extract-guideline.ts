import fs from 'fs';
import pdfParse from 'pdf-parse';

async function main() {
  const buf = fs.readFileSync('/mnt/c/projects/e-naradomum-rpa/guideline.pdf');
  const data = await pdfParse(buf);
  const text = data.text;

  console.log('총 페이지:', data.numpages);
  console.log('총 텍스트:', text.length, '자');
  console.log('');

  // 예산 집행 관련 섹션 찾기
  const sections = [
    '예산 집행', '집행기준', '보조금 집행', '비목', '인건비',
    '여비', '수용비', '회의비', '업무추진비', '증빙',
    '정산', '부당집행', '세금계산서', '카드', '영수증',
    '간접비', '직접비', '재료비', '장비', '위탁',
  ];

  for (const kw of sections) {
    const idx = text.indexOf(kw);
    if (idx >= 0) {
      console.log(`=== [${kw}] 위치:${idx} ===`);
      console.log(text.substring(Math.max(0, idx - 50), Math.min(text.length, idx + 400)));
      console.log('---');
    }
  }

  // 전체 텍스트를 파일로 저장 (분석용)
  fs.writeFileSync('/mnt/c/projects/e-naradomum-rpa/guideline-text.txt', text);
  console.log('\n전체 텍스트 저장: guideline-text.txt');
}

main().catch(console.error);
