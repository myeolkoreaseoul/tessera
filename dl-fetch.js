// retvFileList → fileDownload.do fetch로 직접 다운로드 (CDP download 우회)
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

const DL_DIR = '/home/john/e-naradomum-rpa/projects/캠퍼스타운-고려대/downloads';
if (!fs.existsSync(DL_DIR)) fs.mkdirSync(DL_DIR, { recursive: true });

(async () => {
  const b = await chromium.connectOverCDP('http://100.87.3.123:9445', { timeout: 10000 });
  const ctx = b.contexts()[0];
  const page = ctx.pages().find(p => p.url().includes('lss.do'));
  if (!page) { console.error('lss.do 탭 없음'); process.exit(1); }

  // 현재 팝업 닫기
  await page.evaluate(() => {
    const btn = [...document.querySelectorAll('*')].find(el =>
      (el.innerText || '').trim() === '닫기' && el.getBoundingClientRect().width > 0 && el.childElementCount === 0
    );
    if (btn) btn.click();
  });
  await sleep(500);

  // 현재 건 정보 확인
  const info = await page.evaluate(() => {
    const text = document.body.innerText;
    const m = text.match(/집행목적\(용도\)\n(.+)/);
    return (m && m[1]) ? m[1].trim() : '';
  });
  console.log('현재 건:', info);

  // Step 1: 파일 클릭하여 atflGrpId 캡처
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Network.enable');

  let atflGrpId = null;
  cdp.on('Network.requestWillBeSent', (params) => {
    if (params.request.url.includes('retvFileList')) {
      try {
        const body = JSON.parse(params.request.postData);
        atflGrpId = body.atflGrpId;
        console.log('atflGrpId 캡처:', atflGrpId);
      } catch (e) {}
    }
  });

  // 파일 클릭
  await page.evaluate(() => {
    const exts = ['.pdf', '.jpg', '.jpeg', '.png', '.hwp', '.xlsx', '.xls'];
    const el = [...document.querySelectorAll('*')].find(el => {
      if (el.childElementCount > 0) return false;
      const t = (el.innerText || '').trim();
      return t.length > 3 && exts.some(ext => t.toLowerCase().endsWith(ext)) && getComputedStyle(el).cursor === 'pointer';
    });
    if (el) el.click();
  });
  await sleep(2000);

  if (!atflGrpId) {
    console.error('atflGrpId 캡처 실패');
    await cdp.detach();
    await b.close();
    process.exit(1);
  }

  // Step 2: retvFileList.do로 파일 목록 가져오기
  console.log('\n=== 파일 목록 조회 ===');
  const fileList = await page.evaluate(async (grpId) => {
    try {
      const resp = await fetch('/cm/retvFileList.do', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json; charset=UTF-8' },
        body: JSON.stringify({ dutDvCd: '', fileCn: '', atflGrpId: grpId, atflSnum: '' }),
      });
      return await resp.json();
    } catch (e) {
      return { error: e.message };
    }
  }, atflGrpId);

  console.log('파일 목록 응답:', JSON.stringify(fileList, null, 2));

  // Step 3: 파일 다운로드 (fetch로)
  const files = fileList.list || fileList.data || fileList || [];
  if (Array.isArray(files) && files.length > 0) {
    for (const file of files) {
      console.log('\n파일 정보:', JSON.stringify(file));

      // fileDownload.do 호출에 필요한 파라미터 추론
      // 일반적으로 atflGrpId + atflSnum 또는 fileId가 필요
      const downloadParams = {
        atflGrpId: atflGrpId,
        atflSnum: file.atflSnum || file.snum || '1',
      };

      console.log('다운로드 파라미터:', JSON.stringify(downloadParams));

      // fetch로 다운로드 (arraybuffer)
      const result = await page.evaluate(async (params) => {
        try {
          // 방법 1: form 형태로 POST
          const formBody = Object.entries(params)
            .map(([k, v]) => encodeURIComponent(k) + '=' + encodeURIComponent(v))
            .join('&');

          const resp = await fetch('/cm/fileDownload.do', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: formBody,
          });

          const contentType = resp.headers.get('content-type') || '';
          const contentDisp = resp.headers.get('content-disposition') || '';
          const status = resp.status;

          if (status !== 200) {
            return { ok: false, error: `HTTP ${status}`, contentType };
          }

          // blob → base64
          const blob = await resp.blob();
          const reader = new FileReader();
          const base64 = await new Promise((resolve) => {
            reader.onload = () => resolve(reader.result.split(',')[1]);
            reader.readAsDataURL(blob);
          });

          return {
            ok: true,
            size: blob.size,
            contentType,
            contentDisp,
            base64,
          };
        } catch (e) {
          return { ok: false, error: e.message };
        }
      }, downloadParams);

      if (result.ok) {
        const fileName = file.orgnlAtflNm || file.fileName || file.fileCn || 'unknown.pdf';
        const savePath = path.join(DL_DIR, '2', fileName);
        if (!fs.existsSync(path.dirname(savePath))) fs.mkdirSync(path.dirname(savePath), { recursive: true });
        fs.writeFileSync(savePath, Buffer.from(result.base64, 'base64'));
        console.log(`저장 완료: ${savePath} (${Math.round(result.size / 1024)}KB)`);
        console.log(`Content-Type: ${result.contentType}`);
        console.log(`Content-Disposition: ${result.contentDisp}`);
      } else {
        console.log('다운로드 실패:', result.error, result.contentType);

        // 방법 2: JSON으로 POST
        console.log('JSON 방식 재시도...');
        const result2 = await page.evaluate(async (params) => {
          try {
            const resp = await fetch('/cm/fileDownload.do', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json; charset=UTF-8' },
              body: JSON.stringify(params),
            });
            const blob = await resp.blob();
            const reader = new FileReader();
            const base64 = await new Promise((resolve) => {
              reader.onload = () => resolve(reader.result.split(',')[1]);
              reader.readAsDataURL(blob);
            });
            return { ok: true, size: blob.size, base64 };
          } catch (e) {
            return { ok: false, error: e.message };
          }
        }, downloadParams);

        if (result2.ok && result2.size > 100) {
          const fileName = file.orgnlAtflNm || file.fileName || 'unknown.pdf';
          const savePath = path.join(DL_DIR, '2', fileName);
          if (!fs.existsSync(path.dirname(savePath))) fs.mkdirSync(path.dirname(savePath), { recursive: true });
          fs.writeFileSync(savePath, Buffer.from(result2.base64, 'base64'));
          console.log(`JSON방식 저장: ${savePath} (${Math.round(result2.size / 1024)}KB)`);
        } else {
          console.log('JSON방식도 실패:', result2.error);
        }
      }
    }
  } else {
    console.log('파일 목록이 비어있거나 구조가 다름');
  }

  // 팝업 닫기
  await page.evaluate(() => {
    const btn = [...document.querySelectorAll('*')].find(el =>
      (el.innerText || '').trim() === '닫기' && el.getBoundingClientRect().width > 0 && el.childElementCount === 0
    );
    if (btn) btn.click();
  });

  await cdp.detach();
  await b.close();
})().catch(e => console.error('ERROR:', e.message));
