/**
 * tessera 지휘관 서버
 *
 * Express REST API + WebSocket 실시간 브로드캐스트
 * 포트: 3500 (기본)
 *
 * 사용법:
 *   node server/index.js
 *   PORT=3500 node server/index.js
 */

const http = require('http');
const path = require('path');
const express = require('express');
const cors = require('cors');
const { RobotManager } = require('./robot-manager');
const { BatchRunner } = require('./batch-runner');
const { setupWebSocket } = require('./ws-handler');
const { createRobotRoutes } = require('./routes/api-robots');
const { createProjectRoutes } = require('./routes/api-projects');
const { createEzbaroRoutes } = require('./routes/api-ezbaro');
const { createBrowserRoutes } = require('./routes/api-browser');

const PORT = parseInt(process.env.PORT) || 3500;

const app = express();
const server = http.createServer(app);

// 미들웨어
app.use(cors());
app.use(express.json());

// 로봇 매니저 + 배치 러너
const robotManager = new RobotManager();
const batchRunner = new BatchRunner();

// WebSocket 설정
setupWebSocket(server, robotManager);

// REST API
app.use('/api/robots', createRobotRoutes(robotManager));
app.use('/api/projects', createProjectRoutes());
app.use('/api/ezbaro', createEzbaroRoutes(robotManager, batchRunner));
app.use('/api/browser', createBrowserRoutes());

// 헬스체크
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    uptime: process.uptime(),
    robots: robotManager.list().length,
    running: robotManager.list().filter(r => r.status === 'running').length,
  });
});

// 정적 파일 서빙 (Next.js 빌드 결과)
const webOut = path.join(__dirname, '..', 'web', 'out');
app.use(express.static(webOut));

// 시스템 정보
app.get('/api/systems', (req, res) => {
  res.json([
    { id: 'enaradomum', name: 'e나라도움', port: 9444, status: 'ready' },
    { id: 'ezbaro', name: '이지바로', port: 9446, status: 'ready' },
    { id: 'botame', name: '보탬e', port: 9445, status: 'planned' },
    { id: 'rcms', name: 'RCMS', port: null, status: 'planned' },
  ]);
});

// SPA fallback (API가 아닌 모든 경로 → index.html)
app.use((req, res, next) => {
  if (req.path.startsWith('/api/')) return next();
  const fs = require('fs');
  const filePath = path.join(webOut, req.path, 'index.html');
  if (fs.existsSync(filePath)) return res.sendFile(filePath);
  const rootIndex = path.join(webOut, 'index.html');
  if (fs.existsSync(rootIndex)) return res.sendFile(rootIndex);
  next();
});

const BIND_HOST = process.env.TESSERA_MODE === 'electron' ? '127.0.0.1' : '0.0.0.0';
server.listen(PORT, BIND_HOST, () => {
  console.log(`\n╔══════════════════════════════════════════╗`);
  console.log(`║  tessera 지휘관 서버                     ║`);
  console.log(`║  REST API: http://localhost:${PORT}        ║`);
  console.log(`║  WebSocket: ws://localhost:${PORT}          ║`);
  console.log(`╚══════════════════════════════════════════╝\n`);
});

module.exports = { server, app, robotManager };
