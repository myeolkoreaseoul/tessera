/**
 * 보탬e 캠퍼스타운 증빙파일 다운로드 (items 1-10)
 *
 * 전략:
 * 1. 각 건의 상세페이지에서 첨부파일명 확인
 * 2. 첨부파일 다운로드 URL을 fetch로 받아서 base64로 변환
 * 3. 로컬에 직접 저장 (CDP 다운로드 제약 우회)
 */
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

const DL_DIR = path.join(__dirname, 'projects/캠퍼스타운-고려대/downloads');
if (!fs.existsSync(DL_DIR)) fs.mkdirSync(DL_DIR, { recursive: true });

const START = parseInt(process.argv[2]) || 1;
const END = parseInt(process.argv[3]) || 10;

(async () => {
  const b = await chromium.connectOverCDP('http://100.87.3.123:9445', { timeout: 10000 });
  const ctx = b.contexts()[0];
  const page = ctx.pages().find(p => p.url().includes('lss.do'));
  if (!page) { console.error('lss.do 탭 없음'); process.exit(1); }

  console.log('보탬e 연결 성공');

  // 1. 현재 팝업 닫기 (있으면)
  await page.evaluate(() => {
    const closeBtn = [...document.querySelectorAll('*')].filter(el => {
      const t = (el.innerText || '').trim();
      return t === '닫기' && el.getBoundingClientRect().width > 0 && el.childElementCount === 0;
    });
    if (closeBtn[0]) closeBtn[0].click();
  });
  await sleep(500);

  // 2. 현재 어느 아이템에 있는지 확인
  const currentInfo = await page.evaluate(() => {
    const text = document.body.innerText;
    const m = text.match(/집행목적\(용도\)\n(.+)/);
    return (m && m[1]) ? m[1].trim() : '';
  });
  console.log('현재 건:', currentInfo.substring(0, 60));

  // 3. 이전/다음 버튼으로 네비게이션하여 item 1까지 이동
  // 현재 건 번호 추출 (XX차_ 패턴)
  const currentNum = parseInt((currentInfo.match(/(\d+)차_/) || [])[1]) || 0;
  console.log('현재 차수:', currentNum);

  // 먼저 첫 번째 건으로 이동 (이전 집행정보 보기 반복)
  console.log('첫 번째 건으로 이동 중...');
  for (let i = 0; i < 20; i++) {
    const hasPrev = await page.evaluate(() => {
      const btns = [...document.querySelectorAll('*')].filter(el => {
        const t = (el.innerText || '').trim();
        return t === '이전 집행정보 보기' && el.getBoundingClientRect().width > 0 && el.childElementCount === 0;
      });
      if (btns[0]) { btns[0].click(); return true; }
      return false;
    });
    if (!hasPrev) { console.log('  첫 번째 건 도달 (이전 없음)'); break; }
    await sleep(1000);

    // 현재 건 확인
    const info = await page.evaluate(() => {
      const text = document.body.innerText;
      const m = text.match(/집행목적\(용도\)\n(.+)/);
      return (m && m[1]) ? m[1].trim().substring(0, 50) : '';
    });
    console.log(`  이동: ${info}`);
  }

  // 4. 각 건 처리 (1~10)
  for (let itemNum = START; itemNum <= END; itemNum++) {
    console.log(`\n=== [${itemNum}] 처리 ===`);

    // 현재 건 정보
    const info = await page.evaluate(() => {
      const text = document.body.innerText;
      const purposeM = text.match(/집행목적\(용도\)\n(.+)/);
      const methodM = text.match(/집행방식\n(.+)/);
      return {
        purpose: (purposeM && purposeM[1]) ? purposeM[1].trim() : '',
        method: (methodM && methodM[1]) ? methodM[1].trim() : '',
      };
    });
    console.log(`  용도: ${info.purpose.substring(0, 60)}`);
    console.log(`  방식: ${info.method}`);

    // 건별 디렉토리
    const itemDir = path.join(DL_DIR, String(itemNum));
    if (!fs.existsSync(itemDir)) fs.mkdirSync(itemDir, { recursive: true });

    // 5. 첨부파일 영역에서 파일 링크 텍스트 수집
    const fileLinks = await page.evaluate(() => {
      const fileExts = ['.pdf', '.jpg', '.jpeg', '.png', '.hwp', '.xlsx', '.xls', '.docx', '.zip'];
      return [...document.querySelectorAll('*')]
        .filter(el => {
          if (el.childElementCount > 0) return false;
          const t = (el.innerText || '').trim();
          const style = getComputedStyle(el);
          return t.length > 3 && style.cursor === 'pointer' &&
            fileExts.some(ext => t.toLowerCase().endsWith(ext));
        })
        .map(el => (el.innerText || '').trim());
    });
    console.log(`  파일 ${fileLinks.length}개: ${fileLinks.join(', ')}`);

    // 6. 각 파일 다운로드 (클릭 → 팝업 열기 → fetch로 다운로드)
    for (const fileName of fileLinks) {
      console.log(`  다운로드: ${fileName}`);

      // 파일명 클릭 시 팝업이 열리거나 직접 다운로드
      // 먼저 팝업 내 다운로드 URL을 찾아보자
      // 보탬e는 파일 클릭 시 /cmm/fms/FileDown.do 등의 URL로 다운로드

      // 방법: 파일명 클릭 → 요청 인터셉트
      let downloadUrl = null;

      // CDP 세션으로 네트워크 요청 감시
      const cdpSession = await page.context().newCDPSession(page);
      await cdpSession.send('Network.enable');

      const urlPromise = new Promise((resolve) => {
        const timeout = setTimeout(() => resolve(null), 8000);
        cdpSession.on('Network.requestWillBeSent', (params) => {
          const url = params.request.url;
          if (url.includes('FileDown') || url.includes('download') || url.includes('atchmnfl')) {
            clearTimeout(timeout);
            resolve(url);
          }
        });
      });

      // 파일명 클릭
      await page.evaluate((fn) => {
        const els = [...document.querySelectorAll('*')].filter(el => {
          if (el.childElementCount > 0) return false;
          return (el.innerText || '').trim() === fn && getComputedStyle(el).cursor === 'pointer';
        });
        if (els[0]) els[0].click();
      }, fileName);

      downloadUrl = await urlPromise;

      if (downloadUrl) {
        console.log(`    URL: ${downloadUrl.substring(0, 120)}`);

        // fetch로 파일 내용 가져오기 (브라우저 세션 쿠키 사용)
        const fileData = await page.evaluate(async (url) => {
          try {
            const resp = await fetch(url);
            const blob = await resp.blob();
            const reader = new FileReader();
            return new Promise((resolve) => {
              reader.onload = () => resolve(reader.result.split(',')[1]); // base64
              reader.readAsDataURL(blob);
            });
          } catch (e) {
            return null;
          }
        }, downloadUrl);

        if (fileData) {
          const savePath = path.join(itemDir, fileName);
          fs.writeFileSync(savePath, Buffer.from(fileData, 'base64'));
          const size = fs.statSync(savePath).size;
          console.log(`    저장: ${savePath} (${Math.round(size / 1024)}KB)`);
        } else {
          console.log(`    fetch 실패`);
        }
      } else {
        console.log(`    다운로드 URL 감지 실패`);

        // 팝업이 열렸을 수 있음 — 팝업 내 다운로드 버튼 확인
        await sleep(1000);
        const popupState = await page.evaluate(() => {
          const dlBtns = [...document.querySelectorAll('*')].filter(el => {
            const t = (el.innerText || '').trim();
            return t === '다운로드' && el.getBoundingClientRect().width > 0 && el.childElementCount === 0;
          });
          return { hasPopupDlBtn: dlBtns.length > 0 };
        });

        if (popupState.hasPopupDlBtn) {
          console.log(`    팝업 다운로드 버튼 발견, 클릭...`);

          const urlPromise2 = new Promise((resolve) => {
            const timeout = setTimeout(() => resolve(null), 8000);
            cdpSession.on('Network.requestWillBeSent', (params) => {
              const url = params.request.url;
              if (url.includes('FileDown') || url.includes('download') || url.includes('atchmnfl')) {
                clearTimeout(timeout);
                resolve(url);
              }
            });
          });

          await page.evaluate(() => {
            const btns = [...document.querySelectorAll('*')].filter(el => {
              const t = (el.innerText || '').trim();
              return t === '다운로드' && el.getBoundingClientRect().width > 0 && el.childElementCount === 0;
            });
            if (btns[0]) btns[0].click();
          });

          const url2 = await urlPromise2;
          if (url2) {
            console.log(`    팝업 URL: ${url2.substring(0, 120)}`);
            const fileData = await page.evaluate(async (url) => {
              try {
                const resp = await fetch(url);
                const blob = await resp.blob();
                const reader = new FileReader();
                return new Promise((resolve) => {
                  reader.onload = () => resolve(reader.result.split(',')[1]);
                  reader.readAsDataURL(blob);
                });
              } catch (e) { return null; }
            }, url2);

            if (fileData) {
              const savePath = path.join(itemDir, fileName);
              fs.writeFileSync(savePath, Buffer.from(fileData, 'base64'));
              const size = fs.statSync(savePath).size;
              console.log(`    저장: ${savePath} (${Math.round(size / 1024)}KB)`);
            }
          }

          // 팝업 닫기
          await page.evaluate(() => {
            const closeBtn = [...document.querySelectorAll('*')].filter(el => {
              const t = (el.innerText || '').trim();
              return t === '닫기' && el.getBoundingClientRect().width > 0 && el.childElementCount === 0;
            });
            if (closeBtn[0]) closeBtn[0].click();
          });
          await sleep(500);
        }
      }

      await cdpSession.detach();
      await sleep(300);
    }

    // 다음 건으로 이동
    if (itemNum < END) {
      const hasNext = await page.evaluate(() => {
        const btns = [...document.querySelectorAll('*')].filter(el => {
          const t = (el.innerText || '').trim();
          return t === '다음 집행정보 보기' && el.getBoundingClientRect().width > 0 && el.childElementCount === 0;
        });
        if (btns[0]) { btns[0].click(); return true; }
        return false;
      });
      if (!hasNext) { console.log('다음 건 없음'); break; }
      await sleep(1200);
    }
  }

  console.log('\n=== 완료 ===');

  // 다운로드 결과 요약
  for (let i = START; i <= END; i++) {
    const dir = path.join(DL_DIR, String(i));
    if (fs.existsSync(dir)) {
      const files = fs.readdirSync(dir);
      console.log(`[${i}] ${files.length}개: ${files.join(', ')}`);
    } else {
      console.log(`[${i}] (없음)`);
    }
  }

  await b.close();
})().catch(e => console.error('ERROR:', e.message));
