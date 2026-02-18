const { chromium } = require('playwright');
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

(async () => {
  const b = await chromium.connectOverCDP('http://100.87.3.123:9445', { timeout: 10000 });
  const page = b.contexts()[0].pages().find(p => p.url().includes('lss.do'));
  if (!page) { console.error('lss.do 탭 없음'); process.exit(1); }

  const debug = await page.evaluate(() => {
    // 1. "검증검토의견" 레이블 찾기
    const labels = [...document.querySelectorAll('*')].filter(el =>
      el.childElementCount === 0 && (el.innerText || '').trim() === '검증검토의견'
    );
    const labelInfo = labels.map(l => ({
      tag: l.tagName, cls: l.className.substring(0, 60),
      parentCls: l.parentElement?.className?.substring(0, 60) || '',
    }));

    // 2. 레이블에서 위로 올라가면서 textarea 계열 요소 탐색
    let searchPath = [];
    if (labels.length > 0) {
      let p = labels[0].parentElement;
      for (let i = 0; i < 12 && p; i++) {
        const textareas = p.querySelectorAll('[class*="cl-textarea"], textarea');
        const inputs = p.querySelectorAll('[class*="cl-input"], input[type="text"]');
        searchPath.push({
          level: i,
          tag: p.tagName,
          cls: p.className.substring(0, 60),
          textareas: textareas.length,
          inputs: inputs.length,
          children: p.children.length,
        });
        if (textareas.length > 0) {
          searchPath.push({
            found: true,
            textareaId: textareas[0].id,
            textareaCls: textareas[0].className.substring(0, 60),
            textareaTag: textareas[0].tagName,
          });
          break;
        }
        p = p.parentElement;
      }
    }

    // 3. 모든 textarea 요소 (native)
    const nativeTextareas = [...document.querySelectorAll('textarea')].map(ta => ({
      id: ta.id,
      name: ta.name,
      parentId: ta.parentElement?.id || '',
      parentCls: ta.parentElement?.className?.substring(0, 60) || '',
      w: Math.round(ta.getBoundingClientRect().width),
      value: ta.value.substring(0, 30),
    })).filter(t => t.w > 50);

    return { labelInfo, searchPath, nativeTextareas };
  });

  console.log('레이블:', JSON.stringify(debug.labelInfo, null, 2));
  console.log('\n탐색 경로:', JSON.stringify(debug.searchPath, null, 2));
  console.log('\nnative textarea:', JSON.stringify(debug.nativeTextareas, null, 2));
  await b.close();
})().catch(e => console.error('ERROR:', e.message));
