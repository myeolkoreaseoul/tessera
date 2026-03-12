/**
 * REST API: 브라우저 제어 (Electron 모드 전용)
 *
 * POST /api/browser/launch  — 시스템별 Chromium 열기
 * POST /api/browser/close   — 시스템별 Chromium 닫기
 * GET  /api/browser/status   — 전체 브라우저 상태
 */

const { Router } = require('express');

const VALID_PORTS = [9444, 9445, 9446];

/** 시스템별 초기 URL — 브라우저 열릴 때 자동 이동 */
const START_URLS = {
  9444: 'https://www.e-narahelp.kr/',
  9445: 'https://www.losims.go.kr/',
  9446: 'https://www.gaia.go.kr/main.do',
};

/** localhost 전용 미들웨어 (브라우저 제어는 로컬에서만 허용) */
function localhostOnly(req, res, next) {
  const ip = req.ip || req.connection.remoteAddress;
  if (ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1') {
    return next();
  }
  res.status(403).json({ error: '브라우저 제어는 로컬에서만 가능합니다' });
}

/** port 검증 미들웨어 */
function validatePort(req, res, next) {
  if (!req.body || typeof req.body !== 'object') {
    return res.status(400).json({ error: '잘못된 요청 형식입니다' });
  }
  const port = Number(req.body.port);
  if (!Number.isInteger(port) || !VALID_PORTS.includes(port)) {
    return res.status(400).json({ error: `허용되지 않은 포트입니다. 허용: ${VALID_PORTS.join(', ')}` });
  }
  req.validPort = port;
  next();
}

function createBrowserRoutes() {
  const router = Router();

  // Electron 모드 체크 + localhost 제한
  router.use((req, res, next) => {
    if (process.env.TESSERA_MODE !== 'electron' && req.method !== 'GET') {
      return res.status(400).json({ error: 'Electron 모드에서만 사용 가능합니다' });
    }
    next();
  });
  router.use(localhostOnly);

  router.post('/launch', validatePort, async (req, res) => {
    try {
      const browserProvider = require('../../lib/browser-provider');
      const { context } = await browserProvider.launchLocal(req.validPort);

      // 초기 URL로 자동 이동
      const startUrl = START_URLS[req.validPort];
      if (startUrl) {
        try {
          const pages = context.pages();
          const page = pages[0] || await context.newPage();
          const currentUrl = page.url();
          if (currentUrl === 'about:blank' || currentUrl === '') {
            await page.goto(startUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });
          }
        } catch (navErr) {
          console.error(`[api-browser] navigate(${startUrl}) error:`, navErr.message);
        }
      }

      res.json({ ok: true, port: req.validPort });
    } catch (err) {
      console.error(`[api-browser] launch(${req.validPort}) error:`, err.message);
      res.status(500).json({ error: '브라우저 실행에 실패했습니다' });
    }
  });

  router.post('/close', validatePort, async (req, res) => {
    try {
      const browserProvider = require('../../lib/browser-provider');
      await browserProvider.close(req.validPort);
      res.json({ ok: true });
    } catch (err) {
      console.error(`[api-browser] close(${req.validPort}) error:`, err.message);
      res.status(500).json({ error: '브라우저 종료에 실패했습니다' });
    }
  });

  router.get('/status', (req, res) => {
    if (process.env.TESSERA_MODE !== 'electron') {
      return res.json({ mode: 'cdp', status: {} });
    }
    try {
      const browserProvider = require('../../lib/browser-provider');
      res.json({ mode: 'electron', status: browserProvider.getAllStatus() });
    } catch (err) {
      console.error('[api-browser] status error:', err.message);
      res.status(500).json({ error: '상태 조회에 실패했습니다' });
    }
  });

  return router;
}

module.exports = { createBrowserRoutes };
