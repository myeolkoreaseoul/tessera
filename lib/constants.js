/**
 * 공통 상수 정의
 */

const CDP_HOST = process.env.TESSERA_CDP_HOST || process.env.CDP_HOST || '100.87.3.123';
const CDP_PORT_ENARADOMUM = parseInt(process.env.TESSERA_CDP_PORT_ENARADOMUM || '9444');
const CDP_PORT_BOTAME = parseInt(process.env.TESSERA_CDP_PORT_BOTAME || '9445');
const CDP_PORT_EZBARO = parseInt(process.env.TESSERA_CDP_PORT_EZBARO || '9446');
const CDP_CONNECT_TIMEOUT_MS = parseInt(process.env.CDP_CONNECT_TIMEOUT_MS || '120000');

const SESSION_EXTEND_INTERVAL_MS = 4 * 60 * 1000;
const GRID_LOAD_TIMEOUT_MS = 15000;
const DOWNLOAD_WAIT_MAX_SECONDS = 30;
const DOWNLOAD_WAIT_POLL_MS = 1000;
const MODAL_WAIT_TIMEOUT_MS = 10000;
const DETAIL_LOAD_TIMEOUT_MS = 15000;

const REMOTE_DL_WIN = 'C:\\projects\\e-naradomum-rpa\\downloads';

const path = require('path');
const os = require('os');
// Electron 패키징 시 Program Files는 읽기 전용 → 사용자 홈 디렉토리 사용
const LOCAL_DL_DIR = process.env.TESSERA_MODE === 'electron'
  ? path.join(os.homedir(), '.tessera', 'downloads')
  : path.resolve(__dirname, '..', 'downloads');

const SUPPORTED_FILE_EXTENSIONS = ['.pdf', '.xlsx', '.xls', '.hwp', '.jpg', '.jpeg', '.png'];

const MAX_FILE_TEXT_LENGTH = 12000;

module.exports = {
  CDP_HOST,
  CDP_PORT_ENARADOMUM,
  CDP_PORT_BOTAME,
  CDP_PORT_EZBARO,
  CDP_CONNECT_TIMEOUT_MS,
  SESSION_EXTEND_INTERVAL_MS,
  GRID_LOAD_TIMEOUT_MS,
  DOWNLOAD_WAIT_MAX_SECONDS,
  DOWNLOAD_WAIT_POLL_MS,
  MODAL_WAIT_TIMEOUT_MS,
  DETAIL_LOAD_TIMEOUT_MS,
  REMOTE_DL_WIN,
  LOCAL_DL_DIR,
  SUPPORTED_FILE_EXTENSIONS,
  MAX_FILE_TEXT_LENGTH,
};
