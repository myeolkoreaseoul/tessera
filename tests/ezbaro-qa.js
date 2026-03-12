/**
 * QA Test: Tessera 이지바로 페이지
 *
 * 테스트 시나리오:
 * TC1: 상태 복원 - hasData:false 시 빈 화면 + 업로드 영역 표시
 * TC2: 초기화 버튼 - 데이터 없을 때 미노출
 * TC3: 로그인 모달 - 기본 상태에서 미노출
 * TC4: API 통합 - reset / state / save-filter 엔드포인트
 */

const { chromium } = require('playwright');

const BASE_URL = 'http://127.0.0.1:3500';
const PAGE_URL = `${BASE_URL}/ezbaro/`;
const TIMEOUT = 15000;

const results = [];

function report(tc, command, expected, actual, pass) {
  const status = pass ? 'PASS' : 'FAIL';
  results.push({ tc, command, expected, actual, status });
  console.log(`\n[${status}] ${tc}`);
  console.log(`  Command : ${command}`);
  console.log(`  Expected: ${expected}`);
  console.log(`  Actual  : ${actual}`);
}

async function resetServerState() {
  const res = await fetch(`${BASE_URL}/api/ezbaro/reset`, { method: 'POST' });
  const data = await res.json();
  return data;
}

async function main() {
  // 사전 작업: 서버 상태 초기화
  console.log('=== Tessera 이지바로 QA 테스트 시작 ===');
  console.log(`대상: ${PAGE_URL}`);

  const resetData = await resetServerState();
  console.log(`\n[SETUP] 서버 상태 초기화: ${JSON.stringify(resetData)}`);

  const stateCheck = await fetch(`${BASE_URL}/api/ezbaro/state`);
  const stateData = await stateCheck.json();
  console.log(`[SETUP] 초기 상태 확인: ${JSON.stringify(stateData)}`);

  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  const page = await browser.newPage();
  page.setDefaultTimeout(TIMEOUT);

  // ----- TC1: 상태 복원 - hasData:false 시 빈 화면 -----
  console.log('\n--- TC1: 상태 복원 테스트 ---');
  await page.goto(PAGE_URL, { waitUntil: 'networkidle' });

  // 복원 스피너가 사라질 때까지 대기 (최대 10초)
  try {
    await page.waitForSelector('text=상태 복원 중...', { state: 'detached', timeout: 10000 });
  } catch (_) {
    // 이미 사라졌거나 없을 수 있음
  }

  // 업로드 섹션 헤딩 확인
  const uploadHeading = await page.locator('h2:has-text("엑셀 업로드")').isVisible().catch(() => false);
  report(
    'TC1-A: hasData:false 시 업로드 섹션 표시',
    'page.locator(\'h2:has-text("엑셀 업로드")\').isVisible()',
    'true (엑셀 업로드 헤딩 보임)',
    String(uploadHeading),
    uploadHeading === true
  );

  // 드래그 업로드 영역 확인
  const dropZone = await page.locator('text=엑셀 업로드').first().isVisible().catch(() => false);
  report(
    'TC1-B: 드래그 업로드 영역 표시',
    'page.locator(\'text=엑셀 업로드\').first().isVisible()',
    'true (업로드 드래그 영역 보임)',
    String(dropZone),
    dropZone === true
  );

  // Step2(작업 설정 섹션)가 안 보여야 함 — uploadResult 없으면 조건부 렌더링으로 숨겨짐
  const workSettingSection = await page.locator('h2:has-text("작업 설정")').isVisible().catch(() => false);
  report(
    'TC1-C: 데이터 없을 때 작업 설정 섹션 미노출',
    'page.locator(\'h2:has-text("작업 설정")\').isVisible()',
    'false (작업 설정 섹션 숨겨짐)',
    String(workSettingSection),
    workSettingSection === false
  );

  // ----- TC2: 초기화 버튼 - 데이터 없을 때 미노출 -----
  console.log('\n--- TC2: 초기화 버튼 테스트 ---');

  const resetButton = await page.locator('button:has-text("데이터 초기화")').isVisible().catch(() => false);
  report(
    'TC2: 데이터 없을 때 초기화 버튼 미노출',
    'page.locator(\'button:has-text("데이터 초기화")\').isVisible()',
    'false (초기화 버튼 숨겨짐)',
    String(resetButton),
    resetButton === false
  );

  // ----- TC3: 로그인 모달 DOM 기본 미노출 -----
  console.log('\n--- TC3: 로그인 모달 테스트 ---');

  // 모달은 launchModal state가 null일 때 DOM에 없어야 함
  const modalOverlay = await page.locator('.fixed.inset-0.bg-black\\/60').isVisible().catch(() => false);
  report(
    'TC3-A: 로그인 모달 오버레이 기본 미노출',
    'page.locator(\'.fixed.inset-0.bg-black/60\').isVisible()',
    'false (모달 오버레이 없음)',
    String(modalOverlay),
    modalOverlay === false
  );

  const modalTitle = await page.locator('h3:has-text("출격 준비")').isVisible().catch(() => false);
  report(
    'TC3-B: "출격 준비" 모달 타이틀 기본 미노출',
    'page.locator(\'h3:has-text("출격 준비")\').isVisible()',
    'false (모달 타이틀 없음)',
    String(modalTitle),
    modalTitle === false
  );

  const loginCompleteBtn = await page.locator('button:has-text("로그인 완료, 시작")').isVisible().catch(() => false);
  report(
    'TC3-C: "로그인 완료, 시작" 버튼 기본 미노출',
    'page.locator(\'button:has-text("로그인 완료, 시작")\').isVisible()',
    'false (버튼 없음)',
    String(loginCompleteBtn),
    loginCompleteBtn === false
  );

  await browser.close();

  // ----- TC4: API 통합 테스트 (HTTP 직접) -----
  console.log('\n--- TC4: API 통합 테스트 ---');

  // TC4-A: POST /api/ezbaro/reset
  const resetRes = await fetch(`${BASE_URL}/api/ezbaro/reset`, { method: 'POST' });
  const resetJson = await resetRes.json();
  const resetOk = resetRes.status === 200 && resetJson.ok === true;
  report(
    'TC4-A: POST /api/ezbaro/reset 정상 응답',
    'POST /api/ezbaro/reset',
    'HTTP 200, { ok: true }',
    `HTTP ${resetRes.status}, ${JSON.stringify(resetJson)}`,
    resetOk
  );

  // TC4-B: GET /api/ezbaro/state
  const stateRes = await fetch(`${BASE_URL}/api/ezbaro/state`);
  const stateJson = await stateRes.json();
  const stateOk = stateRes.status === 200 && typeof stateJson.hasData === 'boolean';
  report(
    'TC4-B: GET /api/ezbaro/state 정상 응답',
    'GET /api/ezbaro/state',
    'HTTP 200, { hasData: boolean }',
    `HTTP ${stateRes.status}, ${JSON.stringify(stateJson)}`,
    stateOk
  );

  // TC4-C: POST /api/ezbaro/save-filter
  const filterPayload = { 담당자: '홍길동', status: '점검전', sortMode: 'unchecked' };
  const saveRes = await fetch(`${BASE_URL}/api/ezbaro/save-filter`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(filterPayload),
  });
  const saveJson = await saveRes.json();
  const saveOk = saveRes.status === 200 && saveJson.ok === true;
  report(
    'TC4-C: POST /api/ezbaro/save-filter 정상 응답',
    `POST /api/ezbaro/save-filter ${JSON.stringify(filterPayload)}`,
    'HTTP 200, { ok: true }',
    `HTTP ${saveRes.status}, ${JSON.stringify(saveJson)}`,
    saveOk
  );

  // TC4-D: GET /api/ezbaro/state - save-filter 후 필터 복원 확인
  // Note: hasData:false인 상태에서도 filter가 저장되는지 확인
  // (데이터가 없으면 state endpoint가 filter를 포함하지 않을 수 있음 - 실제 동작 검증)
  const stateAfterRes = await fetch(`${BASE_URL}/api/ezbaro/state`);
  const stateAfterJson = await stateAfterRes.json();
  // hasData:false 상태에서는 filter 키가 있거나 없을 수 있음 — 실제 응답 기록
  const stateAfterOk = stateAfterRes.status === 200;
  report(
    'TC4-D: save-filter 후 GET /api/ezbaro/state 재확인',
    'GET /api/ezbaro/state (save-filter 이후)',
    'HTTP 200 (응답 구조 확인)',
    `HTTP ${stateAfterRes.status}, ${JSON.stringify(stateAfterJson)}`,
    stateAfterOk
  );

  // ----- 최종 요약 -----
  console.log('\n' + '='.repeat(60));
  console.log('QA Test Report: Tessera 이지바로 페이지');
  console.log('='.repeat(60));

  const passed = results.filter(r => r.status === 'PASS').length;
  const failed = results.filter(r => r.status === 'FAIL').length;

  console.log(`\nTotal: ${results.length} / Passed: ${passed} / Failed: ${failed}`);
  console.log('');

  results.forEach(r => {
    console.log(`  [${r.status}] ${r.tc}`);
  });

  if (failed > 0) {
    console.log('\n[FAILED TESTS]');
    results.filter(r => r.status === 'FAIL').forEach(r => {
      console.log(`\n  ${r.tc}`);
      console.log(`    Expected: ${r.expected}`);
      console.log(`    Actual  : ${r.actual}`);
    });
  }

  process.exit(failed > 0 ? 1 : 0);
}

main().catch(err => {
  console.error('\n[FATAL ERROR]', err.message);
  process.exit(1);
});
