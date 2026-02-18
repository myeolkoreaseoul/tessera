/**
 * 보탬e 집행내역 상세 - 증빙 정보 수집
 * 각 건의 기본서류/증빙서류/증빙유형/증빙자료 추출
 *
 * 사용법:
 *   node collect-evidence.js              # 전체 수집
 *   node collect-evidence.js --start=100  # 100번째 건부터
 *   node collect-evidence.js --limit=10   # 10건만
 */
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const START  = parseInt((process.argv.find(a => a.startsWith('--start=')) || '--start=1').split('=')[1]);
const LIMIT  = parseInt((process.argv.find(a => a.startsWith('--limit=')) || '--limit=9999').split('=')[1]);

const DIR      = path.join(__dirname, 'projects/캠퍼스타운-고려대');
const OUTPUT   = path.join(DIR, 'evidence.json');
const PROGRESS = path.join(DIR, 'evidence-progress.json');

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// 진행 상태
function loadProgress() {
  try { return JSON.parse(fs.readFileSync(PROGRESS, 'utf-8')); }
  catch { return { collected: [], lastIdx: 0 }; }
}
function saveProgress(prog) {
  fs.writeFileSync(PROGRESS, JSON.stringify(prog, null, 2));
}

// 기존 수집 데이터 로드
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

  // 의견등록 탭 확인
  const currentTab = await page.evaluate(() => {
    const selected = document.querySelector('.cl-tabfolder-item.cl-selected');
    return (selected?.innerText || '').trim();
  });
  if (!currentTab.includes('의견등록')) {
    console.error('검증검토 의견등록 탭이 활성화되어 있지 않습니다.');
    await b.close();
    process.exit(1);
  }

  const progress = loadProgress();
  const evidence = loadEvidence();
  console.log(`기존 수집: ${evidence.length}건, 진행: lastIdx=${progress.lastIdx}`);

  let collected = 0;
  let idx = 0;

  for (let step = 0; collected < LIMIT; step++) {
    // 현재 건 정보 추출
    const info = await page.evaluate(() => {
      const text = document.body.innerText;

      // 집행목적
      const purposeM = text.match(/집행목적\(용도\)\n(.+)/);
      const purpose = (purposeM?.[1] || '').trim();

      // 증빙유형
      const evidenceTypeM = text.match(/증빙유형\n(.+)/);
      const evidenceType = (evidenceTypeM?.[1] || '').trim();

      // 기본서류 - 링크 텍스트 추출
      const basicDocs = [];
      const basicDocEls = [...document.querySelectorAll('a, .cl-link, [class*="link"]')]
        .filter(el => {
          const r = el.getBoundingClientRect();
          if (r.width === 0) return false;
          // 기본서류 레이블 근처에 있는 링크
          const t = (el.innerText || '').trim();
          return t.endsWith('.pdf') || t.endsWith('.jpg') || t.endsWith('.png') ||
                 t.endsWith('.xlsx') || t.endsWith('.hwp') || t.endsWith('.zip') ||
                 t.endsWith('.jpeg') || t.endsWith('.docx') || t.endsWith('.xls');
        });
      basicDocEls.forEach(el => basicDocs.push((el.innerText || '').trim()));

      // 기본서류/증빙서류 레이블 기준으로 파일명 추출
      const allText = text;
      const basicDocM = allText.match(/기본서류\n(.+?)(\n증빙서류|\n품목명|\n집행등록일)/s);
      const evidenceDocM = allText.match(/증빙서류\n(.+?)(\n품목명|\n집행등록일|\n집행거래일)/s);

      // 더 정확한 방법: DOM에서 "기본서류" 레이블 옆의 파일 링크 찾기
      const labels = [...document.querySelectorAll('*')].filter(el =>
        el.childElementCount === 0 && ['기본서류', '증빙서류'].includes((el.innerText || '').trim())
      );

      const docsByLabel = {};
      labels.forEach(label => {
        const labelText = (label.innerText || '').trim();
        // 같은 행(부모)에서 파일 링크 찾기
        let parent = label.parentElement;
        for (let i = 0; i < 3 && parent; i++) {
          const links = [...parent.querySelectorAll('a, [class*="link"]')]
            .filter(el => el !== label && el.getBoundingClientRect().width > 0)
            .map(el => (el.innerText || '').trim())
            .filter(t => t.length > 0);
          if (links.length > 0) {
            docsByLabel[labelText] = links;
            break;
          }
          parent = parent.parentElement;
        }
      });

      // 증빙자료
      const evidenceDataM = allText.match(/증빙자료\n(.+?)(\n기본서류|\n증빙유형)/s);

      // 집행방식, 금액 등
      const amountM = allText.match(/공급가액\n([\d,]+)/);
      const dateM = allText.match(/집행실행일\n(\d{4}-\d{2}-\d{2})/);
      const vendorM = allText.match(/거래처명\n(.+)/);

      return {
        purpose,
        evidenceType,
        basicDocs: docsByLabel['기본서류'] || basicDocs,
        evidenceDocs: docsByLabel['증빙서류'] || [],
        evidenceData: (evidenceDataM?.[1] || '').trim(),
        basicDocText: (basicDocM?.[1] || '').trim(),
        evidenceDocText: (evidenceDocM?.[1] || '').trim(),
        amount: (amountM?.[1] || '').replace(/,/g, ''),
        date: (dateM?.[1] || ''),
        vendor: (vendorM?.[1] || '').trim(),
      };
    });

    const itemIdx = step + 1;
    if (itemIdx < START) {
      const moved = await clickNext(page);
      if (!moved) break;
      continue;
    }

    console.log(`[${itemIdx}] ${info.purpose?.substring(0, 50)}`);
    console.log(`  증빙유형: ${info.evidenceType}`);
    console.log(`  기본서류: ${info.basicDocs.join(' | ') || info.basicDocText || '(없음)'}`);
    console.log(`  증빙서류: ${info.evidenceDocs.join(' | ') || info.evidenceDocText || '(없음)'}`);

    // 기존 데이터에서 같은 건 찾기 (목적+금액 기준)
    const existing = evidence.findIndex(e => e.purpose === info.purpose && e.amount === info.amount);
    if (existing >= 0) {
      evidence[existing] = { idx: itemIdx, ...info };
    } else {
      evidence.push({ idx: itemIdx, ...info });
    }

    collected++;
    progress.lastIdx = itemIdx;
    progress.collected = evidence.map(e => e.idx);

    // 50건마다 저장
    if (collected % 50 === 0) {
      saveEvidence(evidence);
      saveProgress(progress);
      console.log(`  [저장] ${evidence.length}건`);
    }

    // 세션 유지: 100건마다
    if (collected % 100 === 0) {
      await page.evaluate(() => {
        const btn = document.querySelector('[class*="session-refresh"], .cl-session-refresh');
        if (btn) btn.click();
      });
      await sleep(500);
    }

    // 다음 건
    const moved = await clickNext(page);
    if (!moved) {
      console.log('마지막 건');
      break;
    }
  }

  // 최종 저장
  saveEvidence(evidence);
  saveProgress(progress);
  console.log(`\n완료: ${collected}건 수집, 총 ${evidence.length}건 저장`);

  await b.close();
})().catch(e => console.error('ERROR:', e.message));

async function clickNext(page) {
  const moved = await page.evaluate(() => {
    const btns = [...document.querySelectorAll('*')].filter(el => {
      const t = (el.innerText || '').trim();
      const r = el.getBoundingClientRect();
      return t === '다음 집행정보 보기' && r.width > 0 && el.childElementCount === 0;
    });
    if (btns.length > 0) { btns[0].click(); return true; }
    return false;
  });
  if (moved) await new Promise(r => setTimeout(r, 1200));
  return moved;
}
