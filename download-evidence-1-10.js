/**
 * 보탬e 캠퍼스타운 증빙파일 다운로드 (1~10번)
 * - 각 건의 상세 페이지에서 기본서류 PDF 다운로드
 * - 건별 서브디렉토리에 저장
 */
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

const CDP_URL = 'http://100.87.3.123:9445';
const BASE_DIR = path.join(__dirname, 'projects/캠퍼스타운-고려대/downloads');
const START = parseInt(process.argv[2]) || 1;
const END = parseInt(process.argv[3]) || 10;

// 보탬e API
const LIST_API = '/sm/clcn/privClrv/rvwIxInqSvi/retvLstExeCntt.do';
const DETAIL_API = '/sm/clcn/privClrv/rvwIxInqSvi/retvClrvExeCnttDtl.do';

(async () => {
  if (!fs.existsSync(BASE_DIR)) fs.mkdirSync(BASE_DIR, { recursive: true });

  const b = await chromium.connectOverCDP(CDP_URL, { timeout: 10000 });
  const ctx = b.contexts()[0];
  const page = ctx.pages().find(p => p.url().includes('losims'));
  if (!page) { console.error('보탬e 탭 없음'); process.exit(1); }

  console.log('보탬e 연결 성공');

  // 현재 페이지 상태 확인
  const pageState = await page.evaluate(() => {
    const text = document.body.innerText.substring(0, 500);
    return text;
  });
  console.log('현재 페이지:', pageState.substring(0, 200));

  // 스크린샷
  await page.screenshot({ path: '/tmp/botem-state.png' });
  console.log('스크린샷: /tmp/botem-state.png');

  // 집행내역 목록 API로 아이템 정보 가져오기
  console.log(`\n=== ${START}~${END}번 아이템 정보 조회 ===`);

  const listResult = await page.evaluate(async ({ url, start, end }) => {
    try {
      const params = {
        fyr: '2025',
        pfmBizId: '20253070000000296751',
        pfmInstId: '000000058109',
        clrvPrgStatCd: '',
        srchBgngYmd: '20250101',
        srchEndYmd: '20260218',
        exeMthdDvCd: '',
        atitCd: '',
        pageSize: 40,
        totalCnt: 685,
        curPage: 1,
        ctrtMngNoYn: '',
        imprMngNoYn: '',
      };
      const resp = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(params),
      });
      const data = await resp.json();
      return { ok: true, items: data.list || data.data || data };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  }, { url: LIST_API, start: START, end: END });

  if (!listResult.ok) {
    console.error('목록 조회 실패:', listResult.error);
    process.exit(1);
  }

  const items = Array.isArray(listResult.items) ? listResult.items : [];
  console.log(`목록 ${items.length}건 조회됨`);

  // 각 아이템 상세 페이지 → 파일 다운로드
  for (let i = START - 1; i < Math.min(END, items.length); i++) {
    const item = items[i];
    const rowNum = i + 1;
    const sbatExeId = item.sbatExeId;
    const purpose = item.exePurpCn || item.exePurpCnSmy || '';

    console.log(`\n[${rowNum}] ${purpose.substring(0, 50)} (sbatExeId: ${sbatExeId})`);

    // 건별 디렉토리
    const itemDir = path.join(BASE_DIR, String(rowNum));
    if (!fs.existsSync(itemDir)) fs.mkdirSync(itemDir, { recursive: true });

    // 상세 페이지 조회 (API)
    const detail = await page.evaluate(async ({ url, sbatExeId }) => {
      try {
        const params = {
          fyr: '2025',
          pfmBizId: '20253070000000296751',
          pfmInstId: '000000058109',
          sbatExeId: sbatExeId,
          sbatExeSnum: '1',
        };
        const resp = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(params),
        });
        const data = await resp.json();
        return { ok: true, data };
      } catch (e) {
        return { ok: false, error: e.message };
      }
    }, { url: DETAIL_API, sbatExeId });

    if (detail.ok) {
      // 상세 데이터 저장
      fs.writeFileSync(path.join(itemDir, 'detail.json'), JSON.stringify(detail.data, null, 2));
      console.log(`  상세정보 저장`);
    } else {
      console.log(`  상세조회 실패: ${detail.error}`);
    }

    // 상세 페이지로 직접 이동하여 파일 링크 클릭
    // 목록 → 행 클릭 → 상세 페이지 → 기본서류 파일 클릭
    // IBSheet grid에서 해당 행 선택
    const navResult = await page.evaluate(async ({ rowNum }) => {
      // grid가 있는지 확인
      const gridNames = Object.keys(window).filter(k => window[k] && typeof window[k].focus === 'function' && typeof window[k].getRowCount === 'function');
      if (gridNames.length === 0) return { ok: false, error: 'IBSheet grid 없음' };

      const grid = window[gridNames[0]];
      const rowCount = grid.getRowCount();

      // 해당 행 focus
      if (rowNum <= rowCount) {
        grid.focus(rowNum);
        return { ok: true, gridName: gridNames[0], rowCount, focused: rowNum };
      }
      return { ok: false, error: `행 ${rowNum} 없음 (총 ${rowCount}행)` };
    }, { rowNum });

    if (!navResult.ok) {
      console.log(`  그리드 이동 실패: ${navResult.error}`);

      // 그리드가 없으면 현재 상세페이지일 수 있음 — 스크린샷으로 확인
      await page.screenshot({ path: `/tmp/botem-item-${rowNum}.png` });
      console.log(`  스크린샷: /tmp/botem-item-${rowNum}.png`);
      continue;
    }

    console.log(`  그리드 포커스: ${navResult.focused}/${navResult.rowCount}`);

    // 상세 보기 (용도 셀 더블클릭 또는 상세보기 버튼)
    await sleep(500);

    // 용도 셀 클릭으로 상세 진입
    const clicked = await page.evaluate(({ rowNum }) => {
      const gridNames = Object.keys(window).filter(k => window[k] && typeof window[k].focus === 'function');
      if (gridNames.length === 0) return false;
      const grid = window[gridNames[0]];
      // 용도 셀의 text 클릭 이벤트 발생
      grid.focus(rowNum);
      // "집행목적" 컬럼 클릭
      const evt = new CustomEvent('click', { bubbles: true });
      const cells = document.querySelectorAll(`[class*="SheetCell"]`);
      for (const cell of cells) {
        if (cell.innerText && cell.innerText.includes('차_')) {
          cell.dispatchEvent(evt);
          return true;
        }
      }
      return false;
    }, { rowNum });

    await sleep(1500);

    // 파일 다운로드 — 기본서류 영역에서 파일 링크 찾기
    const fileLinks = await page.evaluate(() => {
      const fileExts = ['.pdf', '.jpg', '.jpeg', '.png', '.hwp', '.xlsx', '.xls', '.docx', '.zip'];
      return [...document.querySelectorAll('*')]
        .filter(el => {
          if (el.childElementCount > 0) return false;
          const t = (el.innerText || '').trim();
          return t.length > 3 && getComputedStyle(el).cursor === 'pointer' &&
            fileExts.some(ext => t.toLowerCase().endsWith(ext));
        })
        .map(el => ({
          text: (el.innerText || '').trim(),
          tag: el.tagName,
          class: el.className.substring(0, 50),
        }));
    });

    console.log(`  파일 ${fileLinks.length}개: ${fileLinks.map(f => f.text).join(', ')}`);

    for (const link of fileLinks) {
      try {
        // 다운로드 이벤트 대기
        const downloadPromise = page.waitForEvent('download', { timeout: 15000 }).catch(() => null);

        // 파일명으로 요소 찾아서 클릭
        await page.evaluate((fileName) => {
          const els = [...document.querySelectorAll('*')]
            .filter(el => {
              if (el.childElementCount > 0) return false;
              const t = (el.innerText || '').trim();
              return t === fileName && getComputedStyle(el).cursor === 'pointer';
            });
          if (els[0]) els[0].click();
        }, link.text);

        const download = await downloadPromise;
        if (download) {
          const fileName = download.suggestedFilename();
          const savePath = path.join(itemDir, fileName);
          await download.saveAs(savePath);
          const size = fs.statSync(savePath).size;
          console.log(`  ✓ 다운로드: ${fileName} (${Math.round(size/1024)}KB)`);
        } else {
          console.log(`  ✗ 다운로드 실패: ${link.text}`);
          // 새 탭에서 열렸을 수 있음
          const allPages = ctx.pages();
          for (const p of allPages) {
            if (p !== page && !p.url().includes('about:blank')) {
              console.log(`  새 탭: ${p.url().substring(0, 100)}`);
              // PDF 내용을 직접 저장 시도
              try {
                const content = await p.content();
                if (content.includes('application/pdf')) {
                  console.log(`  PDF 탭 발견`);
                }
              } catch(e) {}
              await p.close();
            }
          }
        }

        await sleep(500);
      } catch (e) {
        console.log(`  다운로드 에러: ${e.message}`);
      }
    }

    // 스크린샷
    await page.screenshot({ path: `/tmp/botem-item-${rowNum}.png` });

    // 목록으로 돌아가기
    const backResult = await page.evaluate(() => {
      const btns = [...document.querySelectorAll('*')].filter(el =>
        (el.innerText || '').trim() === '목록' &&
        el.getBoundingClientRect().width > 0 && el.childElementCount === 0
      );
      if (btns.length > 0) { btns[0].click(); return true; }
      return false;
    });

    if (backResult) {
      console.log('  목록으로 복귀');
      await sleep(1500);
    }
  }

  console.log(`\n=== 완료 ===`);
  await b.close();
})().catch(e => console.error('ERROR:', e.message));
