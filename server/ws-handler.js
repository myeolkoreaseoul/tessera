/**
 * WebSocket 실시간 브로드캐스트 핸들러
 */

const WebSocket = require('ws');

function setupWebSocket(server, robotManager) {
  const wss = new WebSocket.Server({ server });

  const clients = new Set();

  wss.on('connection', (ws) => {
    clients.add(ws);
    console.log(`[WS] 클라이언트 연결 (총 ${clients.size}명)`);

    // 연결 즉시 현재 로봇 상태 전송
    ws.send(JSON.stringify({
      type: 'initial-state',
      robots: robotManager.list(),
      timestamp: Date.now(),
    }));

    ws.on('close', () => {
      clients.delete(ws);
      console.log(`[WS] 클라이언트 연결 해제 (총 ${clients.size}명)`);
    });

    ws.on('error', (err) => {
      console.error('[WS] 에러:', err.message);
      clients.delete(ws);
    });
  });

  // 로봇 메시지 → 전체 클라이언트 브로드캐스트
  robotManager.on('robot-message', (robotId, msg) => {
    const payload = JSON.stringify({
      robotId,
      ...msg,
    });

    for (const client of clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(payload);
      }
    }
  });

  return wss;
}

module.exports = { setupWebSocket };
