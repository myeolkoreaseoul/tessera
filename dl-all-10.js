/**
 * 보탬e 캠퍼스타운 1~10번 증빙파일 순차 다운로드
 * 방식: 파일클릭 → retvFileList.do 인터셉트로 atflGrpId 캡처 → JSON fetch 다운로드
 */
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

const DL_DIR = '/home/john/e-naradomum-rpa/projects/캠퍼스타운-고려대/downloads';
if (!fs.existsSync(DL_DIR)) fs.mkdirSync(DL_DIR, { recursive: true });

const START = parseInt(process.argv[2]) || 1;
const END = parseInt(process.argv[3]) || 10;

(async () => {
  const b = await chromium.connectOverCDP('http://100.87.3.123:9445', { timeout: 10000 });
  const ctx = b.contexts()[0];
  const page = ctx.pages().find(p => p.url().includes('lss.do'));
  if (!page) { console.error('lss.do 탭 없음'); process.exit(1); }
  console.log('보탬e 연결');

  // 팝업 닫기 헬퍼
  async function closePopups() {
    await page.evaluate(() => {
      // 확인 버튼 (alert류)
      [...document.querySelectorAll('*')].filter(el => {
        const t = (el.innerText || '').trim();
        const r = el.getBoundingClientRect();
        return (t === '확인' || t === 'OK') && r.width > 30 && r.width < 200 && el.childElementCount === 0;
      }).forEach(el => el.click());
    });
    await sleep(300);
    await page.evaluate(() => {
      [...document.querySelectorAll('*')].filter(el => {
        const t = (el.innerText || '').trim();
        const r = el.getBoundingClientRect();
        return t === '닫기' && r.width > 0 && el.childElementCount === 0;
      }).forEach(el => el.click());
    });
    await sleep(300);
  }

  // 현재 건 정보 가져오기
  async function getCurrentInfo() {
    return page.evaluate(() => {
      const text = document.body.innerText;
      const purposeM = text.match(/집행목적\(용도\)\n(.+)/);
      const methodM = text.match(/집행방식\n(.+)/);
      return {
        purpose: (purposeM?.[1] || '').trim(),
        method: (methodM?.[1] || '').trim(),
      };
    });
  }

  // 파일 다운로드 함수
  async function downloadFilesForCurrentItem(itemNum) {
    const itemDir = path.join(DL_DIR, String(itemNum));
    if (!fs.existsSync(itemDir)) fs.mkdirSync(itemDir, { recursive: true });

    // 파일 링크 확인
    const fileLinks = await page.evaluate(() => {
      const exts = ['.pdf', '.jpg', '.jpeg', '.png', '.hwp', '.xlsx', '.xls', '.docx', '.zip'];
      return [...document.querySelectorAll('*')]
        .filter(el => {
          if (el.childElementCount > 0) return false;
          const t = (el.innerText || '').trim();
          return t.length > 3 && exts.some(ext => t.toLowerCase().endsWith(ext)) && getComputedStyle(el).cursor === 'pointer';
        })
        .map(el => (el.innerText || '').trim());
    });

    if (fileLinks.length === 0) {
      console.log(`  파일 없음`);
      return [];
    }

    console.log(`  파일 ${fileLinks.length}개: ${fileLinks.join(', ')}`);

    // CDP 네트워크 감시로 atflGrpId 캡처
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Network.enable');

    let capturedGrpId = null;
    const grpIdPromise = new Promise((resolve) => {
      const timeout = setTimeout(() => resolve(null), 5000);
      cdp.on('Network.requestWillBeSent', (params) => {
        if (params.request.url.includes('retvFileList')) {
          try {
            const body = JSON.parse(params.request.postData);
            capturedGrpId = body.atflGrpId;
            clearTimeout(timeout);
            resolve(body.atflGrpId);
          } catch (e) {}
        }
      });
    });

    // 첫 번째 파일 클릭 → 팝업 열림 → atflGrpId 캡처
    await page.evaluate((fn) => {
      const exts = ['.pdf', '.jpg', '.jpeg', '.png', '.hwp', '.xlsx', '.xls'];
      const el = [...document.querySelectorAll('*')].find(el => {
        if (el.childElementCount > 0) return false;
        const t = (el.innerText || '').trim();
        return t === fn && getComputedStyle(el).cursor === 'pointer';
      });
      if (el) el.click();
    }, fileLinks[0]);

    const grpId = await grpIdPromise;
    await cdp.detach();

    if (!grpId) {
      console.log(`  atflGrpId 캡처 실패`);
      await closePopups();
      return [];
    }
    console.log(`  atflGrpId: ${grpId}`);

    // 파일 목록 조회
    const fileListResp = await page.evaluate(async (grpId) => {
      const resp = await fetch('/cm/retvFileList.do', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json; charset=UTF-8' },
        body: JSON.stringify({ dutDvCd: '', fileCn: '', atflGrpId: grpId, atflSnum: '' }),
      });
      return resp.json();
    }, grpId);

    const files = fileListResp.fileList || [];
    console.log(`  서버 파일 ${files.length}개`);

    const downloaded = [];

    // 각 파일 다운로드 (JSON POST)
    for (const file of files) {
      const fileName = file.fileNm || 'unknown.pdf';
      console.log(`  다운로드: ${fileName} (${Math.round(file.fileCpct / 1024)}KB)`);

      const result = await page.evaluate(async (params) => {
        try {
          const resp = await fetch('/cm/fileDownload.do', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json; charset=UTF-8' },
            body: JSON.stringify({ atflGrpId: params.grpId, atflSnum: params.snum }),
          });
          const ct = resp.headers.get('content-type') || '';
          const ab = await resp.arrayBuffer();
          const bytes = new Uint8Array(ab);
          let binary = '';
          // chunk to avoid call stack issues
          const CHUNK = 8192;
          for (let i = 0; i < bytes.length; i += CHUNK) {
            binary += String.fromCharCode.apply(null, bytes.subarray(i, Math.min(i + CHUNK, bytes.length)));
          }
          return { ok: true, size: ab.byteLength, ct, base64: btoa(binary) };
        } catch (e) {
          return { ok: false, error: e.message };
        }
      }, { grpId: grpId, snum: file.atflSnum });

      if (result.ok && result.size > 100) {
        const savePath = path.join(itemDir, fileName);
        fs.writeFileSync(savePath, Buffer.from(result.base64, 'base64'));
        console.log(`  ✓ 저장: ${fileName} (${Math.round(result.size / 1024)}KB)`);
        downloaded.push(fileName);
      } else {
        console.log(`  ✗ 실패: ${result.error || 'size=' + (result.size || 0)}`);
      }
    }

    // 팝업 닫기
    await closePopups();
    return downloaded;
  }

  // === 메인 루프 ===
  // 1. 현재 위치 확인
  await closePopups();
  let info = await getCurrentInfo();
  console.log(`현재 건: ${info.purpose}`);

  // 2. 첫 번째 건으로 이동
  // 현재 건의 차수 확인
  const currentNumMatch = info.purpose.match(/^(\d+)차_/);
  const targetNumMatch = '47'; // 1번 건 = 47차

  if (currentNumMatch && currentNumMatch[1] !== targetNumMatch) {
    console.log(`현재 ${currentNumMatch[1]}차 → 47차(1번)로 이동 필요`);
    // 이전 버튼으로 이동
    let moved = true;
    while (moved) {
      const curInfo = await getCurrentInfo();
      const curNum = (curInfo.purpose.match(/^(\d+)차_/) || [])[1];
      if (curNum === targetNumMatch) break;

      moved = await page.evaluate(() => {
        const btns = [...document.querySelectorAll('*')].filter(el => {
          const t = (el.innerText || '').trim();
          return t === '◀ 이전 집행정보 보기' && el.getBoundingClientRect().width > 0;
        });
        if (btns.length === 0) {
          // 텍스트 정확히 못 찾으면 포함 검색
          const btns2 = [...document.querySelectorAll('*')].filter(el => {
            const t = (el.innerText || '').trim();
            return t.includes('이전') && t.includes('집행정보') && el.getBoundingClientRect().width > 0 && el.childElementCount === 0;
          });
          if (btns2[0]) { btns2[0].click(); return true; }
          return false;
        }
        btns[0].click();
        return true;
      });

      if (moved) {
        await sleep(1200);
        await closePopups(); // "존재하지 않습니다" 팝업 처리
      }
    }
  }

  info = await getCurrentInfo();
  console.log(`시작 위치: ${info.purpose}`);

  // 3. 순차 처리
  const results = {};
  for (let i = START; i <= END; i++) {
    console.log(`\n========== [${i}/${END}] ==========`);
    info = await getCurrentInfo();
    console.log(`건: ${info.purpose.substring(0, 60)}`);
    console.log(`방식: ${info.method}`);

    const downloaded = await downloadFilesForCurrentItem(i);
    results[i] = { purpose: info.purpose, method: info.method, files: downloaded };

    // 다음 건으로 이동
    if (i < END) {
      const hasNext = await page.evaluate(() => {
        const btns = [...document.querySelectorAll('*')].filter(el => {
          const t = (el.innerText || '').trim();
          return t.includes('다음') && t.includes('집행정보') && el.getBoundingClientRect().width > 0 && el.childElementCount === 0;
        });
        if (btns[0]) { btns[0].click(); return true; }
        return false;
      });
      if (!hasNext) { console.log('다음 건 없음, 중단'); break; }
      await sleep(1200);
      await closePopups();
    }
  }

  // 결과 요약
  console.log('\n\n========== 결과 요약 ==========');
  for (const [num, r] of Object.entries(results)) {
    console.log(`[${num}] ${r.purpose.substring(0, 40)} | ${r.method} | 파일: ${r.files.length > 0 ? r.files.join(', ') : '없음'}`);
  }

  // JSON 저장
  fs.writeFileSync(path.join(DL_DIR, 'download-results.json'), JSON.stringify(results, null, 2));

  await b.close();
})().catch(e => console.error('ERROR:', e.message));
