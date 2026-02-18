// 파일 다운로드 - fileUrl + sysStrgFileNm 직접 또는 fileDownload.do
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

const DL_DIR = '/home/john/e-naradomum-rpa/projects/캠퍼스타운-고려대/downloads/2';
if (!fs.existsSync(DL_DIR)) fs.mkdirSync(DL_DIR, { recursive: true });

const ATFL_GRP_ID = 'PRIVAB01246a86-a56e-4828-b831-203d8061e0c0';
const FILE_INFO = {
  atflSnum: 1,
  fileNm: '창업스튜디오_시설비_빔프로젝터 수리.pdf',
  fileUrl: '/appfile/LSS/PRIVAB/SM/2025/04/09',
  sysStrgFileNm: '3c78450c-2edd-4f2e-865a-18429c740286.pdf',
  fileCpct: 567258,
};

(async () => {
  const b = await chromium.connectOverCDP('http://100.87.3.123:9445', { timeout: 10000 });
  const ctx = b.contexts()[0];
  const page = ctx.pages().find(p => p.url().includes('lss.do'));
  if (!page) { console.error('lss.do 탭 없음'); process.exit(1); }

  // 팝업 닫기
  await page.evaluate(() => {
    const btn = [...document.querySelectorAll('*')].find(el =>
      (el.innerText || '').trim() === '닫기' && el.getBoundingClientRect().width > 0 && el.childElementCount === 0
    );
    if (btn) btn.click();
  });
  await sleep(300);

  // 방법 1: 직접 URL로 fetch
  const directUrl = FILE_INFO.fileUrl + '/' + FILE_INFO.sysStrgFileNm;
  console.log('방법1 - 직접 URL:', directUrl);

  const r1 = await page.evaluate(async (url) => {
    try {
      const resp = await fetch(url);
      const ct = resp.headers.get('content-type') || '';
      const cd = resp.headers.get('content-disposition') || '';
      if (resp.status !== 200) return { ok: false, status: resp.status, ct };
      const ab = await resp.arrayBuffer();
      const bytes = new Uint8Array(ab);
      let binary = '';
      for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
      return { ok: true, size: ab.byteLength, ct, cd, base64: btoa(binary) };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  }, directUrl);
  console.log('결과:', r1.ok ? `${r1.size}bytes, ${r1.ct}` : `실패: ${r1.error || r1.status}`);

  if (r1.ok && r1.size > 100) {
    const savePath = path.join(DL_DIR, FILE_INFO.fileNm);
    fs.writeFileSync(savePath, Buffer.from(r1.base64, 'base64'));
    console.log(`저장: ${savePath} (${Math.round(r1.size / 1024)}KB)`);
  }

  // 방법 2: fileDownload.do (form-urlencoded)
  if (!r1.ok || r1.size <= 100) {
    console.log('\n방법2 - fileDownload.do (form)');
    const r2 = await page.evaluate(async (params) => {
      try {
        const body = `atflGrpId=${encodeURIComponent(params.grpId)}&atflSnum=${params.snum}`;
        const resp = await fetch('/cm/fileDownload.do', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body,
        });
        const ct = resp.headers.get('content-type') || '';
        const ab = await resp.arrayBuffer();
        const bytes = new Uint8Array(ab);
        let binary = '';
        for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
        return { ok: true, size: ab.byteLength, ct, base64: btoa(binary) };
      } catch (e) {
        return { ok: false, error: e.message };
      }
    }, { grpId: ATFL_GRP_ID, snum: FILE_INFO.atflSnum });
    console.log('결과:', r2.ok ? `${r2.size}bytes, ${r2.ct}` : `실패: ${r2.error}`);

    if (r2.ok && r2.size > 100) {
      const savePath = path.join(DL_DIR, FILE_INFO.fileNm);
      fs.writeFileSync(savePath, Buffer.from(r2.base64, 'base64'));
      console.log(`저장: ${savePath} (${Math.round(r2.size / 1024)}KB)`);
    }
  }

  // 방법 3: fileDownload.do (JSON)
  if (!r1.ok || r1.size <= 100) {
    console.log('\n방법3 - fileDownload.do (JSON)');
    const r3 = await page.evaluate(async (params) => {
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
        for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
        return { ok: true, size: ab.byteLength, ct, base64: btoa(binary) };
      } catch (e) {
        return { ok: false, error: e.message };
      }
    }, { grpId: ATFL_GRP_ID, snum: FILE_INFO.atflSnum });
    console.log('결과:', r3.ok ? `${r3.size}bytes, ${r3.ct}` : `실패: ${r3.error}`);

    if (r3.ok && r3.size > 100) {
      const savePath = path.join(DL_DIR, FILE_INFO.fileNm);
      fs.writeFileSync(savePath, Buffer.from(r3.base64, 'base64'));
      console.log(`저장: ${savePath} (${Math.round(r3.size / 1024)}KB)`);
    }
  }

  await b.close();
})().catch(e => console.error('ERROR:', e.message));
