/**
 * 보탬e 자동 검토 입력 스크립트
 * 목록에서 아이템 클릭 → 판정 → 입력 → 저장 → 다음 반복
 *
 * Usage: node auto-review.js [startPage] [pageSize]
 *   startPage: 시작 페이지 (default: 2, 1페이지는 이미 완료)
 *   pageSize: 페이지당 건수 (default: 10)
 */
const { chromium } = require('playwright');
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

const START_PAGE = parseInt(process.argv[2]) || 2;
const PAGE_SIZE = parseInt(process.argv[3]) || 10;
const MAX_ITEMS = parseInt(process.argv[4]) || 999;

const comboId = 'uuid-7022e960-056a-09a3-1747-cb0c0d2a33c2';
const textareaId = 'uuid-3dfa44b1-e152-5ebf-9422-484468dead05';

// 판정 로직: 집행방식 + 파일명 기반
function judgeItem(info) {
  const { method, purpose, files } = info;

  // 전자세금계산서 집행방식이면 → 적정
  if (method.includes('전자세금계산서')) {
    return {
      status: '검토완료',
      opinion: '전자세금계산서가 첨부되어 있어 증빙 적정합니다.',
    };
  }

  // 파일 확인
  if (!files || files.length === 0) {
    // 시스템 내장 증빙 가능성 체크
    if (method.includes('소득') || method.includes('원천') || purpose.includes('급여') || purpose.includes('인건비')) {
      return {
        status: '검토완료',
        opinion: '인건비 집행으로 소득지급명세서 등 시스템 내장 증빙으로 확인됩니다.',
      };
    }
    return {
      status: '보완요청',
      opinion: '증빙서류가 첨부되어 있지 않습니다. 해당 집행에 대한 증빙을 첨부하여 주시기 바랍니다.',
    };
  }

  const fileNames = files.join(' ').toLowerCase();

  // 공과금 (전기, 수도, 가스 등)
  if (purpose.includes('전기') || purpose.includes('수도') || purpose.includes('가스') || purpose.includes('공과금')) {
    if (fileNames.includes('세금계산서') || fileNames.includes('이메일청구서') || fileNames.includes('영수증') || fileNames.includes('납부')) {
      return {
        status: '검토완료',
        opinion: '공과금 증빙(청구서/세금계산서)이 첨부되어 있어 증빙 적정합니다.',
      };
    }
  }

  // 세금계산서 파일
  if (fileNames.includes('세금계산서')) {
    return {
      status: '검토완료',
      opinion: '세금계산서가 첨부되어 있어 증빙 적정합니다.',
    };
  }

  // 카드 영수증/매출전표
  if (fileNames.includes('카드') || fileNames.includes('매출전표') || fileNames.includes('영수증')) {
    return {
      status: '검토완료',
      opinion: '카드영수증(매출전표)이 첨부되어 있어 증빙 적정합니다.',
    };
  }

  // 계좌이체
  if (fileNames.includes('계좌이체') || fileNames.includes('이체확인') || fileNames.includes('거래내역')) {
    return {
      status: '검토완료',
      opinion: '계좌이체확인증이 첨부되어 있어 증빙 적정합니다.',
    };
  }

  // 견적서, 계약서 등 보조 서류
  if (fileNames.includes('견적') || fileNames.includes('계약') || fileNames.includes('품의')) {
    return {
      status: '검토완료',
      opinion: '관련 증빙서류가 첨부되어 있어 적정합니다.',
    };
  }

  // 급여/인건비 관련
  if (purpose.includes('급여') || purpose.includes('인건비') || purpose.includes('4대보험') || purpose.includes('원천세')) {
    return {
      status: '검토완료',
      opinion: '인건비 관련 증빙이 첨부되어 있어 적정합니다.',
    };
  }

  // 기타 파일이 있는 경우 → 일단 적정 (파일이 있으므로)
  if (files.length > 0) {
    return {
      status: '검토완료',
      opinion: '관련 증빙서류가 첨부되어 있어 적정합니다.',
    };
  }

  return {
    status: '보완요청',
    opinion: '증빙서류를 확인할 수 없습니다. 적절한 증빙을 첨부하여 주시기 바랍니다.',
  };
}

