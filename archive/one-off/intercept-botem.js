/**
 * 보탬e 네트워크 인터셉트로 집행내역 API 응답 캡처
 * node intercept-botem.js
 */
const { chromium } = require('playwright');
const fs = require('fs');
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

const OUTPUT = 'projects/캠퍼스타운-고려대/data.json';

(async () => {
  const browser = await chromium.connectOverCDP('http://localhost:9445', { timeout: 10000 });
  const context = browser.contexts()[0];
  const page = context.pages().find(p => p.url().includes('lss.do'));
  page.on('dialog', async d => { try { await d.accept(); } catch {} });

  console.log('현재 URL:', page.url());
  console.log('현재 페이지:', (await page.evaluate(() => document.body.innerText)).substring(0, 100));

  // API 응답 수집
  const apiResponses = [];
  page.on('response', async (res) => {
    const url = res.url();
    const status = res.status();
    if (status !== 200) return;
    const ct = res.headers()['content-type'] || '';
    if (!ct.includes('json')) return;
    try {
      const text = await res.text();
      if (text.length < 50) return;
      const parsed = JSON.parse(text);
      apiResponses.push({ url, data: parsed });
      // 핵심 데이터 로그
      const keys = Array.isArray(parsed) ? Object.keys(parsed[0] || {}) :
                   Object.keys(parsed.data || parsed.list || parsed.items || parsed || {});
      console.log(`[API] ${url.split('/').slice(-2).join('/')} → ${JSON.stringify(keys).substring(0, 80)}`);
    } catch {}
  });

  // 조회 버튼 클릭
  console.log('\n[조회 클릭]');
  const clicked = await page.evaluate(() => {
    const candidates = [...document.querySelectorAll('div, a')].filter(el => {
      const t = el.innerText?.trim();
      const r = el.getBoundingClientRect();
      return t === '조회' && r.width > 0 && r.y > 50 && r.y < 600;
    });
    if (candidates.length > 0) { candidates[0].click(); return candidates.length; }
    return 0;
  });
  console.log('조회 버튼 클릭:', clicked, '개 발견');

  // 응답 대기
  await sleep(6000);

  console.log('\n수집된 API 응답:', apiResponses.length, '개');
  apiResponses.forEach((r, i) => {
    const sample = Array.isArray(r.data) ? r.data[0] :
                   r.data?.data?.[0] || r.data?.list?.[0] || r.data?.items?.[0];
    console.log(`[${i}] ${r.url}`);
    if (sample) console.log('    샘플:', JSON.stringify(sample).substring(0, 150));
  });

  // 집행내역 데이터 찾기
  let execData = null;
  for (const r of apiResponses) {
    const candidates = [r.data, r.data?.data, r.data?.list, r.data?.items, r.data?.result].filter(Boolean);
    for (const c of candidates) {
      if (Array.isArray(c) && c.length > 5) {
        const sample = c[0];
        if (sample && (sample['집행실행일자'] || sample['집행목적'] || sample['exDt'] || sample['purps'])) {
          execData = c;
          console.log('\n✅ 집행내역 데이터 발견!', c.length, '건');
          console.log('키:', Object.keys(sample).join(', '));
          break;
        }
      }
    }
    if (execData) break;
  }

  if (execData) {
    fs.mkdirSync('projects/캠퍼스타운-고려대', { recursive: true });
    fs.writeFileSync(OUTPUT, JSON.stringify(execData, null, 2), 'utf-8');
    console.log('저장:', OUTPUT);
  } else {
    console.log('\n⚠  집행내역 데이터 미발견. API 응답 전체 구조:');
    apiResponses.slice(0, 3).forEach(r => {
      console.log(JSON.stringify(r.data).substring(0, 300));
    });
  }

  await browser.close();
})().catch(e => { console.error('ERROR:', e.message); process.exit(1); });
