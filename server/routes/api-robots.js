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

  // 로봇 시작
  router.post('/start', (req, res) => {
    try {
      const { system, project, institution, options } = req.body;

      if (!system) {
        return res.status(400).json({ error: 'system은 필수입니다' });
      }
      if (!institution) {
        return res.status(400).json({ error: 'institution은 필수입니다' });
      }

      const robotId = robotManager.start({ system, project, institution, options });
      res.json({ ok: true, robotId });
    } catch (err) {
      res.status(409).json({ error: err.message });
    }
  });

  // 로봇 중지
  router.post('/:id/stop', (req, res) => {
    try {
      robotManager.stop(req.params.id);
      res.json({ ok: true });
    } catch (err) {
      res.status(404).json({ error: err.message });
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
