// 현재 위치에서 이전으로 이동하며 하나씩 검토완료 입력
const { chromium } = require('playwright');
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

const comboId = 'uuid-7022e960-056a-09a3-1747-cb0c0d2a33c2';
const textareaId = 'uuid-3dfa44b1-e152-5ebf-9422-484468dead05';

const OPINION_ELEC = '전기요금 이메일청구서에 전자세금계산서 정보(사업자등록번호, 공급가액, 부가가치세)가 포함되어 있어 증빙 적정합니다.';
const OPINION_GAS = '도시가스요금 이메일청구서에 전자세금계산서 정보(사업자등록번호, 공급가액, 부가가치세)가 포함되어 있어 증빙 적정합니다.';
const OPINION_BEAM = '수정 전자세금계산서가 첨부되어 있으며, 공급가액 및 부가가치세가 명시되어 증빙 적정합니다.';

const COUNT = parseInt(process.argv[2]) || 7; // 8~2번 = 7건

(async () => {
  const b = await chromium.connectOverCDP('http://100.87.3.123:9445', { timeout: 10000 });
  const page = b.contexts()[0].pages().find(p => p.url().includes('lss.do'));
  if (!page) { console.error('lss.do 탭 없음'); process.exit(1); }

  async function closePopups() {
    await page.evaluate(() => {
      [...document.querySelectorAll('*')].filter(el => {
        const t = (el.innerText || '').trim();
        return (t === '확인' || t === '닫기') && el.getBoundingClientRect().width > 0 && el.getBoundingClientRect().width < 200 && el.childElementCount === 0;
      }).forEach(el => el.click());
    });
    await sleep(300);
  }

  async function getCurrentPurpose() {
    return page.evaluate(() => {
      const m = document.body.innerText.match(/집행목적\(용도\)\n(.+)/);
      return (m && m[1]) ? m[1].trim() : '';
    });
  }

  async function goPrev() {
    await page.evaluate(() => {
      const btns = [...document.querySelectorAll('*')].filter(el => {
        const t = (el.innerText || '').trim();
        return t.includes('이전') && t.includes('집행정보') && el.getBoundingClientRect().width > 0 && el.childElementCount === 0;
      });
      if (btns[0]) btns[0].click();
    });
    await sleep(2000);
    await closePopups();
  }

  async function inputAndSave(opinion) {
    // 드롭다운: 검토완료
    const comboOk = await page.evaluate(async (id) => {
      const el = document.getElementById(id);
      if (!el) return false;
      const btn = el.querySelector('.cl-combobox-button');
      if (btn) btn.click();
      await new Promise(r => setTimeout(r, 500));
      const target = [...document.querySelectorAll('[role="option"]')].find(o => (o.innerText||'').trim() === '검토완료');
      if (target) { target.click(); await new Promise(r => setTimeout(r, 300)); return true; }
      return false;
    }, comboId);

    // 의견 입력
    const typeOk = await page.evaluate(({ id, text }) => {
      const c = document.getElementById(id);
      if (!c) return false;
      const ta = c.querySelector('textarea');
      if (ta) { ta.focus(); ta.value = text; ta.dispatchEvent(new Event('input',{bubbles:true})); ta.dispatchEvent(new Event('change',{bubbles:true})); return true; }
      return false;
    }, { id: textareaId, text: opinion });

    // 저장
    await page.evaluate(() => {
      const btns = [...document.querySelectorAll('*')].filter(el => {
        const t = (el.innerText || '').trim(); const r = el.getBoundingClientRect();
        return (t === '저장' || t === '✓ 저장') && r.width > 0 && r.width < 200 && r.y > 300;
      });
      btns.sort((a,b) => a.childElementCount - b.childElementCount);
      if (btns[0]) btns[0].click();
    });
    await sleep(2000);
    await closePopups();

    return { comboOk, typeOk };
  }

  await closePopups();
  const results = [];

  for (let i = 0; i < COUNT; i++) {
    // 이전으로 이동
    await goPrev();
    const purpose = await getCurrentPurpose();
    console.log(`\n[${i+1}/${COUNT}] ${purpose}`);

    // 의견 결정
    let opinion;
    if (purpose.includes('빔프로젝터') || purpose.includes('수리')) {
      opinion = OPINION_BEAM;
    } else if (purpose.includes('도시가스')) {
      opinion = OPINION_GAS;
    } else {
      opinion = OPINION_ELEC;
    }

    // 이미 검토완료인지 확인
    const currentStatus = await page.evaluate((id) => {
      const el = document.getElementById(id);
      if (!el) return '';
      const input = el.querySelector('input');
      return input ? input.value : '';
    }, comboId);

    if (currentStatus === '검토완료') {
      console.log('  → 이미 검토완료, SKIP');
      results.push({ purpose: purpose.substring(0, 40), status: 'already done' });
      continue;
    }

    const result = await inputAndSave(opinion);
    console.log(`  → 드롭다운: ${result.comboOk}, 의견: ${result.typeOk}`);
    results.push({ purpose: purpose.substring(0, 40), ...result });
  }

  console.log('\n=== 결과 요약 ===');
  results.forEach((r, i) => console.log(`${i+1}. ${r.purpose} | combo:${r.comboOk} type:${r.typeOk}`));

  await page.screenshot({ path: '/tmp/botem-batch-done.png' });
  console.log('\n최종 스크린샷: /tmp/botem-batch-done.png');
  await b.close();
})().catch(e => console.error('ERROR:', e.message));
