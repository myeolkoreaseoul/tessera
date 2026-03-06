/**
 * e나라도움 정산검토 원커맨드 파이프라인 (v2 — 건별 순차 처리)
 *
 * 사용법:
 *   node run-all.js --inst=경북대학교병원 --kw=칠곡경북대학교병원 [--dir=chilgok] [--year=2025] [--dry-run] [--skip-judge] [--start=N]
 *
 * 옵션:
 *   --inst       하위보조사업자명 (e나라도움 검색용)
 *   --kw         사업명 키워드 (여러 결과 중 매칭)
 *   --dir        다운로드/출력 디렉토리명 (기본: kw에서 자동 생성)
 *   --year       사업연도 (기본: 2025)
 *   --dry-run    review 입력 안 함 (수집+분석까지만)
 *   --skip-judge judge 단계 건너뛰기
 *   --start=N    N번째 건부터 시작 (다음 버튼으로 N-1번 스킵)
 *   --settlement interim|final (기본: final)
 *   --staff=a,b  참여인력 이름 (자문료 중복 체크용)
 *   --project    사업 config 이름 (configs/index.js)
 *
 * 전체 흐름:
 *   Phase 0: 네비게이션 → DD001002Q
 *   Phase 1: 1행 선택 → 세부내역검토(DD001003S) 진입
 *   Phase 2: 건별 루프 (데이터읽기 → 다운로드 → OCR → 분석 → 판정 → 입력 → 다음)
 */
process.on('unhandledRejection', (err) => {
  if (err && err.message && err.message.includes('No dialog is showing')) return;
  console.error('UnhandledRejection:', err);
});

const fs = require('fs');
const path = require('path');
const os = require('os');
const AdmZip = require('adm-zip');
const { extractPdfText, extractHwpText, extractImageText, extractExcelText } = require('./lib/adapters/enaradomum/collect');
const nav = require('./lib/adapters/enaradomum/navigate');
const judge = require('./lib/judge-ai');
const { analyze: deepAnalyze, printSummary: printDeepSummary } = require('./lib/deep-analyze');
const { getConfig } = require('./lib/configs');
const { getAdapter } = require('./lib/adapters/interface');
const {
  SESSION_EXTEND_INTERVAL_MS,
  REMOTE_DL_WIN,
  SUPPORTED_FILE_EXTENSIONS,
  MAX_FILE_TEXT_LENGTH,
  DOWNLOAD_WAIT_MAX_SECONDS,
} = require('./lib/constants');
const { Reporter } = require('./lib/reporter');

// ── CLI 파싱 ──
const args = Object.fromEntries(
  process.argv.slice(2)
    .filter(a => a.startsWith('--'))
    .map(a => {
      const [k, ...v] = a.slice(2).split('=');
      return [k, v.length ? v.join('=') : true];
    })
);

const INST_NAME = args.inst;
if (!INST_NAME) {
  console.log('사용법: node run-all.js --inst=기관명 --kw=사업키워드 [옵션]');
  console.log('  --inst         하위보조사업자명 (필수)');
  console.log('  --kw           사업명 키워드');
  console.log('  --dir          출력 디렉토리명');
  console.log('  --year         사업연도 (기본: 2025)');
  console.log('  --dry-run      수집+분석만 (입력 안 함)');
  console.log('  --skip-judge   judge 건너뛰기');
  console.log('  --start=N      N번째 건부터 시작');
  console.log('  --settlement   interim|final (기본: final)');
  console.log('  --staff=a,b    참여인력 이름');
  console.log('  --project      사업 config 이름');
  console.log('  --port=9444    Chrome CDP 포트 (기본: 9444)');
  process.exit(1);
}

const PROJECT_KW = args.kw || '';
const YEAR = parseInt(args.year) || 2025;
const DIR_NAME = args.dir || (PROJECT_KW || INST_NAME).replace(/[^가-힣a-zA-Z0-9]/g, '').substring(0, 20).toLowerCase();
const DRY_RUN = !!args['dry-run'];
const SKIP_JUDGE = !!args['skip-judge'];
const START_ROW = parseInt(args.start) || 1;
const STAFF = args.staff ? args.staff.split(',') : [];
const SETTLEMENT = args.settlement || 'final';
const CDP_PORT = parseInt(args.port) || 9444;

// 다운로드: 회사 PC Chrome → Windows 경로, sshfs로 로컬 접근
const REMOTE_DL_LOCAL = path.join(os.homedir(), 'company-pc', 'downloads');  // sshfs 마운트 포인트
const BASE_DIR = path.join(REMOTE_DL_LOCAL, DIR_NAME);  // sshfs 경유 다운로드 디렉토리
const DATA_FILE = path.join(__dirname, `${DIR_NAME}-data.json`);
const RESULTS_FILE = path.join(__dirname, `${DIR_NAME}-results.json`);

// ── 유틸 ──
const sleep = ms => new Promise(r => setTimeout(r, ms));

function fmtDate(d) {
  if (!d) return '';
  const s = String(d);
  if (s.length === 8) return `${s.slice(0,4)}-${s.slice(4,6)}-${s.slice(6,8)}`;
  return s;
}

const EXTS = SUPPORTED_FILE_EXTENSIONS;

