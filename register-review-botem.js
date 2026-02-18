/**
 * 보탬e 검증검토 의견 자동 등록 (v2 — 페이지 매칭 방식)
 *
 * 각 페이지의 purpose+amount를 읽고 results.json에서 매칭하여 입력
 * 검토완료(적정) 건은 건너뛰고 보완요청(확인) 건만 입력
 *
 * 사용법:
 *   node register-review-botem.js              # 전체 실행
 *   node register-review-botem.js --dry-run    # 저장 없이 테스트
 *   node register-review-botem.js --limit=5    # 5건만 처리
 */
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const DRY_RUN = process.argv.includes('--dry-run');
const LIMIT   = parseInt((process.argv.find(a => a.startsWith('--limit=')) || '--limit=9999').split('=')[1]);

const DIR      = path.join(__dirname, 'projects/캠퍼스타운-고려대');
const RESULTS  = path.join(DIR, 'results.json');
const PROGRESS = path.join(DIR, 'register-progress.json');

function truncate300(text) {
  if (!text) return '';
  if (text.length <= 295) return text;
  return text.substring(0, 290) + '...';
}

function loadProgress() {
  try { return JSON.parse(fs.readFileSync(PROGRESS, 'utf-8')); }
  catch { return { done: [], pagesDone: 0 }; }
}
function saveProgress(prog) {
  fs.writeFileSync(PROGRESS, JSON.stringify(prog));
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// 페이지에서 현재 건 정보 읽기
async function readPageInfo(page) {
  return page.evaluate(() => {
    const text = document.body.innerText;
    const purpose = text.match(/집행목적\(용도\)\n(.+)/)?.[1]?.trim() || '';
    // 집행금액 (집행합계금액 행)
    const amountM = text.match(/집행합계금액\n[\d,]+\n[\d,]+\n([\d,]+)/);
    const amount = amountM ? amountM[1].replace(/,/g, '') : '';
    // 이미 검토완료인지 확인
    const layouts = [...document.querySelectorAll('.cl-layout')].filter(el => {
      const t = (el.innerText || '');
      return t.includes('검토진행상태') && t.includes('검증검토의견');
    });
    let currentStatus = '';
    if (layouts.length > 0) {
      const cv = layouts[layouts.length - 1].querySelector('.cl-combobox:not(.cl-disabled) .cl-combobox-displaytext');
      currentStatus = (cv?.innerText || '').trim();
    }
    return { purpose, amount, currentStatus };
  });
}

// results.json에서 매칭하는 결과 찾기
function findMatch(results, purpose, amount, doneSet) {
  // 1) purpose + amount 정확 매칭 (done 아닌 것)
  const candidates = results.filter(r =>
    r.purpose === purpose && !doneSet.has(r.rowNum)
  );
  if (candidates.length === 1) return candidates[0];

  // 2) 여러 개면 amount로 좁히기
  if (candidates.length > 1 && amount) {
    const withAmount = candidates.filter(r => String(r.amount || '').replace(/,/g, '') === amount);
    if (withAmount.length > 0) return withAmount[0];
  }

  // 3) 그래도 여러 개면 첫 번째 (같은 status/opinion이므로 무방)
  if (candidates.length > 0) return candidates[0];

  // 4) done 포함해서라도 찾기 (이미 처리된 건)
  const allMatch = results.filter(r => r.purpose === purpose);
  if (allMatch.length > 0) return { ...allMatch[0], alreadyDone: true };

  // 5) 부분 매칭 (앞 30자)
  const partial = results.filter(r =>
    r.purpose && purpose && r.purpose.substring(0, 30) === purpose.substring(0, 30) && !doneSet.has(r.rowNum)
  );
  if (partial.length > 0) return partial[0];

  return null;
}

(async () => {
  const results = JSON.parse(fs.readFileSync(RESULTS, 'utf-8'));
  const bowan = results.filter(r => r.status === '확인').length;
  const ok = results.filter(r => r.status === '적정').length;
  console.log(`판정 결과: ${results.length}건 (보완요청 ${bowan}, 검토완료 ${ok} — 검토완료는 건너뜀)`);
  if (DRY_RUN) console.log('DRY-RUN 모드');

  const b = await chromium.connectOverCDP('http://localhost:9445', { timeout: 10000 });
  const page = b.contexts()[0].pages().find(p => p.url().includes('lss.do'));
  if (!page) { console.error('lss.do 탭 없음'); process.exit(1); }

  // 의견등록 탭 활성화
  const currentTab = await page.evaluate(() => {
    const sel = document.querySelector('.cl-tabfolder-item.cl-selected');
    return (sel?.innerText || '').trim();
  });
  if (!currentTab.includes('의견등록')) {
    console.log('의견등록 탭으로 전환...');
    await page.evaluate(() => {
      const tabs = [...document.querySelectorAll('.cl-tabfolder-item')];
      const t = tabs.find(t => (t.innerText || '').includes('의견등록'));
      if (t) t.click();
    });
    await sleep(2000);
  }
  console.log('의견등록 탭 활성화');

  const progress = loadProgress();
  const doneSet = new Set(progress.done || []);
  console.log(`진행: ${doneSet.size}건 완료`);

  let processed = 0; // 보완요청 입력 건
  let skipped = 0;   // 검토완료 건너뜀
  let errors = 0;
  let pageCount = 0; // 총 페이지 이동 수

  for (let step = 0; processed < LIMIT; step++) {
    // 1) 현재 페이지 정보 읽기
    const info = await readPageInfo(page);
    pageCount++;

    if (!info.purpose) {
      console.log(`[page ${pageCount}] purpose 없음 — 종료`);
      break;
    }

    // 2) results.json에서 매칭
    const match = findMatch(results, info.purpose, info.amount, doneSet);

    if (!match) {
      console.log(`[page ${pageCount}] 매칭 실패: "${info.purpose.substring(0, 40)}" — 건너뜀`);
      errors++;
      const moved = await clickNext(page);
      if (!moved) { console.log('다음 건 없음 — 종료'); break; }
      continue;
    }

    if (match.alreadyDone) {
      // 이미 done에 있는 건 — 건너뜀
      const moved = await clickNext(page);
      if (!moved) { console.log('다음 건 없음 — 종료'); break; }
      continue;
    }

    const targetStatus = (match.status === '적정' || match.status === 'SKIP') ? '검토완료' : '보완요청';
    const opinion = truncate300(match.opinion || '');

    // 3) 검토완료 건 건너뜀
    if (targetStatus === '검토완료') {
      if (pageCount % 50 === 0) console.log(`[page ${pageCount}] 검토완료 건너뜀 (누적 skip ${skipped})`);
      doneSet.add(match.rowNum);
      progress.done = [...doneSet];
      if (pageCount % 20 === 0) saveProgress(progress); // 20건마다 저장
      skipped++;
      const moved = await clickNext(page);
      if (!moved) { console.log('다음 건 없음 — 종료'); break; }
      continue;
    }

    // 4) 보완요청 입력
    console.log(`\n[page ${pageCount}] #${match.rowNum} ${info.purpose.substring(0, 50)}`);
    console.log(`  → 보완요청, 의견: ${opinion.substring(0, 60)}...`);

    // 이미 보완요청이 입력되어 있으면 건너뜀
    if (info.currentStatus === '보완요청') {
      console.log('  이미 보완요청 입력됨 — 건너뜀');
      doneSet.add(match.rowNum);
      progress.done = [...doneSet];
      saveProgress(progress);
      processed++;
      const moved = await clickNext(page);
      if (!moved) { console.log('다음 건 없음 — 종료'); break; }
      continue;
    }

    if (!DRY_RUN) {
      try {
        // 콤보박스 스크롤 + 클릭
        await page.evaluate(() => {
          const layouts = [...document.querySelectorAll('.cl-layout')].filter(el => {
            const t = (el.innerText || '');
            return t.includes('검토진행상태') && t.includes('검증검토의견');
          });
          if (layouts.length > 0) {
            const combo = layouts[layouts.length - 1].querySelector('.cl-combobox:not(.cl-disabled)');
            if (combo) combo.scrollIntoView({ block: 'center' });
          }
        });
        await sleep(300);

        await page.evaluate(() => {
          const layouts = [...document.querySelectorAll('.cl-layout')].filter(el => {
            const t = (el.innerText || '');
            return t.includes('검토진행상태') && t.includes('검증검토의견');
          });
          for (const layout of layouts.reverse()) {
            const comboBtn = layout.querySelector('.cl-combobox:not(.cl-disabled) .cl-combobox-button');
            if (comboBtn) { comboBtn.click(); return; }
          }
        });
        await sleep(700);

        // 드롭다운 "보완요청" 선택
        let optionSelected = false;
        for (let retry = 0; retry < 3 && !optionSelected; retry++) {
          optionSelected = await page.evaluate((target) => {
            const popups = [...document.querySelectorAll('.cl-combobox-list.cl-popup')].filter(
              el => el.getBoundingClientRect().height > 0
            );
            for (const popup of popups) {
              const items = [...popup.querySelectorAll('*')].filter(el =>
                (el.innerText || '').trim() === target && el.childElementCount === 0 && el.getBoundingClientRect().height > 0
              );
              if (items.length > 0) { items[0].click(); return true; }
            }
            return false;
          }, '보완요청');
          if (!optionSelected) await sleep(500);
        }

        if (!optionSelected) {
          console.log('  옵션 선택 실패 — 건너뜀');
          await page.keyboard.press('Escape');
          errors++;
          const moved = await clickNext(page);
          if (!moved) break;
          continue;
        }
        console.log('  상태 선택 OK');
        await sleep(300);

        // textarea 입력
        if (opinion) {
          document.querySelectorAll?.('[data-rpa-ta]')?.forEach?.(el => el.removeAttribute('data-rpa-ta'));
          const taReady = await page.evaluate(() => {
            document.querySelectorAll('[data-rpa-ta]').forEach(el => el.removeAttribute('data-rpa-ta'));
            const textareas = [...document.querySelectorAll('textarea.cl-text')];
            const activeTA = textareas.find(ta => !ta.closest('.cl-disabled') && ta.getBoundingClientRect().height > 0);
            if (activeTA) {
              activeTA.setAttribute('data-rpa-ta', 'opinion');
              activeTA.scrollIntoView({ block: 'center' });
              return true;
            }
            return false;
          });

          if (!taReady) {
            await sleep(800);
            await page.evaluate(() => {
              const textareas = [...document.querySelectorAll('textarea.cl-text')];
              const activeTA = textareas.find(ta => !ta.closest('.cl-disabled'));
              if (activeTA) {
                activeTA.setAttribute('data-rpa-ta', 'opinion');
                activeTA.scrollIntoView({ block: 'center' });
              }
            });
            await sleep(300);
          }

          const ta = await page.$('[data-rpa-ta="opinion"]');
          if (ta) {
            await ta.evaluate(el => { el.focus(); el.click(); });
            await sleep(100);
            await page.keyboard.press('Control+a');
            await sleep(50);
            await page.keyboard.press('Delete');
            await sleep(50);
            await ta.type(opinion, { delay: 5 });
            await sleep(200);
            await page.keyboard.press('Tab');
            await sleep(300);
            console.log(`  의견 입력 OK (${opinion.length}자)`);
          } else {
            console.log('  textarea 없음');
          }
        }

        // 저장
        const saved = await page.evaluate(() => {
          const saveBtns = [...document.querySelectorAll('div,button')].filter(el => {
            const t = (el.innerText || '').trim();
            const r = el.getBoundingClientRect();
            return t === '저장' && r.width > 0 && el.childElementCount === 0;
          });
          if (saveBtns.length > 0) { saveBtns[0].click(); return true; }
          return false;
        });
        if (saved) {
          console.log('  저장 OK');
          await sleep(2000);
        } else {
          console.log('  저장 버튼 없음');
          errors++;
        }

        // 팝업 확인
        const dialogText = await page.evaluate(() => {
          const dialogs = [...document.querySelectorAll('.cl-dialog')].filter(el => el.getBoundingClientRect().width > 0);
          if (dialogs.length > 0) {
            const text = (dialogs[0].innerText || '').trim();
            const confirmBtns = [...dialogs[0].querySelectorAll('*')].filter(el =>
              ['확인', '예', 'OK'].includes((el.innerText || '').trim()) &&
              el.childElementCount === 0 && el.getBoundingClientRect().width > 0
            );
            if (confirmBtns.length > 0) confirmBtns[0].click();
            return text;
          }
          return '';
        });
        await sleep(500);

        if (dialogText.includes('필수 입력') || dialogText.includes('오류') || dialogText.includes('실패')) {
          console.log(`  저장 실패: "${dialogText.substring(0, 60)}"`);
          errors++;
          const moved = await clickNext(page);
          if (!moved) break;
          continue;
        }

        doneSet.add(match.rowNum);
        progress.done = [...doneSet];
        saveProgress(progress);
        processed++;

      } catch (e) {
        console.error(`  에러: ${e.message}`);
        errors++;
      }
    } else {
      console.log(`  [DRY-RUN] 보완요청 "${opinion.substring(0, 40)}..."`);
      processed++;
    }

    // 다음 건으로 이동
    const moved = await clickNext(page);
    if (!moved) { console.log('다음 건 없음 — 종료'); break; }

    // 진행 현황 (50건마다)
    if (pageCount % 50 === 0) {
      console.log(`\n--- 진행: page ${pageCount}, 입력 ${processed}, skip ${skipped}, err ${errors} ---\n`);
    }
  }

  // 최종 저장
  progress.done = [...doneSet];
  progress.pagesDone = pageCount;
  saveProgress(progress);

  console.log(`\n완료: 페이지 ${pageCount}, 보완요청 입력 ${processed}건, 검토완료 건너뜀 ${skipped}건, 오류 ${errors}건`);
  await b.close();
})().catch(e => console.error('ERROR:', e.message));

// "다음 집행정보 보기" 클릭 (재시도 포함)
async function clickNext(page) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const moved = await page.evaluate(() => {
      const btns = [...document.querySelectorAll('*')].filter(el => {
        const t = (el.innerText || '').trim();
        const r = el.getBoundingClientRect();
        return t === '다음 집행정보 보기' && r.width > 0 && el.childElementCount === 0;
      });
      if (btns.length > 0) { btns[0].click(); return true; }

      const btns2 = [...document.querySelectorAll('*')].filter(el => {
        const t = (el.innerText || '').trim();
        const r = el.getBoundingClientRect();
        return t.includes('다음 집행정보') && r.width > 0 && r.width < 300;
      });
      if (btns2.length > 0) { btns2[btns2.length - 1].click(); return true; }
      return false;
    });
    if (moved) {
      await new Promise(r => setTimeout(r, 2000));
      return true;
    }
    await new Promise(r => setTimeout(r, 1500));
  }
  return false;
}
