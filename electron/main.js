/**
 * Tessera Desktop — Electron 메인 프로세스
 *
 * 1. TESSERA_MODE=electron 환경변수 설정
 * 2. Express 서버 in-process 실행 (port 3500)
 * 3. BrowserWindow에서 UI 로드
 * 4. 종료 시 Playwright 브라우저 + HTTP 서버 정리
 */

const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');

// Electron 모드 설정 (다른 모듈이 require되기 전에)
process.env.TESSERA_MODE = 'electron';

const PORT = parseInt(process.env.PORT) || 3500;
const ALLOWED_PORTS = [9444, 9445, 9446];

let mainWindow = null;
let serverModule = null;

app.whenReady().then(async () => {
  // Express 서버 시작 (require하면 자동으로 listen 실행)
  try {
    serverModule = require('../server/index.js');
  } catch (err) {
    dialog.showErrorBox(
      'Tessera 서버 오류',
      `서버를 시작할 수 없습니다.\n\n${err.message}`
    );
    app.quit();
    return;
  }

  // 서버가 실제로 listen할 때까지 대기 (포트 충돌 감지 포함)
  try {
    await new Promise((resolve, reject) => {
      const { server } = serverModule;
      if (server.listening) return resolve();
      server.once('listening', resolve);
      server.once('error', (err) => {
        dialog.showErrorBox(
          'Tessera 서버 오류',
          `포트 ${PORT}이 이미 사용 중입니다.\n\n${err.message}`
        );
        reject(err);
      });
    });
  } catch {
    app.quit();
    return;
  }

  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1000,
    minHeight: 700,
    title: 'Tessera — 통합 정산검토',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  // 외부 페이지 탐색 차단 (preload API 보안)
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith(`http://localhost:${PORT}`)) {
      event.preventDefault();
    }
  });
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));

  mainWindow.loadURL(`http://localhost:${PORT}`);

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
});

/** port allowlist 검증 */
function validatePort(port) {
  if (!ALLOWED_PORTS.includes(Number(port))) {
    throw new Error(`허용되지 않은 포트: ${port}. 허용: ${ALLOWED_PORTS.join(', ')}`);
  }
  return Number(port);
}

// IPC 핸들러: 브라우저 열기
ipcMain.handle('browser:launch', async (_event, port) => {
  try {
    const validPort = validatePort(port);
    const browserProvider = require('../lib/browser-provider');
    await browserProvider.launchLocal(validPort);
    return { ok: true, port: validPort };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

// IPC 핸들러: 브라우저 상태 조회
ipcMain.handle('browser:status', async () => {
  try {
    const browserProvider = require('../lib/browser-provider');
    return { ok: true, status: browserProvider.getAllStatus() };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

// IPC 핸들러: 브라우저 닫기
ipcMain.handle('browser:close', async (_event, port) => {
  try {
    const validPort = validatePort(port);
    const browserProvider = require('../lib/browser-provider');
    await browserProvider.close(validPort);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

// 앱 종료 시 정리 (브라우저 + HTTP 서버)
app.on('before-quit', async () => {
  try {
    const browserProvider = require('../lib/browser-provider');
    await browserProvider.closeAll();
  } catch { /* 종료 중 에러 무시 */ }

  try {
    if (serverModule && serverModule.server) {
      serverModule.server.close();
    }
  } catch { /* 종료 중 에러 무시 */ }
});

// 모든 윈도우 닫히면 앱 종료 (macOS 제외)
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
