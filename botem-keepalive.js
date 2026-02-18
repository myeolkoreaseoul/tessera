/**
 * 보탬e 세션 연장 keep-alive
 * 5분마다 우상단 새로고침 버튼 클릭
 *
 * 사용법:
 *   node botem-keepalive.js &   # 백그라운드 실행
 *   또는 별도 터미널에서 실행
 */
const { chromium } = require('playwright');

const INTERVAL_MS = 4 * 60 * 1000; // 4분마다 (5분 타임아웃 전에)

async function extendSession() {
  let browser;
  try {
    browser = await chromium.connectOverCDP('http://localhost:9445', { timeout: 10000 });
    const context = browser.contexts()[0];
    const page = context.pages().find(p => p.url().includes('lss.do'));
    if (!page) { console.log('[keep-alive] lss.do 탭 없음'); return; }

    const result = await page.evaluate(() => {
      // 파란색 새로고침 버튼 찾기 (카운트다운 타이머 옆)
      // cl-* 버튼 중 타이머/세션 관련 요소 찾기
      const candidates = [...document.querySelectorAll('[class*=cl-button], div[class*=btn]')]
        .filter(el => {
          const r = el.getBoundingClientRect();
          return r.x > window.innerWidth - 300 && r.y < 60 && r.width > 0;
        });

      if (candidates.length > 0) {
        // 타이머 가장 가까운 버튼 클릭
        candidates.sort((a, b) => a.getBoundingClientRect().x - b.getBoundingClientRect().x);
        candidates[candidates.length - 1].click();
        return '클릭 성공: ' + candidates.length + '개 후보';
      }

      // 대안: 카운트다운 숫자 옆 클릭 가능한 요소
      const timerDivs = [...document.querySelectorAll('div')].filter(d => {
        if (d.childElementCount > 0) return false;
        const t = d.innerText && d.innerText.trim();
        const r = d.getBoundingClientRect();
        return /^\d{1,2}:\d{2}$/.test(t) && r.y < 60;
      });

      if (timerDivs.length > 0) {
        const timer = timerDivs[0];
        const r = timer.getBoundingClientRect();
        // 타이머 오른쪽 클릭
        const nextEl = document.elementFromPoint(r.right + 20, r.y + r.height / 2);
        if (nextEl) { nextEl.click(); return '타이머 옆 클릭'; }
      }

      return '버튼 찾기 실패';
    });

    const time = new Date().toLocaleTimeString('ko-KR');
    console.log(`[keep-alive ${time}] ${result}`);
  } catch (e) {
    console.log('[keep-alive 오류]', e.message);
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
}

async function main() {
  console.log('[보탬e keep-alive 시작] 4분 간격으로 세션 연장');
  console.log('종료: Ctrl+C\n');

  // 즉시 1회 실행
  await extendSession();

  // 이후 4분마다 반복
  setInterval(extendSession, INTERVAL_MS);
}

main().catch(console.error);
