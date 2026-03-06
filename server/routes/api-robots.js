/**
 * REST API: 로봇 제어
 *
 * POST /api/robots/start     — 로봇 시작
 * POST /api/robots/:id/stop  — 로봇 중지
 * GET  /api/robots            — 전체 목록
 * GET  /api/robots/:id        — 상세 (로그 포함)
 */

const { Router } = require('express');

function createRobotRoutes(robotManager) {
  const router = Router();

  const VALID_SYSTEMS = ['enaradomum', 'ezbaro', 'botame', 'rcms'];

  // 로봇 시작
  router.post('/start', (req, res) => {
    try {
      const { system, project, institution, options } = req.body;

      if (!system) {
        return res.status(400).json({ error: 'system은 필수입니다' });
      }
      if (!VALID_SYSTEMS.includes(system)) {
        return res.status(400).json({ error: `잘못된 system: ${system}. 허용: ${VALID_SYSTEMS.join(', ')}` });
      }
      if (!institution || typeof institution !== 'string') {
        return res.status(400).json({ error: 'institution은 필수입니다 (문자열)' });
      }

      const robotId = robotManager.start({ system, project, institution, options });
      res.json({ ok: true, robotId });
    } catch (err) {
      const status = err.message.includes('이미 실행 중') ? 409 : 500;
      res.status(status).json({ error: err.message });
    }
  });

  // 로봇 중지
  router.post('/:id/stop', (req, res) => {
    try {
      robotManager.stop(req.params.id);
      res.json({ ok: true });
    } catch (err) {
      const status = err.message.includes('찾을 수 없습니다') ? 404
        : err.message.includes('실행 중이 아닙니다') ? 409
        : 500;
      res.status(status).json({ error: err.message });
    }
  });

  // 전체 목록
  router.get('/', (req, res) => {
    res.json(robotManager.list());
  });

  // 상세 (로그 포함)
  router.get('/:id', (req, res) => {
    const robot = robotManager.get(req.params.id);
    if (!robot) return res.status(404).json({ error: '로봇을 찾을 수 없습니다' });
    res.json(robot);
  });

  return router;
}

module.exports = { createRobotRoutes };
