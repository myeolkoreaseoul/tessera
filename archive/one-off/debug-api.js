/**
 * 보탬e API 인터셉트 + 데이터 저장
 *
 * 전략: 페이지를 새로고침해서 집행내역 로드 API를 캡처
 * 보조사업코드 20253070000000296751 기준
 */
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const OUTPUT = path.join(__dirname, 'projects/캠퍼스타운-고려대/data.json');

(async () => {
  const browser = await chromium.connectOverCDP('http://localhost:9445');
  const context = browser.contexts()[0];
  const page = context.pages().find(p => p.url().includes('lss.do'));

  console.log('현재 URL:', page.url());
  console.log('현재 페이지 상태 확인...');

  const state = await page.evaluate(() => {
    const body = document.body.innerText;
    return {
      hasExecList: body.includes('집행내역 목록'),
      total: (body.match(/총\s*(\d+)\s*건/) || [])[1] || '?',
    };
  });
  console.log('집행내역 페이지:', state.hasExecList, '/ 총:', state.total, '건');

  // JSON 응답 캡처
  const captured = [];
  page.on('response', async r => {
    const url = r.url();
    const ct = r.headers()['content-type'] || '';
    if (!ct.includes('json') && !ct.includes('javascript')) return;
    try {
      const text = await r.text();
      if (text.length < 50) return;
      captured.push({ url, text });
      console.log('[응답]', url.split('/').slice(-2).join('/'), text.length + 'B');
    } catch (_) {}
  });

  // 방법 1: 페이지 크기를 변경해서 리로드 트리거
  console.log('\n[트리거] 페이지 크기 변경 시도...');
  const triggered = await page.evaluate(() => {
    // cl-* 드롭다운에서 페이지 크기 변경 시도
    const allDivs = [...document.querySelectorAll('div')].filter(d => {
      if (d.childElementCount > 0) return false;
      const t = d.innerText && d.innerText.trim();
      const r = d.getBoundingClientRect();
      return (t === '10' || t === '20' || t === '50') && r.y > 400 && r.width > 0;
    });
    console.log('페이지크기 div:', allDivs.length, allDivs.map(d => d.innerText.trim() + '@' + Math.round(d.getBoundingClientRect().y)));
    if (allDivs.length > 0) {
      allDivs[0].click();
      return '드롭다운 클릭: ' + allDivs[0].innerText.trim();
    }
    return false;
  });
  console.log('트리거 결과:', triggered);

  await new Promise(r => setTimeout(r, 3000));

  if (captured.length > 0) {
    console.log('\n캡처된 응답:', captured.length, '개');
    captured.forEach(c => console.log(' ', c.url, c.text.substring(0, 200)));
  } else {
    // 방법 2: 조회 버튼 클릭
    console.log('\n[트리거2] 조회 버튼 클릭...');
    await page.evaluate(() => {
      const btns = [...document.querySelectorAll('div,a')].filter(el => {
        const t = el.innerText && el.innerText.trim();
        const r = el.getBoundingClientRect();
        return t === '조회' && r.width > 30 && r.y > 80 && r.y < 350;
      });
      if (btns.length) btns[0].click();
    });
    await new Promise(r => setTimeout(r, 5000));
    console.log('캡처:', captured.length, '개');
    captured.slice(0, 5).forEach(c => {
      console.log('\nURL:', c.url);
      console.log('Body:', c.text.substring(0, 300));
    });
  }

  // 의미있는 데이터 저장
  const jsonResponses = captured.filter(c => {
    try {
      const d = JSON.parse(c.text);
      return Array.isArray(d) ? d.length > 0 : (d.data || d.list || d.rows || d.items);
    } catch { return false; }
  });
  console.log('\n유효 JSON 응답:', jsonResponses.length, '개');
  if (jsonResponses.length > 0) {
    jsonResponses.forEach(c => {
      try {
        const d = JSON.parse(c.text);
        const list = Array.isArray(d) ? d : (d.data || d.list || d.rows || d.items || []);
        console.log(' -', c.url, ':', list.length, '건');
        if (list.length > 0) console.log('   샘플:', JSON.stringify(list[0]).substring(0, 200));
      } catch {}
    });
  }

  await browser.close();
})().catch(e => console.error('ERROR:', e.message));
