/**
 * 보탬e 증빙 메타데이터 수집 (다운로드 없이 빠르게)
 * - 각 건의 기본정보 + 파일명 + 증빙유형만 수집
 * - 다운로드는 하지 않음 (이미 company-downloads에 있는 것 활용)
 * - 건당 ~2초, 685건 = ~23분
 */
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

const LIMIT  = parseInt((process.argv.find(a => a.startsWith('--limit=')) || '--limit=9999').split('=')[1]);
const START  = parseInt((process.argv.find(a => a.startsWith('--start=')) || '--start=1').split('=')[1]);

const DIR    = path.join(__dirname, 'projects/캠퍼스타운-고려대');
const OUTPUT = path.join(DIR, 'evidence.json');

function loadEvidence() {
  try { return JSON.parse(fs.readFileSync(OUTPUT, 'utf-8')); }
  catch { return []; }
}
function saveEvidence(data) {
  fs.writeFileSync(OUTPUT, JSON.stringify(data, null, 2));
}

(async () => {
  const b = await chromium.connectOverCDP('http://localhost:9445', { timeout: 10000 });
  const page = b.contexts()[0].pages().find(p => p.url().includes('lss.do'));
  if (!page) { console.error('lss.do 탭 없음'); process.exit(1); }

  const evidence = loadEvidence();
  let collected = 0;

  for (let step = 0; collected < LIMIT; step++) {
    const startTime = Date.now();

    // 현재 건 정보 (메인 페이지에서 모두 추출)
    const info = await page.evaluate(() => {
      const text = document.body.innerText;

      // 기본 정보
      const purposeM = text.match(/집행목적\(용도\)\n(.+)/);
      const evidTypeM = text.match(/증빙유형\n(.+)/);
      const amountM = text.match(/공급가액\n([\d,]+)/);
      const vendorM = text.match(/거래처명\n(.+)/);
      const exeDateM = text.match(/집행실행일자\n(\d{4}-\d{2}-\d{2})/);
      const exeMethodM = text.match(/집행방식\n(.+)/);

      // 보조세목
      const atitM = text.match(/보조세목\(통계목\)\n(.+)/);

      // 증빙자료 텍스트
      const evidDataM = text.match(/증빙자료\n(.+?)(\n증빙서류|\n기본서류|\n집행등록일)/s);

      // 증빙서류 (시스템 증빙)
      const evidDocM = text.match(/증빙서류\n(.+?)(\n기본서류|\n집행등록일)/s);

      // 기본서류 파일명 (cursor:pointer인 파일 링크 텍스트)
      const fileExts = ['.pdf', '.jpg', '.jpeg', '.png', '.hwp', '.xlsx', '.xls', '.docx', '.zip'];
      const fileLinks = [...document.querySelectorAll('*')]
        .filter(el => {
          if (el.childElementCount > 0) return false;
          const t = (el.innerText || '').trim();
          return t.length > 3 && getComputedStyle(el).cursor === 'pointer' &&
            fileExts.some(ext => t.toLowerCase().endsWith(ext));
        })
        .map(el => (el.innerText || '').trim());

      // 불인정금액
      const nackM = text.match(/불인정금액\n([\d,]+)/);

      return {
        purpose: (purposeM?.[1] || '').trim(),
        evidenceType: (evidTypeM?.[1] || '').trim(),
        evidenceData: (evidDataM?.[1] || '').trim(),
        evidenceDoc: (evidDocM?.[1] || '').trim(),
        amount: (amountM?.[1] || '').replace(/,/g, ''),
        vendor: (vendorM?.[1] || '').trim(),
        exeDate: (exeDateM?.[1] || '').trim(),
        exeMethod: (exeMethodM?.[1] || '').trim(),
        atit: (atitM?.[1] || '').trim(),
        files: fileLinks,
        nackAmt: (nackM?.[1] || '0').replace(/,/g, ''),
      };
    });

    const elapsed = Date.now() - startTime;
    const idx = START + step;
    console.log(`[${idx}] ${info.purpose?.substring(0, 60)} | 파일:${info.files.length} | ${elapsed}ms`);

    // 저장 항목
    const item = {
      idx,
      purpose: info.purpose,
      evidenceType: info.evidenceType,
      evidenceData: info.evidenceData,
      evidenceDoc: info.evidenceDoc,
      amount: info.amount,
      vendor: info.vendor,
      exeDate: info.exeDate,
      exeMethod: info.exeMethod,
      atit: info.atit,
      files: info.files,
      nackAmt: info.nackAmt,
    };

    // 중복 방지 (purpose + amount 기준)
    const existIdx = evidence.findIndex(e => e.purpose === info.purpose && e.amount === info.amount);
    if (existIdx >= 0) evidence[existIdx] = item;
    else evidence.push(item);
    collected++;

    // 50건마다 저장
    if (collected % 50 === 0) {
      saveEvidence(evidence);
      console.log(`  [저장] ${evidence.length}건 (${collected}건 수집)`);
    }

    // 다음 건
    const moved = await page.evaluate(() => {
      const btns = [...document.querySelectorAll('*')].filter(el =>
        (el.innerText || '').trim() === '다음 집행정보 보기' &&
        el.getBoundingClientRect().width > 0 && el.childElementCount === 0
      );
      if (btns.length > 0) { btns[0].click(); return true; }
      return false;
    });
    if (!moved) { console.log('마지막 건 도달'); break; }
    await sleep(1200);
  }

  saveEvidence(evidence);
  console.log(`\n완료: ${collected}건 수집, 총 ${evidence.length}건`);
  await b.close();
})().catch(e => console.error('ERROR:', e.message));
