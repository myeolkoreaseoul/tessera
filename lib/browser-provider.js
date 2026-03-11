/**
 * browser-provider.js — Playwright 로컬 브라우저 관리
 *
 * TESSERA_MODE=electron 일 때 사용.
 * 시스템별(port) 독립 프로필로 launchPersistentContext 실행.
 * 쿠키/세션이 userDataDir에 유지되므로 앱 재시작 후에도 로그인 상태 보존.
 *
 * 아키텍처:
 *   메인 프로세스 (Electron main) → launchLocal() → persistent context 생성 + CDP port 노출
 *   fork된 프로세스 (robot)       → connectLocal() → CDP port로 연결 (context 공유)
 */

const path = require('path');
const os = require('os');
const fs = require('fs');

// Playwright Chromium 경로 설정 (require('playwright') 전에 해야 함)
if (process.env.TESSERA_MODE === 'electron') {
  const isPackaged = !process.defaultApp; // Electron 패키징 상태 판별
  const bundledChromium = isPackaged
    ? path.join(process.resourcesPath, 'playwright-chromium')
    : path.resolve(__dirname, '..', 'playwright-chromium');
  if (fs.existsSync(bundledChromium)) {
    process.env.PLAYWRIGHT_BROWSERS_PATH = bundledChromium;
  }
}

const { chromium } = require('playwright');

const SYSTEM_NAMES = {
  9444: 'enaradomum',
  9445: 'botame',
  9446: 'ezbaro',
};

/** 시스템 논리 포트 → CDP 디버깅 포트 매핑 */
const CDP_DEBUG_PORTS = {
  9444: 19444,
  9445: 19445,
  9446: 19446,
};

/** port → { browser, context } 캐시 (메인 프로세스 전용) */
const cache = new Map();
/** port → Promise<entry> 진행 중인 launch 방지 */
const pending = new Map();

/** 프로필 디렉토리 루트 */
function profileRoot() {
  return path.join(os.homedir(), '.tessera', 'profiles');
}

/**
 * 로컬 Chromium 브라우저를 시스템별 프로필로 실행하거나 기존 context 재사용.
 * 메인 프로세스(Electron main)에서만 호출.
 *
 * @param {number} port — 시스템 식별용 논리 포트 (9444/9445/9446)
 * @returns {Promise<{ browser: import('playwright').Browser|null, context: import('playwright').BrowserContext }>}
 */
async function launchLocal(port = 9444) {
  const existing = cache.get(port);
  if (existing) {
    try {
      await existing.context.pages();
      return existing;
    } catch {
      cache.delete(port);
    }
  }

  if (pending.has(port)) {
    return pending.get(port);
  }

  const promise = _doLaunch(port);
  pending.set(port, promise);
  try {
    return await promise;
  } finally {
    pending.delete(port);
  }
}

async function _doLaunch(port) {
  const systemName = SYSTEM_NAMES[port] || `system-${port}`;
  const userDataDir = path.join(profileRoot(), systemName);
  const debugPort = CDP_DEBUG_PORTS[port] || 19000 + port;

  const context = await chromium.launchPersistentContext(userDataDir, {
    headless: false,
    args: [
      '--disable-blink-features=AutomationControlled',
      '--no-first-run',
      '--no-default-browser-check',
      `--remote-debugging-port=${debugPort}`,
    ],
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    viewport: null,
    ignoreDefaultArgs: ['--enable-automation'],
    acceptDownloads: true,
  });

  const browser = context.browser();
  const entry = { browser, context };
  cache.set(port, entry);

  context.on('close', () => cache.delete(port));

  return entry;
}

/**
 * fork된 프로세스에서 이미 열린 브라우저에 CDP로 연결.
 * launchLocal()이 메인 프로세스에서 먼저 실행되어 있어야 함.
 *
 * @param {number} port — 시스템 식별용 논리 포트 (9444/9445/9446)
 * @returns {Promise<{ browser: import('playwright').Browser, context: import('playwright').BrowserContext }>}
 */
async function connectLocal(port = 9444) {
  const debugPort = CDP_DEBUG_PORTS[port] || 19000 + port;
  const url = `http://127.0.0.1:${debugPort}`;

  // 메인 프로세스에서 브라우저가 준비될 때까지 재시도 (최대 30초)
  let lastErr;
  for (let attempt = 0; attempt < 15; attempt++) {
    try {
      const browser = await chromium.connectOverCDP(url, { timeout: 5000 });
      const context = browser.contexts()[0];
      if (!context) {
        await browser.close().catch(() => {});
        throw new Error(`브라우저 context를 찾을 수 없습니다 (port ${port}). 먼저 UI에서 브라우저를 열어주세요.`);
      }
      return { browser, context };
    } catch (err) {
      lastErr = err;
      if (err.message.includes('context를 찾을 수 없습니다')) throw err;
      await new Promise(r => setTimeout(r, 2000));
    }
  }
  throw new Error(`브라우저 연결 실패 (port ${port}): ${lastErr?.message}. 먼저 UI에서 브라우저를 열어주세요.`);
}

/**
 * 특정 시스템의 브라우저 상태 확인
 */
function getStatus(port) {
  return cache.has(port) ? 'open' : 'closed';
}

/**
 * 모든 시스템의 브라우저 상태
 */
function getAllStatus() {
  const result = {};
  for (const port of Object.keys(SYSTEM_NAMES)) {
    result[port] = getStatus(Number(port));
  }
  return result;
}

/**
 * 특정 시스템 브라우저 닫기
 */
async function close(port) {
  const entry = cache.get(port);
  if (!entry) return;
  try {
    await entry.context.close();
  } catch (err) {
    console.error(`[browser-provider] close(${port}) error:`, err.message);
  }
  cache.delete(port);
}

/**
 * 모든 브라우저 종료 (앱 종료 시 호출)
 */
async function closeAll() {
  const promises = [];
  for (const [port] of cache) {
    promises.push(close(port));
  }
  await Promise.all(promises);
}

module.exports = {
  launchLocal,
  connectLocal,
  getStatus,
  getAllStatus,
  close,
  closeAll,
  SYSTEM_NAMES,
  CDP_DEBUG_PORTS,
};
