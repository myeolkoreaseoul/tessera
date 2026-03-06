/**
 * 현재 상세화면에서 시작하여 N건 순차 처리
 * ★ 레이블 기반 요소 탐색 (동적 UUID 대응)
 * Usage: node review-10.js [count]
 */
const { chromium } = require('playwright');
const fs = require('fs');
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

const COUNT = parseInt(process.argv[2]) || 10;
const KEEPALIVE_INTERVAL = 60; // 60건마다 세션 연장

function judgeItem(info) {
  const { method, purpose, files } = info;
  const fn = (files || []).join(' ').toLowerCase();

  if (method.includes('전자세금계산서'))
    return { status: '검토완료', opinion: '전자세금계산서가 첨부되어 있어 증빙 적정합니다.', reason: '집행방식=전자세금계산서' };

  if (!files || files.length === 0) {
    if (purpose.includes('급여') || purpose.includes('인건비') || purpose.includes('보험') || purpose.includes('원천'))
      return { status: '검토완료', opinion: '인건비 집행으로 시스템 내장 증빙으로 확인됩니다.', reason: '인건비-시스템증빙' };
    return { status: '보완요청', opinion: '증빙서류가 첨부되어 있지 않습니다. 해당 집행에 대한 증빙을 첨부하여 주시기 바랍니다.', reason: '증빙 미첨부' };
  }

  if (purpose.includes('전기') || purpose.includes('수도') || purpose.includes('가스') || purpose.includes('요금'))
    return { status: '검토완료', opinion: '공과금 증빙(청구서/세금계산서)이 첨부되어 있어 증빙 적정합니다.', reason: '공과금+파일(' + files[0].substring(0, 30) + ')' };

  if (fn.includes('세금계산서'))
    return { status: '검토완료', opinion: '세금계산서가 첨부되어 있어 증빙 적정합니다.', reason: '세금계산서 파일' };

  if (fn.includes('카드') || fn.includes('매출전표') || fn.includes('영수증'))
    return { status: '검토완료', opinion: '카드영수증(매출전표)이 첨부되어 있어 증빙 적정합니다.', reason: '카드영수증 파일' };

  if (fn.includes('계좌이체') || fn.includes('이체확인') || fn.includes('거래내역'))
    return { status: '검토완료', opinion: '계좌이체확인증이 첨부되어 있어 증빙 적정합니다.', reason: '계좌이체 파일' };

  if (files.length > 0)
    return { status: '검토완료', opinion: '관련 증빙서류가 첨부되어 있어 적정합니다.', reason: '기타파일: ' + files.map(f => f.substring(0, 25)).join(', ') };

  return { status: '보완요청', opinion: '증빙서류를 확인할 수 없습니다.', reason: '증빙불명' };
}

