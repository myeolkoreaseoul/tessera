/**
 * 현재 건의 기본서류 PDF 다운로드 + 증빙자료 확인 테스트
 */
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

const DOWNLOAD_DIR = path.join(__dirname, 'projects/캠퍼스타운-고려대/downloads');

(async () => {
  if (!fs.existsSync(DOWNLOAD_DIR)) fs.mkdirSync(DOWNLOAD_DIR, { recursive: true });

  const b = await chromium.connectOverCDP('http://localhost:9445', { timeout: 10000 });
  const ctx = b.contexts()[0];
  const page = ctx.pages().find(p => p.url().includes('lss.do'));
  if (!page) { console.error('lss.do 탭 없음'); process.exit(1); }

  // 현재 건 정보
  const info = await page.evaluate(() => {
    const text = document.body.innerText;
    const purposeM = text.match(/집행목적\(용도\)\n(.+)/);
    return { purpose: (purposeM?.[1] || '').trim().substring(0, 60) };
  });
  console.log('현재 건:', info.purpose);

  // 기본서류 링크 찾기
  const basicDocLinks = await page.evaluate(() => {
    // "기본서류" 레이블 찾기
    const labels = [...document.querySelectorAll('*')].filter(el =>
      el.childElementCount === 0 && (el.innerText || '').trim() === '기본서류'
    );

    const results = [];
    for (const label of labels) {
      // 부모를 타고 올라가면서 같은 행의 링크/클릭 가능 요소 찾기
      let parent = label.parentElement;
      for (let i = 0; i < 5 && parent; i++) {
        const clickables = [...parent.querySelectorAll('a, [class*="link"], [class*="file"], [onclick]')]
          .filter(el => {
            const t = (el.innerText || '').trim();
            const r = el.getBoundingClientRect();
            return r.width > 0 && t.length > 0 && t !== '기본서류';
          });
        if (clickables.length > 0) {
          clickables.forEach(el => {
            results.push({
              text: (el.innerText || '').trim(),
              tag: el.tagName,
              href: el.href || '',
              class: el.className.substring(0, 80),
              onclick: (el.getAttribute('onclick') || '').substring(0, 100),
              id: el.id,
            });
          });
          break;
        }
        parent = parent.parentElement;
      }
    }
    return results;
  });

  console.log('\n=== 기본서류 링크 ===');
  basicDocLinks.forEach(l => {
    console.log(`  "${l.text}" [${l.tag}] href="${l.href}" onclick="${l.onclick}" class="${l.class}"`);
  });

  // 증빙자료 링크 찾기
  const evidenceDataLinks = await page.evaluate(() => {
    const labels = [...document.querySelectorAll('*')].filter(el =>
      el.childElementCount === 0 && (el.innerText || '').trim() === '증빙자료'
    );
    const results = [];
    for (const label of labels) {
      let parent = label.parentElement;
      for (let i = 0; i < 5 && parent; i++) {
        const clickables = [...parent.querySelectorAll('a, [class*="link"], [class*="file"], [onclick]')]
          .filter(el => {
            const t = (el.innerText || '').trim();
            const r = el.getBoundingClientRect();
            return r.width > 0 && t.length > 0 && t !== '증빙자료';
          });
        if (clickables.length > 0) {
          clickables.forEach(el => {
            results.push({
              text: (el.innerText || '').trim(),
              tag: el.tagName,
              href: el.href || '',
              class: el.className.substring(0, 80),
              onclick: (el.getAttribute('onclick') || '').substring(0, 100),
            });
          });
          break;
        }
        parent = parent.parentElement;
      }
    }
    return results;
  });

  console.log('\n=== 증빙자료 링크 ===');
  if (evidenceDataLinks.length === 0) console.log('  (없음)');
  evidenceDataLinks.forEach(l => {
    console.log(`  "${l.text}" [${l.tag}] href="${l.href}" onclick="${l.onclick}"`);
  });

  // 증빙서류 링크도 확인
  const evidenceDocLinks = await page.evaluate(() => {
    const labels = [...document.querySelectorAll('*')].filter(el =>
      el.childElementCount === 0 && (el.innerText || '').trim() === '증빙서류'
    );
    const results = [];
    for (const label of labels) {
      let parent = label.parentElement;
      for (let i = 0; i < 5 && parent; i++) {
        const clickables = [...parent.querySelectorAll('a, [class*="link"], [class*="file"], [onclick]')]
          .filter(el => {
            const t = (el.innerText || '').trim();
            const r = el.getBoundingClientRect();
            return r.width > 0 && t.length > 0 && t !== '증빙서류';
          });
        if (clickables.length > 0) {
          clickables.forEach(el => {
            results.push({
              text: (el.innerText || '').trim(),
              tag: el.tagName,
              href: el.href || '',
              class: el.className.substring(0, 80),
              onclick: (el.getAttribute('onclick') || '').substring(0, 100),
            });
          });
          break;
        }
        parent = parent.parentElement;
      }
    }
    return results;
  });

  console.log('\n=== 증빙서류 링크 ===');
  if (evidenceDocLinks.length === 0) console.log('  (없음)');
  evidenceDocLinks.forEach(l => {
    console.log(`  "${l.text}" [${l.tag}] href="${l.href}" onclick="${l.onclick}"`);
  });

  // 기본서류 다운로드 시도
  if (basicDocLinks.length > 0) {
    console.log('\n--- 기본서류 다운로드 시도 ---');
    const link = basicDocLinks[0];

    // 다운로드 이벤트 대기
    const downloadPromise = page.waitForEvent('download', { timeout: 10000 }).catch(() => null);

    // 링크 클릭 (Playwright native)
    if (link.href && link.href !== '') {
      // 직접 href가 있으면 navigate
      console.log('href 있음:', link.href.substring(0, 100));
    }

    // DOM에서 클릭
    await page.evaluate((linkText) => {
      const els = [...document.querySelectorAll('a, [class*="link"]')]
        .filter(el => (el.innerText || '').trim() === linkText && el.getBoundingClientRect().width > 0);
      if (els.length > 0) els[0].click();
    }, link.text);

    console.log('클릭 완료, 다운로드 대기...');
    const download = await downloadPromise;

    if (download) {
      const suggestedName = download.suggestedFilename();
      const savePath = path.join(DOWNLOAD_DIR, suggestedName);
      await download.saveAs(savePath);
      const size = fs.statSync(savePath).size;
      console.log(`✓ 다운로드: ${suggestedName} (${Math.round(size/1024)}KB)`);
    } else {
      console.log('다운로드 이벤트 없음 — 새 탭/팝업 확인...');
      await sleep(2000);
      // 새 탭이 열렸는지 확인
      const allPages = ctx.pages();
      console.log(`열린 탭 수: ${allPages.length}`);
      for (const p of allPages) {
        const url = p.url();
        if (url !== page.url() && !url.includes('about:blank')) {
          console.log(`새 탭 URL: ${url.substring(0, 200)}`);
          // PDF면 다운로드
          if (url.includes('.pdf') || url.includes('download') || url.includes('file')) {
            await p.screenshot({ path: '/tmp/botem-pdf-tab.png' });
            console.log('새 탭 스크린샷: /tmp/botem-pdf-tab.png');
          }
        }
      }
    }
  }

  // 스크린샷
  await page.screenshot({ path: '/tmp/botem-download-test.png' });
  console.log('\n스크린샷: /tmp/botem-download-test.png');

  await b.close();
})().catch(e => console.error('ERROR:', e.message));