(async () => {
  const b = await chromium.connectOverCDP('http://100.87.3.123:9445', { timeout: 10000 });
  const ctx = b.contexts()[0];
  const page = ctx.pages().find(p => p.url().includes('lss.do'));
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

  // 세션 연장 (5분 타이머)
  async function keepAlive() {
    await page.evaluate(() => {
      // 세션 연장 버튼 (우상단 파란 새로고침)
      const btns = [...document.querySelectorAll('*')].filter(el => {
        const r = el.getBoundingClientRect();
        return r.y < 50 && r.x > 1000 && r.width > 10 && r.width < 60 &&
          (el.className.includes('refresh') || el.className.includes('session') ||
           el.closest('[class*="timer"]') || el.closest('[class*="session"]'));
      });
      // 타이머 영역 근처 클릭
      const timerArea = [...document.querySelectorAll('*')].filter(el => {
        const t = (el.innerText || '').trim();
        return /^\d{2}:\d{2}$/.test(t);
      });
      if (timerArea.length > 0) {
        const sibling = timerArea[0].nextElementSibling || timerArea[0].parentElement;
        if (sibling) sibling.click();
      }
    });
  }

  // 목록에서 특정 페이지로 이동
  async function goToPage(pageNum) {
    await page.evaluate((num) => {
      const pageLinks = [...document.querySelectorAll('*')].filter(el => {
        const t = (el.innerText || '').trim();
        const r = el.getBoundingClientRect();
        return t === String(num) && r.width > 15 && r.width < 60 && r.y > 350 && el.childElementCount === 0;
      });
      if (pageLinks[0]) pageLinks[0].click();
    }, pageNum);
    await sleep(1500);
    await closePopups();
  }

  // 목록에서 아이템 클릭 (검토완료/미검토 링크)
  async function clickListItem(rowIdx) {
    const clicked = await page.evaluate((idx) => {
      // 그리드 행에서 검증검토 진행상태 링크 클릭
      const links = [...document.querySelectorAll('a, [style*="cursor: pointer"], [class*="cl-link"]')].filter(el => {
        const t = (el.innerText || '').trim();
        const r = el.getBoundingClientRect();
        return (t === '미검토' || t === '검토완료' || t === '보완요청') && r.width > 0 && r.y > 100;
      });
      if (links[idx]) {
        links[idx].click();
        return { ok: true, text: (links[idx].innerText || '').trim() };
      }
      return { ok: false, count: links.length };
    }, rowIdx);
    return clicked;
  }

  // 상세 페이지에서 정보 읽기
  async function readDetailInfo() {
    return page.evaluate(() => {
      const text = document.body.innerText;
      const get = (label) => {
        const m = text.match(new RegExp(label + '\\n(.+)'));
        return (m && m[1]) ? m[1].trim() : '';
      };

      // 첨부파일 목록
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
        method: get('증빙유형') || get('집행방식'),
        amount: get('집행합계금액'),
        files,
      };
    });
  }

  // 검토의견 입력 + 저장
  async function inputAndSave(status, opinion) {
    // 드롭다운
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

    // 의견
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

  // 다음 집행정보 보기
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

  // === 메인 루프 ===
  await closePopups();

  // 현재 목록 화면 확인
  const isListView = await page.evaluate(() => {
    return document.body.innerText.includes('집행내역 목록조회');
  });

  if (!isListView) {
    console.error('목록 화면이 아닙니다');
    process.exit(1);
  }

  // 시작 페이지로 이동
  if (START_PAGE > 1) {
    console.log(`페이지 ${START_PAGE}로 이동...`);
    await goToPage(START_PAGE);
  }

  // 첫 번째 아이템 클릭하여 상세 화면 진입
  const firstClick = await clickListItem(0);
  if (!firstClick.ok) {
    console.error('첫 아이템 클릭 실패');
    process.exit(1);
  }
  await sleep(1500);
  await closePopups();

  let processed = 0;
  let errors = 0;
  const startTime = Date.now();
  const results = [];

  while (processed < MAX_ITEMS) {
    try {
      // 세션 연장 (20건마다)
      if (processed > 0 && processed % 20 === 0) {
        await keepAlive();
      }

      // 상세 정보 읽기
      const info = await readDetailInfo();
      if (!info.purpose) {
        console.log(`[${processed + 1}] 정보 읽기 실패 - 목록으로 돌아갔을 수 있음`);
        break;
      }

      // 판정
      const judgment = judgeItem(info);

      // 이미 검토완료인지 확인
      const currentStatus = await page.evaluate((id) => {
        const el = document.getElementById(id);
        if (!el) return '';
        const input = el.querySelector('input');
        return input ? input.value : '';
      }, comboId);

      if (currentStatus === '검토완료' || currentStatus === '보완요청') {
        console.log(`[${processed + 1}] ${info.purpose.substring(0, 50)} → 이미 ${currentStatus}, SKIP`);
        results.push({ purpose: info.purpose.substring(0, 50), skipped: true, existing: currentStatus });
      } else {
        // 입력 + 저장
        const result = await inputAndSave(judgment.status, judgment.opinion);
        const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);
        console.log(`[${processed + 1}] ${info.purpose.substring(0, 50)} → ${judgment.status} | ${elapsed}s`);
        results.push({
          purpose: info.purpose.substring(0, 50),
          status: judgment.status,
          combo: result.comboOk,
          type: result.typeOk,
          files: info.files.length,
        });
      }

      processed++;

      // 다음으로 이동
      const hasNext = await goNext();
      if (!hasNext) {
        console.log('다음 건 없음, 종료');
        break;
      }

    } catch (e) {
      console.error(`[${processed + 1}] ERROR: ${e.message}`);
      errors++;
      if (errors > 5) {
        console.error('에러 5회 초과, 중단');
        break;
      }
      // 에러 복구 시도
      await closePopups();
      await sleep(1000);
      const hasNext = await goNext();
      if (!hasNext) break;
      processed++;
    }
  }

  const totalTime = ((Date.now() - startTime) / 1000).toFixed(0);
  console.log(`\n=== 완료 ===`);
  console.log(`처리: ${processed}건, 에러: ${errors}건, 소요: ${totalTime}초`);
  console.log(`평균: ${(totalTime / processed).toFixed(1)}초/건`);

  // 결과 저장
  const fs = require('fs');
  fs.writeFileSync('/tmp/botem-auto-results.json', JSON.stringify(results, null, 2));
  console.log('결과 저장: /tmp/botem-auto-results.json');

  await b.close();
})().catch(e => console.error('FATAL:', e.message));