(async () => {
  const b = await chromium.connectOverCDP('http://100.87.3.123:9445', { timeout: 10000 });
  const page = b.contexts()[0].pages().find(p => p.url().includes('lss.do'));
  if (!page) { console.error('lss.do 탭 없음'); process.exit(1); }

  async function closePopups() {
    await page.evaluate(() => {
      [...document.querySelectorAll('*')].filter(el => {
        const t = (el.innerText || '').trim();
        return (t === '확인' || t === '닫기') && el.getBoundingClientRect().width > 0 &&
          el.getBoundingClientRect().width < 200 && el.childElementCount === 0;
      }).forEach(el => el.click());
    });
    await sleep(300);
  }

  async function readDetail() {
    return page.evaluate(() => {
      const text = document.body.innerText;
      const get = (label) => {
        const m = text.match(new RegExp(label + '\\n(.+)'));
        return (m && m[1]) ? m[1].trim() : '';
      };
      const exts = ['.pdf', '.jpg', '.jpeg', '.png', '.hwp', '.xlsx', '.xls', '.docx', '.zip'];
      const files = [...document.querySelectorAll('*')]
        .filter(el => {
          if (el.childElementCount > 0) return false;
          const t = (el.innerText || '').trim();
          return t.length > 3 && t.length < 200 && exts.some(ext => t.toLowerCase().endsWith(ext));
        })
        .map(el => (el.innerText || '').trim());
      return {
        purpose: get('집행목적\\(용도\\)'),
        method: get('집행방식') || get('증빙유형'),
        amount: get('집행합계금액'),
        files,
      };
    });
  }

  // ★ 레이블 기반으로 combobox/textarea 찾기
  async function findElements() {
    return page.evaluate(() => {
      // 검토진행상태 레이블 → 가장 가까운 cl-combobox
      const statusLabels = [...document.querySelectorAll('*')].filter(el =>
        el.childElementCount === 0 && (el.innerText || '').trim() === '검토진행상태'
      );
      let comboId = '';
      if (statusLabels.length > 0) {
        let p = statusLabels[0].parentElement;
        for (let i = 0; i < 8 && p; i++) {
          const combo = p.querySelector('[class*="cl-combobox"]');
          if (combo && combo.id) { comboId = combo.id; break; }
          p = p.parentElement;
        }
      }

      // 검증검토의견 레이블 → 가장 가까운 cl-textarea
      const opLabels = [...document.querySelectorAll('*')].filter(el =>
        el.childElementCount === 0 && (el.innerText || '').trim() === '검증검토의견'
      );
      let textareaId = '';
      if (opLabels.length > 0) {
        let p = opLabels[0].parentElement;
        for (let i = 0; i < 15 && p; i++) {
          const ta = p.querySelector('[class*="cl-textarea"]');
          if (ta && ta.id) { textareaId = ta.id; break; }
          p = p.parentElement;
        }
      }

      return { comboId, textareaId };
    });
  }

  async function inputAndSave(status, opinion) {
    const { comboId, textareaId } = await findElements();
    if (!comboId || !textareaId) {
      console.log('  요소 못찾음: combo=' + comboId + ' textarea=' + textareaId);
      return { comboOk: false, typeOk: false };
    }

    // 드롭다운
    const comboOk = await page.evaluate(async (params) => {
      const el = document.getElementById(params.id);
      if (!el) return false;
      const btn = el.querySelector('.cl-combobox-button');
      if (btn) btn.click();
      await new Promise(r => setTimeout(r, 500));
      const target = [...document.querySelectorAll('[role="option"]')]
        .find(o => (o.innerText || '').trim() === params.status);
      if (target) { target.click(); await new Promise(r => setTimeout(r, 300)); return true; }
      return false;
    }, { id: comboId, status });

    // 의견
    const typeOk = await page.evaluate((params) => {
      const c = document.getElementById(params.id);
      if (!c) return false;
      const ta = c.querySelector('textarea');
      if (ta) {
        ta.focus(); ta.value = params.opinion;
        ta.dispatchEvent(new Event('input', { bubbles: true }));
        ta.dispatchEvent(new Event('change', { bubbles: true }));
        return true;
      }
      return false;
    }, { id: textareaId, opinion });

    // 저장
    await page.evaluate(() => {
      const btns = [...document.querySelectorAll('*')].filter(el => {
        const t = (el.innerText || '').trim();
        const r = el.getBoundingClientRect();
        return (t === '저장' || t === '✓ 저장') && r.width > 0 && r.width < 200 && r.y > 300;
      });
      btns.sort((a, b) => a.childElementCount - b.childElementCount);
      if (btns[0]) btns[0].click();
    });
    await sleep(1500);
    await closePopups();
    return { comboOk, typeOk };
  }

  // 현재 상태 확인
  async function getCurrentStatus() {
    const { comboId } = await findElements();
    if (!comboId) return '';
    return page.evaluate((id) => {
      const el = document.getElementById(id);
      if (!el) return '';
      const input = el.querySelector('input');
      return input ? input.value : '';
    }, comboId);
  }

  async function goNext() {
    const ok = await page.evaluate(() => {
      const btns = [...document.querySelectorAll('*')].filter(el => {
        const t = (el.innerText || '').trim();
        return t.includes('다음') && t.includes('집행정보') && el.getBoundingClientRect().width > 0 && el.childElementCount === 0;
      });
      if (btns[0]) { btns[0].click(); return true; }
      return false;
    });
    await sleep(1500);
    await closePopups();
    return ok;
  }

  await closePopups();
  const results = [];

  for (let i = 0; i < COUNT; i++) {
    const info = await readDetail();
    if (!info.purpose) { console.log('[' + (i+1) + '] 상세정보 없음, 중단'); break; }

    const currentStatus = await getCurrentStatus();
    const j = judgeItem(info);
    const entry = {
      num: i + 1, purpose: info.purpose, method: info.method,
      files: info.files, judgment: j.status, opinion: j.opinion, reason: j.reason,
    };

    if (currentStatus === '검토완료' || currentStatus === '보완요청') {
      console.log('[' + (i+1) + '] SKIP(' + currentStatus + '): ' + info.purpose.substring(0, 50));
      entry.skipped = true; entry.existing = currentStatus;
    } else {
      const r = await inputAndSave(j.status, j.opinion);
      const mark = (r.comboOk && r.typeOk) ? 'OK' : 'FAIL';
      console.log('[' + (i+1) + '] ' + mark + ' ' + j.status + ': ' + info.purpose.substring(0, 50) + ' | ' + j.reason);
      entry.saved = r.comboOk && r.typeOk;
    }
    results.push(entry);

    // 세션 연장 (N건마다)
    if (i > 0 && i % KEEPALIVE_INTERVAL === 0) {
      await page.evaluate(() => {
        const timer = [...document.querySelectorAll('*')].find(el => /^\d{2}:\d{2}$/.test((el.innerText||'').trim()));
        if (timer) { const btn = timer.nextElementSibling || timer.parentElement; if (btn) btn.click(); }
      });
      await sleep(500);
      console.log('  [세션 연장]');
    }

    if (i < COUNT - 1) {
      if (!await goNext()) { console.log('다음 없음'); break; }
    }
  }

  fs.writeFileSync('/tmp/botem-review-results.json', JSON.stringify(results, null, 2));
  console.log('\n결과: /tmp/botem-review-results.json');
  await b.close();
})().catch(e => console.error('FATAL:', e.message));
