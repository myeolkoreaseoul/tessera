/**
 * electron-builder 빌드 전 Playwright Chromium을 extraResources 위치로 복사
 *
 * 사용: npm run electron:prebuild
 * Windows에서 실행해야 Windows용 Chromium이 복사됨
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// Windows 빌드 타겟이므로 Windows에서 실행해야 올바른 Chromium이 복사됨
if (process.platform !== 'win32') {
  console.warn('[copy-chromium] 경고: Windows가 아닌 환경에서 실행 중입니다.');
  console.warn('  Windows용 .exe를 빌드하려면 Windows에서 이 스크립트를 실행하세요.');
  console.warn('  현재 플랫폼의 Chromium이 복사됩니다.');
}

const TARGET_DIR = path.join(__dirname, '..', 'playwright-chromium');

// Playwright Chromium 실행 파일 경로 찾기
let execPath;
try {
  execPath = execSync('node -e "console.log(require(\'playwright\').chromium.executablePath())"', {
    encoding: 'utf-8',
    cwd: path.join(__dirname, '..'),
  }).trim();
} catch (err) {
  console.error('[copy-chromium] Playwright Chromium을 찾을 수 없습니다.');
  console.error('  npx playwright install chromium 을 먼저 실행하세요.');
  process.exit(1);
}

console.log(`[copy-chromium] Chromium 경로: ${execPath}`);

// 실행 파일에서 chromium-XXXX 디렉토리 찾기
// 예: .../ms-playwright/chromium-1208/chrome-win64/chrome.exe
const parts = execPath.split(path.sep);
const chromiumIdx = parts.findIndex(p => /^chromium-\d+$/.test(p));
if (chromiumIdx === -1) {
  console.error('[copy-chromium] chromium-XXXX 디렉토리를 경로에서 찾을 수 없습니다:', execPath);
  process.exit(1);
}

const chromiumDirName = parts[chromiumIdx]; // e.g. "chromium-1208"
const chromiumSrcDir = parts.slice(0, chromiumIdx + 1).join(path.sep);
const chromiumDstDir = path.join(TARGET_DIR, chromiumDirName);

// 이미 동일 버전이 복사되어 있으면 스킵
if (fs.existsSync(chromiumDstDir)) {
  console.log(`[copy-chromium] ${chromiumDirName} 이미 존재함, 스킵`);
  process.exit(0);
}

// 이전 버전 정리 후 복사
if (fs.existsSync(TARGET_DIR)) {
  fs.rmSync(TARGET_DIR, { recursive: true });
}
fs.mkdirSync(TARGET_DIR, { recursive: true });

console.log(`[copy-chromium] ${chromiumSrcDir} → ${chromiumDstDir}`);
fs.cpSync(chromiumSrcDir, chromiumDstDir, { recursive: true });

console.log('[copy-chromium] 완료');
