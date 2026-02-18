/**
 * 보탬e 685건 증빙 파일명 수집
 * 각 건의 기본서류 클릭 → 팝업에서 파일 목록 추출 → 닫기 → 다음 건
 * + 증빙유형, 증빙자료 텍스트도 함께 수집
 *
 * 사용법:
 *   node collect-evidence2.js              # 전체
 *   node collect-evidence2.js --limit=10   # 10건만
 *   node collect-evidence2.js --resume     # 이어서
 */
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

const LIMIT  = parseInt((process.argv.find(a => a.startsWith('--limit=')) || '--limit=9999').split('=')[1]);
const RESUME = process.argv.includes('--resume');

const DIR      = path.join(__dirname, 'projects/캠퍼스타운-고려대');
const OUTPUT   = path.join(DIR, 'evidence.json');
const DATA     = path.join(DIR, 'data.json');

function loadEvidence() {
  try { return JSON.parse(fs.readFileSync(OUTPUT, 'utf-8')); }
  catch { return []; }
}
function saveEvidence(data) {
  fs.writeFileSync(OUTPUT, JSON.stringify(data, null, 2));
}

(async () => {
  const b = await chromium.connectOverCDP('http://localhost:9445', { timeout: 10000 });
  const ctx = b.contexts()[0];
  const page = ctx.pages().find(p => p.url().includes('lss.do'));
  if (!page) { console.error('lss.do 탭 없음'); process.exit(1); }

  // 의견등록 탭 확인
  const tab = await page.evaluate(() => {
    const sel = document.querySelector('.cl-tabfolder-item.cl-selected');
    return (sel?.innerText || '').trim();
  });
  if (!tab.includes('의견등록')) {
    console.error('의견등록 탭 아님');
    await b.close(); process.exit(1);
  }

  const evidence = RESUME ? loadEvidence() : [];
  const dataJson = JSON.parse(fs.readFileSync(DATA, 'utf-8'));
  console.log(`데이터: ${dataJson.length}건, 기존 수집: ${evidence.length}건`);

  let collected = 0;
  let errors = 0;

  for (let step = 0; collected < LIMIT; step++) {
    // 현재 건 기본 정보 추출
    const info = await page.evaluate(() => {
      const text = document.body.innerText;
      const purposeM = text.match(/집행목적\(용도\)\n(.+)/);
      const evidTypeM = text.match(/증빙유형\n(.+)/);
      const amountM = text.match(/공급가액\n([\d,]+)/);
      const dateM = text.match(/집행실행일\n(\d{4}-\d{2}-\d{2})/);
      const vendorM = text.match(/거래처명\n(.+)/);

      // 기본서류 파일명 (파란 클릭 가능 텍스트)
      const fileExts = ['.pdf', '.jpg', '.jpeg', '.png', '.hwp', '.xlsx', '.xls', '.docx', '.zip'];
      const basicDocEl = [...document.querySelectorAll('*')].filter(el => {
        if (el.childElementCount > 0) return false;
        const t = (el.innerText || '').trim();
        return t.length > 3 && getComputedStyle(el).cursor === 'pointer' &&
          fileExts.some(ext => t.toLowerCase().endsWith(ext));
      });
      const basicDocName = basicDocEl.length > 0 ? basicDocEl[0].innerText.trim() : '';

      // 증빙자료 텍스트 (전자세금계산서 링크 등)
      const evidDataM = text.match(/증빙자료\n(.+?)(\n증빙서류|\n기본서류|\n집행등록일)/s);
      const evidData = (evidDataM?.[1] || '').trim();

      // 증빙서류 텍스트
      const evidDocM = text.match(/증빙서류\n(.+?)(\n품목명|\n집행등록일)/s);

      return {
        purpose: (purposeM?.[1] || '').trim(),
        evidenceType: (evidTypeM?.[1] || '').trim(),
        basicDocName,
        evidenceData: evidData,
        evidenceDoc: (evidDocM?.[1] || '').trim(),
        amount: (amountM?.[1] || '').replace(/,/g, ''),
        date: (dateM?.[1] || ''),
        vendor: (vendorM?.[1] || '').trim(),
        hasBasicDocLink: basicDocEl.length > 0,
      };
    });

    // data.json에서 매칭 (순번 파악)
    const match = dataJson.find(d =>
      d['집행목적(용도)'] === info.purpose ||
      (info.purpose && d['집행목적(용도)']?.startsWith(info.purpose.substring(0, 30)))
    );
    const rowNum = match ? parseInt(match['순번']) : step + 1;

    console.log(`[${rowNum}] ${info.purpose?.substring(0, 50)}`);
    console.log(`  증빙유형: ${info.evidenceType} | 기본서류: ${info.basicDocName?.substring(0, 40) || '(없음)'}`);

    // 기본서류 클릭 → 팝업에서 전체 파일 목록
    let fileList = [];
    if (info.hasBasicDocLink) {
      // 기본서류 클릭
      await page.evaluate(() => {
        const fileExts = ['.pdf', '.jpg', '.jpeg', '.png', '.hwp', '.xlsx', '.xls', '.docx', '.zip'];
        const els = [...document.querySelectorAll('*')].filter(el => {
          if (el.childElementCount > 0) return false;
          const t = (el.innerText || '').trim();
          return t.length > 3 && getComputedStyle(el).cursor === 'pointer' &&
            fileExts.some(ext => t.toLowerCase().endsWith(ext));
        });
        if (els.length > 0) els[0].click();
      });
      await sleep(1500);

      // 팝업에서 파일 목록 추출
      fileList = await page.evaluate(() => {
        const dialogs = [...document.querySelectorAll('.cl-dialog, [class*="cl-window"]')]
          .filter(el => el.getBoundingClientRect().width > 100);
        if (dialogs.length === 0) return [];

        const popup = dialogs[dialogs.length - 1];
        const fileExts = ['.pdf', '.jpg', '.jpeg', '.png', '.hwp', '.xlsx', '.xls', '.docx', '.zip'];
        const names = [...popup.querySelectorAll('*')]
          .filter(el => {
            const t = (el.innerText || '').trim();
            return el.childElementCount === 0 && t.length > 3 &&
              fileExts.some(ext => t.toLowerCase().endsWith(ext));
          })
          .map(el => (el.innerText || '').trim());

        // 파일 크기도 추출
        const sizes = [...popup.querySelectorAll('*')]
          .filter(el => {
            const t = (el.innerText || '').trim();
            return el.childElementCount === 0 && /^\d+\.?\d*$/.test(t);
          })
          .map(el => parseFloat((el.innerText || '').trim()));

        return names.map((name, i) => ({
          name,
          sizeMB: sizes[i] || 0,
        }));
      });

      // 팝업 닫기
      await page.evaluate(() => {
        const dialogs = [...document.querySelectorAll('.cl-dialog')]
          .filter(el => el.getBoundingClientRect().width > 100);
        for (const d of dialogs) {
          const btns = [...d.querySelectorAll('*')]
            .filter(el => (el.innerText || '').trim() === '닫기' && el.childElementCount === 0);
          if (btns.length > 0) { btns[0].click(); break; }
          // X 버튼
          const xBtns = [...d.querySelectorAll('*')]
            .filter(el => el.className.includes('close') || el.className.includes('Close'));
          if (xBtns.length > 0) { xBtns[0].click(); break; }
        }
      });
      await sleep(500);

      if (fileList.length > 0) {
        console.log(`  첨부파일: ${fileList.map(f => f.name).join(' | ')}`);
      }
    }

    // 저장
    const item = {
      rowNum,
      purpose: info.purpose,
      evidenceType: info.evidenceType,
      basicDocName: info.basicDocName,
      evidenceData: info.evidenceData,
      evidenceDoc: info.evidenceDoc,
      amount: info.amount,
      vendor: info.vendor,
      files: fileList,
    };

    const existIdx = evidence.findIndex(e => e.purpose === info.purpose);
    if (existIdx >= 0) evidence[existIdx] = item;
    else evidence.push(item);

    collected++;

    // 50건마다 저장
    if (collected % 50 === 0) {
      saveEvidence(evidence);
      console.log(`  [중간저장] ${evidence.length}건`);
    }

    // 세션 유지: 매 건마다 시간 체크 (5분 타임아웃)
    if (collected % 80 === 0) {
      console.log('  [세션 유지]');
      await page.evaluate(() => {
        const btn = document.querySelector('[class*="session-refresh"]');
        if (btn) btn.click();
      });
      await sleep(500);
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
    if (!moved) { console.log('마지막 건'); break; }
    await sleep(1200);
  }

  saveEvidence(evidence);
  console.log(`\n완료: ${collected}건 수집, 총 ${evidence.length}건, 오류 ${errors}건`);
  console.log(`저장: ${OUTPUT}`);

  await b.close();
})().catch(e => console.error('ERROR:', e.message));
