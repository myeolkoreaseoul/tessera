/**
 * 기본서류 링크의 정확한 DOM 구조 파악
 */
const { chromium } = require('playwright');
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

(async () => {
  const b = await chromium.connectOverCDP('http://localhost:9445', { timeout: 10000 });
  const page = b.contexts()[0].pages().find(p => p.url().includes('lss.do'));
  if (!page) { console.error('lss.do 탭 없음'); process.exit(1); }

  // "기본서류" 레이블의 부모 구조 전체 분석
  const dom = await page.evaluate(() => {
    // "기본서류" 텍스트를 포함하는 leaf 요소 찾기
    const labels = [...document.querySelectorAll('*')].filter(el =>
      el.childElementCount === 0 &&
      (el.innerText || '').trim() === '기본서류' &&
      el.getBoundingClientRect().width > 0
    );

    const result = [];
    for (const label of labels) {
      // 부모 5단계까지 올라가며 구조 분석
      const ancestry = [];
      let el = label;
      for (let i = 0; i < 8 && el; i++) {
        const children = [...el.children].map(c => ({
          tag: c.tagName,
          class: c.className.substring(0, 80),
          id: c.id.substring(0, 40),
          text: (c.innerText || '').trim().substring(0, 80),
          childCount: c.childElementCount,
          hasHref: !!c.href,
          onclick: (c.getAttribute('onclick') || '').substring(0, 80),
          cursor: getComputedStyle(c).cursor,
          visible: c.getBoundingClientRect().width > 0,
        }));
        ancestry.push({
          level: i,
          tag: el.tagName,
          class: el.className.substring(0, 80),
          id: el.id.substring(0, 40),
          childrenCount: el.children.length,
          children: children.slice(0, 10),
        });
        el = el.parentElement;
      }
      result.push({ labelClass: label.className, ancestry });
    }

    // 또한 파란 링크처럼 보이는 요소 (cursor: pointer, color: blue 계열)
    const blueLinks = [...document.querySelectorAll('*')].filter(el => {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || el.childElementCount > 0) return false;
      const style = getComputedStyle(el);
      const text = (el.innerText || '').trim();
      return text.length > 5 && (
        style.cursor === 'pointer' ||
        style.color.includes('0, 0, 255') ||
        style.color.includes('0, 102') ||
        style.textDecoration.includes('underline') ||
        el.closest('a') !== null ||
        text.endsWith('.pdf') || text.endsWith('.jpg') || text.endsWith('.hwp')
      );
    }).map(el => ({
      text: (el.innerText || '').trim().substring(0, 80),
      tag: el.tagName,
      class: el.className.substring(0, 60),
      parentTag: el.parentElement?.tagName,
      parentClass: (el.parentElement?.className || '').substring(0, 60),
      cursor: getComputedStyle(el).cursor,
      color: getComputedStyle(el).color,
      href: el.closest('a')?.href || '',
      onclick: (el.getAttribute('onclick') || el.parentElement?.getAttribute('onclick') || '').substring(0, 100),
    }));

    return { labels: result, blueLinks };
  });

  console.log('=== 기본서류 레이블 DOM 구조 ===');
  dom.labels.forEach((lbl, li) => {
    console.log(`\n레이블[${li}] class="${lbl.labelClass}"`);
    lbl.ancestry.forEach(a => {
      console.log(`  L${a.level}: <${a.tag}> class="${a.class}" id="${a.id}" children=${a.childrenCount}`);
      a.children.forEach(c => {
        const extra = c.hasHref ? ' [href]' : '';
        const onclick = c.onclick ? ` onclick="${c.onclick}"` : '';
        const cursor = c.cursor === 'pointer' ? ' [pointer]' : '';
        console.log(`    → <${c.tag}> "${c.text.substring(0, 50)}" class="${c.class.substring(0, 40)}"${extra}${onclick}${cursor}`);
      });
    });
  });

  console.log('\n=== 파란 링크 / 클릭 가능 요소 ===');
  dom.blueLinks.forEach(l => {
    console.log(`  "${l.text}" <${l.tag}> parent=<${l.parentTag}.${l.parentClass.substring(0, 30)}> cursor=${l.cursor} color=${l.color}`);
    if (l.href) console.log(`    href: ${l.href.substring(0, 120)}`);
    if (l.onclick) console.log(`    onclick: ${l.onclick}`);
  });

  await b.close();
})().catch(e => console.error('ERROR:', e.message));
