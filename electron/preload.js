/**
 * Tessera Desktop — Preload 스크립트
 * contextBridge로 안전하게 IPC 노출
 */

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('tessera', {
  /** 시스템별 Chromium 브라우저 열기 @param {number} port */
  launchBrowser: (port) => ipcRenderer.invoke('browser:launch', port),

  /** 모든 시스템 브라우저 상태 조회 */
  getBrowserStatus: () => ipcRenderer.invoke('browser:status'),

  /** 시스템별 브라우저 닫기 @param {number} port */
  closeBrowser: (port) => ipcRenderer.invoke('browser:close', port),

  /** 업데이트 확인 (트리거) */
  checkForUpdate: () => ipcRenderer.invoke('updater:check'),

  /** 업데이트 상태 조회 */
  getUpdateStatus: () => ipcRenderer.invoke('updater:status'),

  /** 업데이트 상태 변경 이벤트 수신 (실시간 push) */
  onUpdateState: (callback) => {
    const handler = (_event, state) => callback(state);
    ipcRenderer.on('updater:state', handler);
    // cleanup 함수 반환
    return () => ipcRenderer.removeListener('updater:state', handler);
  },

  /** 다운로드된 업데이트 설치 + 재시작 */
  installUpdate: () => ipcRenderer.invoke('updater:install'),
});
