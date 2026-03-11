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
});