async function ocrDir(dlDir) {
  const result = [];
  if (!fs.existsSync(dlDir)) return result;
  const fileNames = fs.readdirSync(dlDir).filter(f => EXTS.some(e => f.toLowerCase().endsWith(e)));
  for (const fn of fileNames) {
    const fp = path.join(dlDir, fn);
    const fnLower = fn.toLowerCase();
    let text = '';
    if (fnLower.endsWith('.pdf')) text = await extractPdfText(fp);
    else if (fnLower.endsWith('.xlsx') || fnLower.endsWith('.xls')) text = await extractExcelText(fp);
    else if (fnLower.endsWith('.hwp')) text = extractHwpText(fp);
    else if (/\.(jpg|jpeg|png)$/.test(fnLower)) text = extractImageText(fp);
    result.push({ name: fn, text: text.substring(0, MAX_FILE_TEXT_LENGTH) });
  }
  return result;
}

// ── 세션 연장 ──
let lastSessionExtend = Date.now();

async function extendSessionIfNeeded(page) {
  if (Date.now() - lastSessionExtend >= SESSION_EXTEND_INTERVAL_MS) {
    try {
      await page.evaluate(() => {
        const btn = document.getElementById('headSessionExtend');
        if (btn) btn.click();
        setTimeout(() => {
          const modal = document.querySelector('.popupMask.on');
          if (modal) {
            const ok = modal.querySelector('button.fn.ok, .fn.ok, footer button');
            if (ok) ok.click();
          }
        }, 1000);
      });
      await sleep(1500);
      lastSessionExtend = Date.now();
      console.log(`  [세션 연장 ${new Date().toLocaleTimeString()}]`);
    } catch (e) {
      console.warn('  [세션 연장 실패]', e.message);
    }
  }
}

