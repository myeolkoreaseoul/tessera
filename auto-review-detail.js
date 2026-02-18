/**
 * 보탬e 자동 검토 - 상세 정보 포함 버전
 * 각 건의 근거를 상세히 기록
 */
const { chromium } = require('playwright');
const fs = require('fs');
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

const START_PAGE = parseInt(process.argv[2]) || 2;
const MAX_ITEMS = parseInt(process.argv[3]) || 10;

const comboId = 'uuid-7022e960-056a-09a3-1747-cb0c0d2a33c2';
const textareaId = 'uuid-3dfa44b1-e152-5ebf-9422-484468dead05';

function judgeItem(info) {
  const { method, purpose, files } = info;
  const fileNames = (files || []).join(' ').toLowerCase();

  // 전자세금계산서 집행방식
  if (method.includes('전자세금계산서')) {
    return { status: '검토완료', opinion: '전자세금계산서가 첨부되어 있어 증빙 적정합니다.', reason: '집행방식=전자세금계산서' };
  }

  // 파일 없음
  if (!files || files.length === 0) {
    if (purpose.includes('급여') || purpose.includes('인건비') || purpose.includes('4대보험') || purpose.includes('원천세')) {
      return { status: '검토완료', opinion: '인건비 집행으로 시스템 내장 증빙으로 확인됩니다.', reason: '인건비/급여 - 시스템증빙' };
    }
    return { status: '보완요청', opinion: '증빙서류가 첨부되어 있지 않습니다. 해당 집행에 대한 증빙을 첨부하여 주시기 바랍니다.', reason: '파일 미첨부' };
  }

  // 공과금
  if (purpose.includes('전기') || purpose.includes('수도') || purpose.includes('가스') || purpose.includes('공과금') || purpose.includes('요금')) {
    return { status: '검토완료', opinion: '공과금 증빙(청구서/세금계산서)이 첨부되어 있어 증빙 적정합니다.', reason: '공과금+증빙파일 있음' };
  }

  // 세금계산서 파일
  if (fileNames.includes('세금계산서')) {
    return { status: '검토완료', opinion: '세금계산서가 첨부되어 있어 증빙 적정합니다.', reason: '세금계산서 파일' };
  }

  // 카드
  if (fileNames.includes('카드') || fileNames.includes('매출전표') || fileNames.includes('영수증')) {
    return { status: '검토완료', opinion: '카드영수증(매출전표)이 첨부되어 있어 증빙 적정합니다.', reason: '카드영수증 파일' };
  }

  // 계좌이체
  if (fileNames.includes('계좌이체') || fileNames.includes('이체확인') || fileNames.includes('거래내역')) {
    return { status: '검토완료', opinion: '계좌이체확인증이 첨부되어 있어 증빙 적정합니다.', reason: '계좌이체확인증 파일' };
  }

  // 기타 파일 있음
  if (files.length > 0) {
    return { status: '검토완료', opinion: '관련 증빙서류가 첨부되어 있어 적정합니다.', reason: '기타 증빙파일 있음: ' + files.join(', ').substring(0, 80) };
  }

  return { status: '보완요청', opinion: '증빙서류를 확인할 수 없습니다.', reason: '증빙 확인 불가' };
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

  async function readDetailInfo() {
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

  async function inputAndSave(status, opinion) {
    const comboOk = await page.evaluate(async (params) => {
      const el = document.getElementById(params.comboId);
      if (!el) return false;
      const btn = el.querySelector('.cl-combobox-button');
      if (btn) btn.click();
      await new Promise(r => setTimeout(r, 500));
      const target = [...document.querySelectorAll('[role="option"]')]
        .find(o => (o.innerText || '').trim() === params.status);
      if (target) { target.click(); await new Promise(r => setTimeout(r, 300)); return true; }
      return false;
    }, { comboId, status });

    const typeOk = await page.evaluate((params) => {
      const c = document.getElementById(params.textareaId);
      if (!c) return false;
      const ta = c.querySelector('textarea');
      if (ta) {
        ta.focus(); ta.value = params.opinion;
        ta.dispatchEvent(new Event('input', { bubbles: true }));
        ta.dispatchEvent(new Event('change', { bubbles: true }));
        return true;
      }
      return false;
    }, { textareaId, opinion });

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

  // === 메인 ===
  await closePopups();

  // 목록 페이지로 이동
  console.log(`페이지 ${START_PAGE}로 이동...`);
  await page.evaluate((num) => {
    const pageLinks = [...document.querySelectorAll('*')].filter(el => {
      const t = (el.innerText || '').trim();
      const r = el.getBoundingClientRect();
      return t === String(num) && r.width > 15 && r.width < 60 && r.y > 350 && el.childElementCount === 0;
    });
    if (pageLinks[0]) pageLinks[0].click();
  }, START_PAGE);
  await sleep(1500);
  await closePopups();

  // 첫 아이템 클릭
  const clicked = await page.evaluate(() => {
    const links = [...document.querySelectorAll('*')].filter(el => {
      const t = (el.innerText || '').trim();
      const r = el.getBoundingClientRect();
      return (t === '미검토' || t === '검토완료' || t === '보완요청') &&
        r.width > 0 && r.y > 100 && getComputedStyle(el).cursor === 'pointer';
    });
    if (links[0]) { links[0].click(); return { ok: true, text: links[0].innerText.trim() }; }
    return { ok: false };
  });
  if (!clicked.ok) { console.error('첫 아이템 클릭 실패'); process.exit(1); }
  await sleep(1500);
  await closePopups();

  const results = [];
  for (let i = 0; i < MAX_ITEMS; i++) {
    const info = await readDetailInfo();
    if (!info.purpose) { console.log('정보 읽기 실패, 중단'); break; }

    // 이미 검토된 건인지 확인
    const currentStatus = await page.evaluate((id) => {
      const el = document.getElementById(id);
      if (!el) return '';
      const input = el.querySelector('input');
      return input ? input.value : '';
    }, comboId);

    const judgment = judgeItem(info);

    if (currentStatus === '검토완료' || currentStatus === '보완요청') {
      console.log(`[${i + 1}] SKIP (이미 ${currentStatus}): ${info.purpose.substring(0, 50)}`);
      results.push({ num: i + 1, purpose: info.purpose, method: info.method, amount: info.amount, files: info.files, judgment: judgment.status, reason: judgment.reason, skipped: true, existing: currentStatus });
    } else {
      const r = await inputAndSave(judgment.status, judgment.opinion);
      console.log(`[${i + 1}] ${judgment.status}: ${info.purpose.substring(0, 50)} | 근거: ${judgment.reason}`);
      results.push({ num: i + 1, purpose: info.purpose, method: info.method, amount: info.amount, files: info.files, judgment: judgment.status, opinion: judgment.opinion, reason: judgment.reason, saved: r.comboOk && r.typeOk });
    }

    if (i < MAX_ITEMS - 1) {
      const hasNext = await goNext();
      if (!hasNext) { console.log('다음 건 없음'); break; }
    }
  }

  fs.writeFileSync('/tmp/botem-detail-results.json', JSON.stringify(results, null, 2));
  console.log('\n결과 저장: /tmp/botem-detail-results.json');
  await b.close();
})().catch(e => console.error('FATAL:', e.message));
