/**
 * REST API: 사업/결과 조회
 *
 * GET /api/projects           — 사업 설정 목록
 * GET /api/projects/:name     — 사업 설정 상세
 * GET /api/results/:dir       — 결과 파일 조회
 */

const { Router } = require('express');
const fs = require('fs');
const path = require('path');
const { listConfigs, configs } = require('../../lib/configs');

function createProjectRoutes() {
  const router = Router();
  const projectsDir = path.join(__dirname, '..', '..', 'projects');

  // 사업 설정 목록
  router.get('/', (req, res) => {
    const list = Object.entries(configs).map(([name, cfg]) => ({
      name,
      system: cfg.system,
      legalBasis: cfg.legalBasis,
      agency: cfg.agency || null,
    }));
    res.json(list);
  });

  // 사업 설정 상세
  router.get('/:name', (req, res) => {
    const cfg = configs[req.params.name];
    if (!cfg) return res.status(404).json({ error: '사업을 찾을 수 없습니다' });
    // guidelinesPath, criteriaPath 제외 (로컬 경로 노출 방지)
    const { guidelinesPath, criteriaPath, ...rest } = cfg;
    res.json({ name: req.params.name, ...rest });
  });

  // 결과 파일 조회 (프로젝트 루트의 *-results.json)
  router.get('/results/:dir', (req, res) => {
    const dir = req.params.dir;
    // 경로 순회 방지
    if (dir.includes('..') || dir.includes('/')) {
      return res.status(400).json({ error: '잘못된 디렉토리명' });
    }

    const resultsFile = path.join(__dirname, '..', '..', `${dir}-results.json`);
    if (!fs.existsSync(resultsFile)) {
      return res.status(404).json({ error: '결과 파일을 찾을 수 없습니다' });
    }

    try {
      const data = JSON.parse(fs.readFileSync(resultsFile, 'utf-8'));
      res.json(data);
    } catch (err) {
      res.status(500).json({ error: '결과 파일 읽기 실패' });
    }
  });

  // 결과 파일 목록
  router.get('/results', (req, res) => {
    const root = path.join(__dirname, '..', '..');
    try {
      const files = fs.readdirSync(root)
        .filter(f => f.endsWith('-results.json'))
        .map(f => {
          const stat = fs.statSync(path.join(root, f));
          return {
            name: f.replace('-results.json', ''),
            file: f,
            size: stat.size,
            modified: stat.mtime,
          };
        })
        .sort((a, b) => new Date(b.modified) - new Date(a.modified));
      res.json(files);
    } catch (err) {
      res.status(500).json({ error: '결과 목록 조회 실패' });
    }
  });

  return router;
}

module.exports = { createProjectRoutes };