// ── 첨부파일 다운로드 (회사 PC Chrome → sshfs 경유) ──
async function downloadFromPopup(page, context, atchmnflId, dlDir) {
  const files = [];
  if (!atchmnflId) {
    console.log(`    [DL] atchmnflId 없음 — 다운로드 스킵`);
    return files;
  }

  // sshfs 마운트 포인트 기준으로 Windows 경로 구성
  const relPath = path.relative(REMOTE_DL_LOCAL, dlDir);
  const winPath = REMOTE_DL_WIN + '\\' + relPath.replace(/\//g, '\\');

  fs.mkdirSync(dlDir, { recursive: true });
  console.log(`    [DL] ${atchmnflId} → ${winPath}`);

  for (const p of context.pages()) {
    if (p.url().includes('getDB003002SView')) await p.close().catch(() => {});
  }
  await page.waitForTimeout(300);

  const popupPromise = context.waitForEvent('page', { timeout: 8000 });
  await page.evaluate((id) => {
    window.open('/exe/db/db003/getDB003002SView.do?atchmnflId=' + id, '_blank', 'width=700,height=500,scrollbars=yes');
  }, atchmnflId);

  let popup = await popupPromise.catch(() => null);
  if (!popup) {
    await page.waitForTimeout(2000);
    popup = context.pages().find(p => p.url().includes('getDB003002SView'));
  }
  if (!popup) {
    console.log(`    [DL] 팝업 열기 실패`);
    return files;
  }

  try {
    popup.on('dialog', async d => { try { await d.accept(); } catch {} });
    await popup.waitForLoadState('domcontentloaded', { timeout: 10000 });
    await popup.waitForTimeout(2000);
    const hasFn = await popup.evaluate(() => typeof window.f_downloadDB003002S === 'function').catch(() => false);
    if (!hasFn) {
      console.log(`    [DL] f_downloadDB003002S 함수 없음`);
      await popup.close().catch(() => {});
      return files;
    }

    const cdp = await popup.context().newCDPSession(popup);
    await cdp.send('Page.setDownloadBehavior', { behavior: 'allow', downloadPath: winPath });
    await popup.evaluate(() => {
      document.querySelectorAll('input[type="checkbox"]').forEach(cb => cb.checked = true);
    });
    let filesBefore = new Set();
    try { filesBefore = new Set(fs.readdirSync(dlDir)); } catch { /* dir not yet created */ }
    await popup.evaluate(() => {
      const obs = new MutationObserver(() => {
        const mask = document.querySelector('.popupMask.on');
        if (mask) { const btn = mask.querySelector('footer button'); if (btn) setTimeout(() => btn.click(), 200); }
      });
      obs.observe(document.body, { subtree: true, attributes: true, attributeFilter: ['class'] });
      window.f_downloadDB003002S();
    });

    for (let w = 0; w < DOWNLOAD_WAIT_MAX_SECONDS; w++) {
      await new Promise(r => setTimeout(r, 1000));
      try {
        const current = fs.readdirSync(dlDir);
        const newFiles = current.filter(f => !filesBefore.has(f) && !f.endsWith('.crdownload'));
        if (newFiles.length > 0) {
          console.log(`    [DL] ${newFiles.length}개 파일 다운로드 완료`);
          for (const f of newFiles) {
            const fp = path.join(dlDir, f);
            if (f.toLowerCase().endsWith('.zip')) {
              try {
                const zip = new AdmZip(fp);
                zip.extractAllTo(dlDir, true);
                for (const e of zip.getEntries()) { if (!e.isDirectory) files.push(e.entryName); }
                fs.unlinkSync(fp);
              } catch (zipErr) {
                console.warn(`    [DL] ZIP 해제 실패: ${f} — ${zipErr.message}`);
              }
            } else { files.push(f); }
          }
          break;
        }
      } catch (readErr) {
        // 디렉토리 읽기 실패 — 아직 생성 안 됐을 수 있음
      }
    }
    if (files.length === 0) console.log(`    [DL] 30초 대기 후에도 파일 없음`);
    await cdp.detach().catch(() => {});
  } finally {
    await popup.close().catch(() => {});
  }
  return files;
}

// ── DD001003S에서 현재 건 데이터 읽기 ──
async function readCurrentDetail(page) {
  return page.evaluate(() => {
    const result = {};
    // 상단 정보 (th/label/span 쌍에서 추출)
    // select 요소는 선택된 값만 읽기
    function readValue(container) {
      const sel = container.querySelector('select');
      if (sel) {
        const opt = sel.options[sel.selectedIndex];
        return opt ? opt.text.trim() : '';
      }
      // input 요소
      const inp = container.querySelector('input[type="text"], input:not([type="hidden"])');
      if (inp) return inp.value.trim();
      // span 등 일반 텍스트 (하위 select/button 텍스트 제외)
      const clone = container.cloneNode(true);
      clone.querySelectorAll('select, button').forEach(e => e.remove());
      return clone.textContent.trim();
    }
    const tds = document.querySelectorAll('th, label, .th, td');
    for (let i = 0; i < tds.length; i++) {
      const el = tds[i];
      const text = el.textContent.trim();
      const next = el.nextElementSibling;
      if (!next) continue;
      const val = readValue(next);
      if (text.includes('집행용도')) result.purpose = val;
      if (text.includes('증빙구분')) result.evidenceType = val;
      if (text.includes('기타증빙종류')) result.evidenceSub = val;
      if (text.includes('거래처명')) result.vendorName = val;
      if (text.includes('예금주')) result.depositorName = val;
      if (text.includes('업종')) result.bizType = val;
      if (text.includes('집행일자')) result.executionDate = val;
      if (text.includes('등록일자')) result.registDate = val;
      if (text.includes('작성일자')) result.writeDate = val;
    }

    // 그리드 데이터 (DD001003SGridObj)
    const g = window.DD001003SGridObj;
    if (g) {
      const rows = g.getDataRows();
      if (rows.length > 0) {
        const rv = g.getRowValue(rows[0]);
        // asstnTaxitmNm = "비목-세비목" 형식 (예: "인건비-상용임금")
        const taxitmNm = rv.asstnTaxitmNm || '';
        const dashIdx = taxitmNm.indexOf('-');
        if (dashIdx > 0) {
          result.budgetCategory = taxitmNm.substring(0, dashIdx).trim();
          result.subCategory = taxitmNm.substring(dashIdx + 1).trim();
        } else {
          result.budgetCategory = taxitmNm;
          result.subCategory = '';
        }
        result.itemName = rv.prdlstNm || '';
        result.totalAmount = parseInt(rv.excutSumAmount) || 0;
        result.supplyAmount = parseInt(rv.fnrscSplpc) || 0;
        result.vat = parseInt(rv.fnrscVat) || 0;
        result.cancelAmount = parseInt(rv.rcvrySumAmount) || 0;
        result.disallowedAmount = parseInt(rv.nrcgnAmount) || 0;
        result.reviewStatus = rv.pfrsChckSttusCode || '';
        result.exmntId = rv.exmntId || '';
      }
    }

    // 첨부파일 ID는 hidden input에서 읽기 (그리드에 없음)
    const atchInput = document.querySelector('input[name="atchmnflId"]');
    result.atchmnflId = atchInput ? atchInput.value : '';
    const cmnInput = document.querySelector('input[name="cmnuseAtchmnflId"]');
    result.cmnuseAtchmnflId = cmnInput ? cmnInput.value : '';

    return result;
  });
}

// ── DD001003S에서 개별파일첨부 팝업으로 다운로드 ──
async function downloadFromDetailPage(page, context, atchmnflId, dlDir) {
  // 이미 다운로드된 파일이 있으면 스킵
  if (fs.existsSync(dlDir)) {
    const existing = fs.readdirSync(dlDir).filter(f => !f.endsWith('.crdownload'));
    if (existing.length > 0) {
      console.log(`    [DL] 캐시 ${existing.length}개 파일`);
      return existing;
    }
  }
  return downloadFromPopup(page, context, atchmnflId, dlDir);
}

// ── DD001003S에서 검토완료 입력 ──
async function inputReviewResult(page, resultItem) {
  const { status, disallowedAmount, comment } = resultItem;

  if (status === 'SKIP') {
    console.log(`    [SKIP] 입력하지 않음`);
    return false;
  }

  // f_changeExmntPrgst 함수 대기 (최대 10초)
  const hasFn = await page.evaluate(() => {
    return typeof f_changeExmntPrgst === 'function';
  }).catch(() => false);
  if (!hasFn) {
    console.log(`    [WARN] f_changeExmntPrgst 함수 없음 — 5초 대기 후 재시도`);
    await sleep(5000);
    // 모달 먼저 닫기
    await page.evaluate(() => {
      const modals = document.querySelectorAll('.popupMask.on');
      modals.forEach(m => {
        const btn = m.querySelector('button.fn.ok, .fn.ok, footer button');
        if (btn) btn.click();
      });
    }).catch(() => {});
    await sleep(1000);
    const hasFn2 = await page.evaluate(() => typeof f_changeExmntPrgst === 'function').catch(() => false);
    if (!hasFn2) {
      console.log(`    [ERROR] f_changeExmntPrgst 여전히 없음 — 입력 건너뜀`);
      return false;
    }
  }

  if (status === '적정') {
    // 검토상태 → 검토완료(001)
    await page.evaluate(() => f_changeExmntPrgst('001'));
    await sleep(1500);

    // 검토의견 입력
    await page.evaluate((opinion) => {
      const g = window.DD001003SGridObj;
      const rows = g.getDataRows();
      if (rows.length > 0) g.setValue(rows[0], 'vfcnExmntOpinCn', opinion);
    }, comment || '적정');

  } else if (status === '확인' || status === '보완요청') {
    // 검토상태 → 보완요청(002)
    await page.evaluate(() => f_changeExmntPrgst('002'));
    await sleep(1500);

    await page.evaluate(({ dis, cmt }) => {
      const g = window.DD001003SGridObj;
      const rows = g.getDataRows();
      if (rows.length > 0) {
        const row = rows[0];
        if (dis > 0) g.setValue(row, 'nrcgnAmount', String(dis));
        const html = (cmt || '').replace(/\n/g, '<br>');
        g.setValue(row, 'exclexCn', html);
        g.setValue(row, 'orgExclexCn', html);
      }
    }, { dis: disallowedAmount || 0, cmt: comment || '' });
  } else {
    console.log(`    [SKIP] 상태="${status}" — 입력하지 않음`);
    return false;
  }

  // 저장 클릭
  await page.evaluate(() => {
    const btn = document.getElementById('DD001003S_btnSave');
    if (btn) btn.click();
  });
  await sleep(2000);

  // 확인 모달 x2
  for (let m = 0; m < 2; m++) {
    await page.evaluate(() => {
      const modals = document.querySelectorAll('.popupMask.on');
      modals.forEach(m => {
        const btn = m.querySelector('button.fn.ok, .fn.ok, footer button');
        if (btn) btn.click();
      });
      // 폴백: "확인" 텍스트 버튼
      const ok = [...document.querySelectorAll('button')].find(
        b => b.textContent.trim() === '확인' && b.offsetParent !== null
      );
      if (ok) ok.click();
    });
    await sleep(1000);
  }
  return true;
}

// ── 다음 건 이동 ──
async function goToNextItem(page) {
  // 최대 5회 재시도 (팝업/오버레이 대응)
  for (let attempt = 0; attempt < 5; attempt++) {
    // 먼저 모든 팝업/모달/alert 닫기 시도
    await page.evaluate(() => {
      // 방법1: popupMask
      document.querySelectorAll('.popupMask.on, .modal.show, .ui-dialog').forEach(m => {
        const btn = m.querySelector('button.fn.ok, .fn.ok, footer button, button');
        if (btn) btn.click();
      });
      // 방법2: "확인"/"닫기" 버튼 직접 클릭
      [...document.querySelectorAll('button')].forEach(b => {
        const t = b.textContent.trim();
        if ((t === '확인' || t === '닫기') && b.offsetParent !== null) {
          const r = b.getBoundingClientRect();
          if (r.width > 0 && r.width < 200) b.click();
        }
      });
    }).catch(() => {});
    await sleep(500);

    const result = await page.evaluate(() => {
      const allBtns = [...document.querySelectorAll('button, a, span, input[type="button"], img')];
      const next = allBtns.find(b => {
        const text = b.textContent || b.value || b.alt || b.title || '';
        return text.includes('다음') && b.offsetParent !== null;
      });
      if (next) { next.click(); return { clicked: true }; }
      // 디버그: 보이는 버튼 목록 반환
      const visible = allBtns
        .filter(b => b.offsetParent !== null)
        .map(b => (b.textContent || b.value || b.alt || '').trim().substring(0, 30))
        .filter(t => t.length > 0)
        .slice(0, 20);
      return { clicked: false, visibleButtons: visible, url: location.href };
    });

    if (result.clicked) {
      await sleep(3000);
      return true;
    }
    if (attempt === 0) {
      console.log(`    [DEBUG] 다음 버튼 미발견. URL: ${result.url}`);
      console.log(`    [DEBUG] 보이는 버튼: ${(result.visibleButtons || []).join(' | ')}`);
    }
    // 재시도 전 대기 (점진적 증가)
    await sleep(1000 + attempt * 1000);
  }
  return false;
}

// ── 목록 페이지에서 특정 행의 DD001003S 진입 (0-indexed rowIdx) ──
async function enterDetailFromList(page, rowIdx) {
  try {
    // 정산구분 재설정이 필요할 수 있음 (상세→목록 복귀 시 초기화됨)
    await page.evaluate(() => {
      const sel = document.querySelector('select[name="pfrsChckSttusCode"], #pfrsChckSttusCode');
      if (sel) { sel.value = ''; sel.dispatchEvent(new Event('change')); }
    }).catch(() => {});

    // DD001002Q 그리드 확인
    const gridInfo = await page.evaluate((idx) => {
      const g = window.DD001002QGridObj;
      if (!g) return { error: 'DD001002QGridObj 없음' };
      const rows = g.getDataRows();
      if (!rows || rows.length === 0) return { error: '그리드 행 없음' };
      if (idx >= rows.length) return { error: `행 ${idx}은 범위 초과 (총 ${rows.length}행)` };
      g.focus(rows[idx]);
      // clickCell로도 시도
      if (g.clickCell) g.clickCell(rows[idx], 'excutPrposCn');
      return { ok: true, totalRows: rows.length, focusedIdx: idx };
    }, rowIdx);

    if (gridInfo.error) {
      console.log(`    [enterDetailFromList] ${gridInfo.error}`);
      return false;
    }
    console.log(`    [enterDetailFromList] ${gridInfo.focusedIdx}행 focus (총 ${gridInfo.totalRows}행)`);
    await sleep(1000);

    // 세부내역검토 버튼 클릭
    const btnExists = await page.evaluate(() => {
      const btn = document.getElementById('DD001002Q_detlListExmnt');
      if (btn) { btn.click(); return true; }
      // 폴백: 텍스트로 찾기
      const all = [...document.querySelectorAll('button, a')];
      const alt = all.find(b => b.textContent.includes('세부내역검토') && b.offsetParent !== null);
      if (alt) { alt.click(); return true; }
      return false;
    });
    if (!btnExists) {
      console.log(`    [enterDetailFromList] 세부내역검토 버튼 없음`);
      return false;
    }
    console.log(`    [enterDetailFromList] 세부내역검토 클릭`);
    await sleep(3000);

    // DD001003S 로드 대기 (최대 15초)
    for (let w = 0; w < 30; w++) {
      const ready = await page.evaluate(() => {
        return typeof DD001003SGridObj !== 'undefined' &&
          DD001003SGridObj.getDataRows().length > 0;
      }).catch(() => false);
      if (ready) {
        console.log(`    [enterDetailFromList] DD001003S 로드 완료`);
        return true;
      }
      await sleep(500);
    }

    // DD001003S 로드 안 됐으면 실패 (또 0원 취소전표일 수도)
    const currentUrl = await page.evaluate(() => location.href).catch(() => '');
    console.log(`    [enterDetailFromList] DD001003S 미로드. URL: ${currentUrl.substring(currentUrl.length - 60)}`);
    // 0원 항목이 연속될 수 있으므로, 목록에 있으면 true 반환하여 다음 건 처리 허용
    const stillOnList = currentUrl.includes('DD001002Q');
    return stillOnList ? 'on_list' : false;
  } catch (e) {
    console.error(`    [enterDetailFromList] 에러: ${e.message}`);
    return false;
  }
}

// ── 점진적 저장 ──
function saveIncremental(records, results) {
  // data.json
  const output = records.map(r => {
    const { atchmnflId, cmnuseAtchmnflId, excutId, ...rest } = r;
    return rest;
  });
  fs.writeFileSync(DATA_FILE, JSON.stringify(output, null, 2), 'utf-8');

  // results.json
  if (results.length > 0) {
    fs.writeFileSync(RESULTS_FILE, JSON.stringify(results, null, 2), 'utf-8');
  }
}

// ── 그리드 추출 (Phase 1 이전 용도로 보존, 실제로는 사용 안 함) ──
async function extractAllGridData(page) {
  const currentRows = await page.evaluate(() => {
    const grid = window.DD001002QGridObj;
    return grid ? grid.getDataRows().length : 0;
  });

  if (currentRows === 0) {
    await page.evaluate(() => {
      const sel = document.getElementById('DD001002Q_selPageSize');
      if (sel) {
        const opts = [...sel.options].map(o => o.value);
        if (opts.includes('100')) { sel.value = '100'; sel.dispatchEvent(new Event('change')); }
        else if (opts.includes('50')) { sel.value = '50'; sel.dispatchEvent(new Event('change')); }
      }
      const btn = document.getElementById('DD001002Q_btnRetrieve') ||
                  [...document.querySelectorAll('button')].find(b => b.textContent.trim() === '검색' && b.offsetWidth > 0);
      if (btn) btn.click();
    });
    console.log('  페이지 사이즈 변경 -> 재검색...');
    await new Promise(r => setTimeout(r, 4000));
  } else {
    console.log(`  현재 그리드 ${currentRows}건 로드됨`);
  }

  const allRows = [];
  let pageNum = 1;
  while (true) {
    const pageData = await page.evaluate(() => {
      const grid = window.DD001002QGridObj;
      if (!grid) return { rows: [], total: 0 };
      const dataRows = grid.getDataRows();
      const rows = dataRows.map(row => {
        const v = grid.getRowValue(row);
        return {
          excutExecutDe: v.excutExecutDe || '', excutRegistDe: v.excutRegistDe || '',
          writngDe: v.writngDe || '', prufSeNm: v.prufSeNm || '', etcPruf: v.etcPruf || '',
          excutPrposCn: v.excutPrposCn || '', asstnExpitmNm: v.asstnExpitmNm || '',
          asstnTaxitmNm: v.asstnTaxitmNm || '', prdlstNm: v.prdlstNm || '',
          bcncCmpnyNm: v.bcncCmpnyNm || '', dpstrNm: v.dpstrNm || '',
          bcncIndutyNm: v.bcncIndutyNm || '', excutSplpc: v.excutSplpc || 0,
          excutVat: v.excutVat || 0, rcvrySumAmount: v.rcvrySumAmount || 0,
          lastAmount: v.lastAmount || 0, nrcgnAmount: v.nrcgnAmount || 0,
          atchmnflId: v.atchmnflId || '', cmnuseAtchmnflId: v.cmnuseAtchmnflId || '', excutId: v.excutId || '',
          exmntPrgstNm: v.exmntPrgstNm || '',
        };
      });
      const totalEl = document.getElementById('DD001002Q_searchCnt');
      const totalMatch = totalEl ? totalEl.textContent.match(/(\d+)/) : null;
      const total = totalMatch ? parseInt(totalMatch[1]) : (dataRows.length > 0 ? grid.getRowValue(dataRows[0]).totalNum || 0 : 0);
      return { rows, total };
    });
    allRows.push(...pageData.rows);
    console.log(`  페이지 ${pageNum}: ${pageData.rows.length}건 (누적 ${allRows.length}/${pageData.total}건)`);
    if (allRows.length >= pageData.total || pageData.rows.length === 0) break;
    pageNum++;
    const hasNext = await page.evaluate((pn) => {
      try { f_retrieveListBsnsExcutDetl(pn); return true; } catch { return false; }
    }, pageNum);
    if (!hasNext) break;
    await new Promise(r => setTimeout(r, 3000));
  }
  return { allRows, total: allRows.length };
}

// ══════════════════════════════════════
//  메인 파이프라인 (v2: 건별 순차 처리)
// ══════════════════════════════════════
async function main() {
  const reporter = new Reporter({ system: 'enaradomum', silent: true });
  const t0 = Date.now();
  const settleLabel = SETTLEMENT === 'interim' ? '중간정산' : '최종정산';
  console.log('╔══════════════════════════════════════════════════╗');
  console.log(`║  ${INST_NAME} (${PROJECT_KW || '-'})`);
  console.log(`║  dir=${DIR_NAME} year=${YEAR} ${settleLabel}`);
  console.log(`║  ${DRY_RUN ? 'DRY-RUN' : 'SAVE'} start=${START_ROW}`);
  console.log('╚══════════════════════════════════════════════════╝\n');

  fs.mkdirSync(BASE_DIR, { recursive: true });

  // 기존 data/results 로드 (이어하기용)
  let records = [];
  let results = [];
  if (fs.existsSync(DATA_FILE)) {
    try {
      records = JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8'));
      console.log(`  기존 data 로드: ${records.length}건`);
    } catch (e) {
      console.warn(`  기존 data 로드 실패: ${e.message}`);
    }
  }
  if (fs.existsSync(RESULTS_FILE)) {
    try {
      results = JSON.parse(fs.readFileSync(RESULTS_FILE, 'utf-8'));
      console.log(`  기존 results 로드: ${results.length}건`);
    } catch (e) {
      console.warn(`  기존 results 로드 실패: ${e.message}`);
    }
  }

  // ════════ Phase 0: 네비게이션 ════════
  reporter.phaseChange(0, '네비게이션');
  console.log('\n[Phase 0] 네비게이션...');
  const { page, context, selected } = await nav.goToInstitution({
    institutionName: INST_NAME,
    projectKeyword: PROJECT_KW,
    year: YEAR,
    port: CDP_PORT,
  });
  console.log(`  사업: ${selected.taskNm}`);
  console.log(`  상태: ${selected.excutLmttResnNm}`);
  console.log(`  집행건: ${selected.gridCount}건`);

  // 정산구분 설정 (항상 명시적)
  const radioId = SETTLEMENT === 'interim' ? 'DD001002Q_excclcSeCode_2' : 'DD001002Q_excclcSeCode_1';
  await page.evaluate((id) => {
    const r = document.getElementById(id);
    if (r && !r.checked) r.click();
  }, radioId);
  await page.evaluate(() => {
    const btn = document.getElementById('DD001002Q_btnRetrieve') ||
                [...document.querySelectorAll('button')].find(b => b.textContent.trim() === '검색' && b.offsetWidth > 0);
    if (btn) btn.click();
  });
  console.log(`  ${settleLabel} 설정 -> 재검색`);
  await sleep(3000);

  // 총 건수 읽기
  const totalCount = await page.evaluate(() => {
    const el = document.getElementById('DD001002Q_searchCnt');
    if (el) {
      const m = el.textContent.match(/(\d+)/);
      if (m) return parseInt(m[1]);
    }
    const g = window.DD001002QGridObj;
    return g ? g.getDataRows().length : 0;
  });
  console.log(`  총 ${totalCount}건\n`);

  // ════════ Phase 1: 세부내역검토(DD001003S) 진입 ════════
  reporter.phaseChange(1, '세부내역검토 진입');
  console.log('[Phase 1] 세부내역검토 진입...');

  // 그리드 로드 대기
  for (let w = 0; w < 20; w++) {
    const ready = await page.evaluate(() => {
      const g = window.DD001002QGridObj;
      return g && typeof g.getDataRows === 'function' && g.getDataRows().length > 0;
    }).catch(() => false);
    if (ready) break;
    await sleep(500);
  }

  // 1행 focus + 확인
  for (let attempt = 0; attempt < 3; attempt++) {
    await page.evaluate(() => {
      const g = window.DD001002QGridObj;
      const rows = g.getDataRows();
      if (rows.length > 0) g.focus(rows[0]);
    });
    await sleep(800);

    // focus 확인
    const focused = await page.evaluate(() => {
      const g = window.DD001002QGridObj;
      return g.getFocusedRow ? g.getFocusedRow() !== null : true;
    }).catch(() => false);

    if (focused) {
      console.log('  1행 focus 확인');
      break;
    }
    console.log(`  1행 focus 실패 (시도 ${attempt + 1}/3)`);
  }

  // 세부내역검토 클릭
  await page.click('#DD001002Q_detlListExmnt');
  await sleep(2000);

  // "선택해주세요" 모달 확인 → 있으면 닫고 재시도
  const modalText = await page.evaluate(() => {
    const m = document.querySelector('.popupMask.on');
    return m ? m.textContent.trim() : null;
  }).catch(() => null);

  if (modalText && /선택/.test(modalText)) {
    console.log('  [WARN] 행 선택 안 됨 — 모달 닫고 재시도');
    await page.evaluate(() => {
      const modals = document.querySelectorAll('.popupMask.on');
      modals.forEach(m => {
        const btn = m.querySelector('button.fn.ok, .fn.ok, footer button');
        if (btn) btn.click();
      });
    });
    await sleep(1000);

    // DOM 클릭으로 재시도 (tbody 첫 행)
    await page.evaluate(() => {
      const g = window.DD001002QGridObj;
      const rows = g.getDataRows();
      if (rows.length > 0) {
        g.focus(rows[0]);
        // 폴백: clickCell
        if (g.clickCell) g.clickCell(rows[0], 'excutPrposCn');
      }
    });
    await sleep(800);
    await page.click('#DD001002Q_detlListExmnt');
    await sleep(3000);
  }

  await sleep(2000);

  // DD001003S 그리드 로드 대기
  for (let w = 0; w < 20; w++) {
    const ready = await page.evaluate(() => {
      return typeof DD001003SGridObj !== 'undefined' &&
        DD001003SGridObj.getDataRows().length > 0;
    }).catch(() => false);
    if (ready) break;
    await sleep(500);
  }

  console.log('  DD001003S 진입 완료\n');

  // --start=N: 다음 버튼으로 N-1번 스킵
  if (START_ROW > 1) {
    console.log(`  [start=${START_ROW}] ${START_ROW - 1}건 스킵 중...`);
    for (let s = 1; s < START_ROW; s++) {
      await extendSessionIfNeeded(page);
      const moved = await goToNextItem(page);
      if (!moved) {
        console.error(`  [ERROR] ${s}번째에서 다음 이동 실패`);
        break;
      }
      if (s % 10 === 0) console.log(`    ${s}건 스킵 완료`);
    }
    console.log(`  스킵 완료 -> ${START_ROW}번째 건부터 시작\n`);
  }

  // project config 준비
  const projectConfig = getConfig(args.project || PROJECT_KW || '', {
    institutionName: INST_NAME,
    legalBasis: args.basis || '보조금',
  });

  // ════════ Phase 2: 건별 루프 ════════
  reporter.phaseChange(2, '건별 처리');
  console.log('[Phase 2] 건별 처리 시작...');
  let processed = 0, skipped = 0, reviewed = 0;

  for (let itemIdx = START_ROW; itemIdx <= totalCount; itemIdx++) {
    const itemT0 = Date.now();

    // 세션 연장 체크
    await extendSessionIfNeeded(page);

    // ── 2a-0: DD001003S에 있는지 확인 (0원 취소전표는 목록으로 돌아감) ──
    const onDD001003S = await page.evaluate(() => {
      return typeof DD001003SGridObj !== 'undefined' &&
        DD001003SGridObj.getDataRows && DD001003SGridObj.getDataRows().length > 0;
    }).catch(() => false);

    if (!onDD001003S) {
      // 목록 페이지에 있음 → 이 건은 SKIP 처리
      console.log(`  [R${itemIdx}/${totalCount}] (DD001003S 미진입 — 0원/취소전표 추정)`);
      const skipRec = { rowNum: itemIdx, totalAmount: 0, itemName: '', vendorName: '', files: [],
        analysis: { flags: [{ id: 'SKIP_0원', description: '0원 (DD001003S 미진입)' }] } };
      const existIdx = records.findIndex(r => r.rowNum === itemIdx);
      if (existIdx >= 0) records[existIdx] = skipRec;
      else records.push(skipRec);
      const skipResult = { rowNum: itemIdx, status: 'SKIP', comment: '0원 (취소전표-DD001003S 미진입)', disallowedAmount: 0 };
      const resIdx = results.findIndex(r => r.rowNum === itemIdx);
      if (resIdx >= 0) results[resIdx] = skipResult;
      else results.push(skipResult);
      console.log(`    판정: SKIP — DD001003S 미진입`);
      processed++;
      // 다음 건으로 이동 시도 (목록에서)
      if (itemIdx < totalCount) {
        const entered = await enterDetailFromList(page, itemIdx); // 0-indexed
        if (entered === true) continue;
        if (entered === 'on_list') continue; // 연속 0원
        console.error(`  [ERROR] R${itemIdx} 이후 목록에서 다음 진입 실패 — 루프 종료`);
        break;
      }
      continue;
    }

    // ── 2a: 현재 건 데이터 읽기 ──
    const detail = await readCurrentDetail(page);

    // 검토완료(001)도 재검토 (이전 판정이 부정확할 수 있음)

    const rec = {
      rowNum: itemIdx,
      executionDate: detail.executionDate || '',
      registDate: detail.registDate || '',
      writeDate: detail.writeDate || '',
      evidenceType: detail.evidenceType || '',
      evidenceSub: detail.evidenceSub || '',
      purpose: detail.purpose || '',
      budgetCategory: detail.budgetCategory || '',
      subCategory: detail.subCategory || '',
      itemName: detail.itemName || '',
      vendorName: detail.vendorName || '',
      depositorName: detail.depositorName || '',
      bizType: detail.bizType || '',
      supplyAmount: detail.supplyAmount || 0,
      vat: detail.vat || 0,
      cancelAmount: detail.cancelAmount || 0,
      totalAmount: detail.totalAmount || 0,
      disallowedAmount: detail.disallowedAmount || 0,
      reviewStatus: detail.reviewStatus || '',
      atchmnflId: detail.atchmnflId || '',
      cmnuseAtchmnflId: detail.cmnuseAtchmnflId || '',
      excutId: detail.excutId || '',
      files: [],
    };

    console.log(`  [R${itemIdx}/${totalCount}] ${rec.itemName || rec.purpose || '-'} | ${rec.vendorName || '-'} | ${rec.totalAmount}원`);
    reporter.progress(itemIdx, totalCount, `${rec.itemName || rec.purpose || '-'}`);

    // ── 2b: 첨부파일 다운로드 ──
    const dlDir = path.join(BASE_DIR, `r${itemIdx}`);
    let dlFiles = [];
    if (rec.atchmnflId) {
      dlFiles = await downloadFromDetailPage(page, context, rec.atchmnflId, dlDir);
    }
    if (rec.cmnuseAtchmnflId) {
      const sharedFiles = await downloadFromDetailPage(page, context, rec.cmnuseAtchmnflId, dlDir);
      dlFiles = dlFiles.concat(sharedFiles);
    }

    // ── 2c: OCR ──
    rec.files = await ocrDir(dlDir);

    // ── 2d: 심층분석 (단건) ──
    const enriched = deepAnalyze([rec], projectConfig);
    const enrichedRec = enriched[0];
    const flagCount = enrichedRec.analysis ? enrichedRec.analysis.flags.length : 0;
    if (flagCount > 0) {
      console.log(`    분석: ${flagCount}개 플래그 — ${enrichedRec.analysis.flags.map(f => f.id || f).join(', ')}`);
    }

    // records 배열에 추가/갱신
    const existIdx = records.findIndex(r => r.rowNum === itemIdx);
    const saveRec = { ...enrichedRec };
    delete saveRec.atchmnflId;
    delete saveRec.cmnuseAtchmnflId;
    delete saveRec.excutId;
    if (existIdx >= 0) records[existIdx] = saveRec;
    else records.push(saveRec);

    // ── 2e: 판정 (deep-analyze 플래그 기반) ──
    let resultItem = null;
    if (!SKIP_JUDGE) {
      const flags = (saveRec.analysis && saveRec.analysis.flags) || [];
      const flagIds = flags.map(f => f.id || f);

      // 0원 → SKIP (입력하지 않음)
      if (flagIds.some(id => id.includes('SKIP_0원') || id.includes('zero_amount'))) {
        resultItem = {
          rowNum: itemIdx,
          status: 'SKIP',
          comment: '0원 (취소전표)',
          disallowedAmount: 0,
        };
      } else {
        const activeFlags = flags.filter(f => {
          const id = f.id || f;
          // 정보성 플래그는 판정에서 제외
          return !id.includes('보조금전용카드_외_카드사용');
        });
        if (activeFlags.length > 0) {
          const flagDescs = activeFlags.map(f => f.description || f.id || f).join('; ');
          resultItem = {
            rowNum: itemIdx,
            status: '확인',
            comment: flagDescs.substring(0, 200),
            disallowedAmount: 0,
          };
        } else {
          resultItem = {
            rowNum: itemIdx,
            status: '적정',
            comment: '적정',
            disallowedAmount: 0,
          };
        }
      }
      console.log(`    판정: ${resultItem.status} ${resultItem.comment !== '적정' ? '— ' + resultItem.comment.substring(0, 50) : ''}`);
      reporter.itemComplete(`R${itemIdx} ${rec.itemName || ''}`, resultItem.status, Date.now() - itemT0);
    }

    // ── 2f: 입력 (검토완료/보완요청) ──
    if (!DRY_RUN && resultItem) {
      const saved = await inputReviewResult(page, resultItem);
      if (saved) {
        reviewed++;
        console.log(`    입력 완료`);
      }
    }

    // results 배열에 추가/갱신
    if (resultItem) {
      const resIdx = results.findIndex(r => r.rowNum === itemIdx);
      if (resIdx >= 0) results[resIdx] = resultItem;
      else results.push(resultItem);
    }

    processed++;

    // ── 2g: 점진적 저장 (매 5건) ──
    if (processed % 5 === 0) {
      saveIncremental(records, results);
      console.log(`    [저장] ${processed}건 처리 (data: ${records.length}건, results: ${results.length}건)`);
    }

    const itemElapsed = ((Date.now() - itemT0) / 1000).toFixed(1);
    console.log(`    ${itemElapsed}s`);

    // ── 2h: 다음 건 이동 ──
    if (itemIdx < totalCount) {
      const moved = await goToNextItem(page);
      if (!moved) {
        // DD001002Q(목록) 페이지에 있으면 다음 행에서 DD001003S 재진입
        const onList = await page.evaluate(() =>
          location.href.includes('DD001002Q') || typeof DD001002QGridObj !== 'undefined'
        ).catch(() => false);
        if (onList) {
          console.log(`    [FALLBACK] 목록 페이지에서 R${itemIdx + 1} 진입 시도`);
          const entered = await enterDetailFromList(page, itemIdx); // 0-indexed: itemIdx = 다음건
          if (entered === true) {
            console.log(`    [FALLBACK] DD001003S 재진입 성공`);
            continue;
          } else if (entered === 'on_list') {
            // 다음 건도 0원이라 목록에 남아있음 → 계속 진행 (다음 루프에서 다시 시도)
            console.log(`    [FALLBACK] 다음 건도 목록 복귀 (연속 0원 가능) — 계속 진행`);
            continue;
          }
        }
        console.error(`  [ERROR] R${itemIdx} 이후 다음 이동 실패 — 루프 종료`);
        break;
      }
    }
  }

  // ════════ 최종 저장 ════════
  saveIncremental(records, results);

  // 심층분석 요약 출력 (전체)
  if (records.length > 0 && records[0].analysis) {
    console.log('\n[심층분석 요약]');
    printDeepSummary(records);
  }

  // ════════ 최종 요약 ════════
  const ok = results.filter(r => r.status === '적정').length;
  const ng = results.filter(r => r.status === '확인' || r.status === '보완요청').length;
  const elapsed = ((Date.now() - t0) / 60000).toFixed(1);
  console.log('\n╔══════════════════════════════════════════════════╗');
  console.log(`║  ${PROJECT_KW || INST_NAME} 완료`);
  console.log(`║  처리: ${processed}건, 스킵: ${skipped}건, 입력: ${reviewed}건`);
  console.log(`║  적정: ${ok} / 확인: ${ng}`);
  console.log(`║  소요시간: ${elapsed}분`);
  console.log(`║  data: ${DATA_FILE}`);
  console.log(`║  results: ${RESULTS_FILE}`);
  console.log('╚══════════════════════════════════════════════════╝');

  reporter.done({ institution: INST_NAME, processed, skipped, ok, ng, elapsed: `${elapsed}분` });
}

module.exports = { main };

if (require.main === module) {
  main().catch(err => {
    console.error('\n!! 파이프라인 오류 !!');
    console.error(err);
    process.exitCode = 1;
  });
}
