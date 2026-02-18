/**
 * 보탬e 집행내역 상세 - 증빙 정보 구조 파악
 * 현재 열린 건에서 증빙 탭/섹션/첨부파일 정보 캡처
 */
const { chromium } = require('playwright');
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

(async () => {
  const b = await chromium.connectOverCDP('http://localhost:9445', { timeout: 10000 });
  const page = b.contexts()[0].pages().find(p => p.url().includes('lss.do'));
  if (!page) { console.error('lss.do 탭 없음'); process.exit(1); }

  // 1) 현재 건 기본 정보
  const basicInfo = await page.evaluate(() => {
    const text = document.body.innerText;
    return text.substring(0, 5000).replace(/\n{3,}/g, '\n\n');
  });
  console.log('=== 현재 페이지 텍스트 (5000자) ===');
  console.log(basicInfo);

  // 2) 탭 목록 확인 (증빙 관련 탭이 있는지)
  const tabs = await page.evaluate(() => {
    const tabItems = [...document.querySelectorAll('.cl-tabfolder-item, [class*="tab-item"], [role="tab"]')]
      .filter(el => el.getBoundingClientRect().width > 0);
    return tabItems.map(el => ({
      text: (el.innerText || '').trim(),
      selected: el.classList.contains('cl-selected') || el.getAttribute('aria-selected') === 'true',
      class: el.className.substring(0, 80),
    }));
  });
  console.log('\n=== 탭 목록 ===');
  tabs.forEach(t => console.log(`  ${t.selected ? '→' : ' '} "${t.text}" [${t.class.substring(0, 40)}]`));

  // 3) 증빙 관련 키워드가 있는 섹션 찾기
  const evidenceSections = await page.evaluate(() => {
    const keywords = ['증빙', '첨부', '파일', '서류', '영수증', '세금계산서', '계약서', '이력서'];
    const matches = [];
    const allEls = document.querySelectorAll('*');
    for (const el of allEls) {
      if (el.childElementCount > 0) continue;
      const t = (el.innerText || '').trim();
      if (t.length < 3 || t.length > 100) continue;
      for (const kw of keywords) {
        if (t.includes(kw)) {
          matches.push({
            text: t,
            tag: el.tagName,
            class: el.className.substring(0, 60),
            parentClass: (el.parentElement?.className || '').substring(0, 60),
          });
          break;
        }
      }
    }
    return matches.slice(0, 30);
  });
  console.log('\n=== 증빙 관련 요소 ===');
  evidenceSections.forEach(e => console.log(`  "${e.text}" [${e.tag}.${e.class}]`));

  // 4) 링크/버튼 중 증빙 관련
  const evidenceLinks = await page.evaluate(() => {
    const links = [...document.querySelectorAll('a, button, [role="button"], .cl-button')]
      .filter(el => {
        const t = (el.innerText || '').trim();
        const r = el.getBoundingClientRect();
        return r.width > 0 && (
          t.includes('증빙') || t.includes('첨부') || t.includes('다운') ||
          t.includes('파일') || t.includes('보기') || t.includes('조회')
        );
      });
    return links.map(el => ({
      text: (el.innerText || '').trim().substring(0, 50),
      tag: el.tagName,
      href: el.href || '',
      class: el.className.substring(0, 60),
    }));
  });
  console.log('\n=== 증빙 관련 링크/버튼 ===');
  evidenceLinks.forEach(l => console.log(`  "${l.text}" [${l.tag}] href=${l.href}`));

  // 5) 스크린샷 (전체)
  await page.screenshot({ path: '/tmp/botem-evidence.png', fullPage: true });
  console.log('\n스크린샷: /tmp/botem-evidence.png');

  await b.close();
})().catch(e => console.error('ERROR:', e.message));
