/**
 * 보탬e 탭 상태 확인 + DOM 탐색 도구
 *
 * 사용법:
 *   node check-botem.js [--port=9445]
 *
 * 기능:
 *  1) Chrome 9445 포트 연결
 *  2) 모든 탭 URL 출력
 *  3) 보탬e 페이지 발견 시 → 현재 화면 DOM 구조 출력
 */
const { chromium } = require('playwright');

const args = process.argv.slice(2);
const port = (args.find(a => a.startsWith('--port=')) || '--port=9445').split('=')[1];
const CDP_HOST = process.env.CDP_HOST || '100.87.3.123';

async function main() {
  console.log(`[연결] Chrome CDP @ http://${CDP_HOST}:${port}`);

  let browser;
  try {
    browser = await chromium.connectOverCDP(`http://${CDP_HOST}:${port}`, { timeout: 10000 });
  } catch (e) {
    console.error(`연결 실패: ${e.message}`);
    console.error('→ 회사 PC에서 Chrome을 실행하세요:');
    console.error(`  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe" --remote-debugging-port=${port} --user-data-dir=C:\\chrome-debug-2`);
    process.exit(1);
  }

  const context = browser.contexts()[0];
  const pages = context.pages();

  console.log(`\n[탭 목록] ${pages.length}개`);
  for (let i = 0; i < pages.length; i++) {
    console.log(`  [${i}] ${pages[i].url()}`);
  }

  // 보탬e 페이지 찾기
  const botemPage = pages.find(p =>
    p.url().includes('seoulbotem') ||
    p.url().includes('losims') ||
    p.url().includes('botem') ||
    p.url().includes('seoul.go.kr')
  );

  if (!botemPage) {
    console.log('\n⚠  보탬e 페이지 없음. 보탬e에 로그인 후 재실행하세요.');
    console.log('   보탬e URL: https://www.seoulbotem.go.kr');
    await browser.close();
    return;
  }

  console.log(`\n[보탬e 페이지 발견]`);
  console.log(`  URL: ${botemPage.url()}`);
  console.log(`  Title: ${await botemPage.title()}`);

  // DOM 구조 탐색
  console.log('\n[DOM 탐색] 주요 테이블/그리드 확인...');
  const domInfo = await botemPage.evaluate(() => {
    const info = {};

    // 테이블 목록
    const tables = document.querySelectorAll('table');
    info.tableCount = tables.length;
    info.tables = [...tables].slice(0, 10).map((t, i) => ({
      index: i,
      id: t.id || '',
      className: t.className || '',
      rows: t.rows.length,
    }));

    // 주요 폼 요소
    const selects = document.querySelectorAll('select');
    info.selects = [...selects].slice(0, 10).map(s => ({
      id: s.id || '',
      name: s.name || '',
      options: [...s.options].map(o => o.text).slice(0, 5),
    }));

    // 버튼 목록
    const buttons = document.querySelectorAll('button, input[type=button], input[type=submit]');
    info.buttons = [...buttons].slice(0, 15).map(b => ({
      id: b.id || '',
      text: (b.textContent || b.value || '').trim().substring(0, 20),
    }));

    // 입력 필드
    const inputs = document.querySelectorAll('input[type=text], input[type=search]');
    info.inputs = [...inputs].slice(0, 10).map(i => ({
      id: i.id || '',
      name: i.name || '',
      placeholder: i.placeholder || '',
    }));

    // window 전역 객체 (그리드 관련)
    const gridKeys = Object.keys(window).filter(k =>
      k.toLowerCase().includes('grid') ||
      k.toLowerCase().includes('list') ||
      k.toLowerCase().includes('table')
    ).slice(0, 20);
    info.globalGrids = gridKeys;

    // 현재 페이지 주요 텍스트
    const h1s = [...document.querySelectorAll('h1, h2, h3, .title, .tit')].map(h => h.textContent.trim()).filter(t => t).slice(0, 5);
    info.headings = h1s;

    return info;
  });

  console.log('\n--- 테이블:', domInfo.tableCount, '개 ---');
  for (const t of domInfo.tables) {
    console.log(`  [${t.index}] id="${t.id}" class="${t.className}" rows=${t.rows}`);
  }

  console.log('\n--- select 요소 ---');
  for (const s of domInfo.selects) {
    console.log(`  id="${s.id}" name="${s.name}" options=[${s.options.join(', ')}]`);
  }

  console.log('\n--- 버튼 ---');
  for (const b of domInfo.buttons) {
    console.log(`  id="${b.id}" text="${b.text}"`);
  }

  console.log('\n--- 입력 필드 ---');
  for (const i of domInfo.inputs) {
    console.log(`  id="${i.id}" name="${i.name}" placeholder="${i.placeholder}"`);
  }

  console.log('\n--- 전역 그리드 변수 ---');
  console.log(' ', domInfo.globalGrids.join(', ') || '없음');

  console.log('\n--- 제목/헤딩 ---');
  for (const h of domInfo.headings) {
    console.log(`  "${h}"`);
  }

  // 스크린샷 저장
  const shotPath = `/tmp/botem-screen-${Date.now()}.png`;
  await botemPage.screenshot({ path: shotPath, fullPage: false });
  console.log(`\n[스크린샷] ${shotPath}`);

  await browser.close();
}

main().catch(e => {
  console.error('ERROR:', e.message);
  process.exit(1);
});
