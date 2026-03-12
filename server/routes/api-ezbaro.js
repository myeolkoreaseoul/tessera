/**
 * REST API: 이지바로 전용
 *
 * POST /api/ezbaro/upload        — 과제리스트 엑셀 업로드 + 파싱 (파일 저장)
 * GET  /api/ezbaro/tasks         — 업로드된 기관 목록 (담당자 필터)
 * GET  /api/ezbaro/tasks/:seq    — 기관 상세
 * POST /api/ezbaro/batch-start   — 배치 실행 시작
 * POST /api/ezbaro/batch-stop    — 배치 실행 중단
 * GET  /api/ezbaro/batch-status  — 배치 진행 상태
 */

const { Router } = require('express');
const multer = require('multer');
const XLSX = require('xlsx');
const path = require('path');
const fs = require('fs');

const upload = multer({
  dest: path.join(__dirname, '..', '..', 'uploads'),
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB
  fileFilter(req, file, cb) {
    if (/\.(xlsx|xlsb|xls)$/i.test(file.originalname)) {
      cb(null, true);
    } else {
      cb(new Error('엑셀 파일만 업로드 가능합니다'));
    }
  },
});

// 파싱 데이터 저장 경로
const BATCH_DATA_PATH = path.join(__dirname, '..', '..', 'projects', 'ezbaro-batch.json');

// 메모리 캐시 + 파일 영속성
let parsedData = null;
let uploadedFileName = null;

// 서버 시작 시 기존 파일에서 복원
function loadSavedData() {
  try {
    if (fs.existsSync(BATCH_DATA_PATH)) {
      const saved = JSON.parse(fs.readFileSync(BATCH_DATA_PATH, 'utf8'));
      parsedData = saved.tasks;
      uploadedFileName = saved.fileName;
      console.log(`[ezbaro] 저장된 데이터 복원: ${uploadedFileName} (${parsedData.length}건)`);
    }
  } catch (err) {
    console.error('[ezbaro] 저장 데이터 복원 실패:', err.message);
  }
}

function saveData() {
  try {
    const dir = path.dirname(BATCH_DATA_PATH);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(BATCH_DATA_PATH, JSON.stringify({
      fileName: uploadedFileName,
      tasks: parsedData,
      savedAt: new Date().toISOString(),
    }, null, 2));
  } catch (err) {
    console.error('[ezbaro] 데이터 저장 실패:', err.message);
  }
}

// 즉시 복원
loadSavedData();

// 상시 시트 컬럼 인덱스 (0-based)
const COL = {
  순번: 0,
  전문기관: 1,
  사업년도: 2,
  과제번호: 3,
  과제명: 4,
  단계: 5,
  연차: 6,
  과제상태: 7,
  연구수행기관: 16,
  기관고유번호: 18,
  총예산: 20,
  집행금액: 21,
  집행잔액: 22,
  기관형태: 23,
  정산진행상태: 24,
  집행건수: 25,
  미확정: 26,
  보완완료: 27,
  보완요청: 28,
  이행률: 29,
  회계사: 30,
  담당자: 31,
  점검날짜: 32,
  특이사항: 33,
};

function parseRow(row) {
  if (!row || row.length === 0) return null;
  const getVal = (idx) => (row[idx] === undefined || row[idx] === null ? '' : row[idx]).toString().trim();
  const getNum = (idx) => Number(row[idx]) || 0;

  return {
    순번: row[COL.순번],
    전문기관: getVal(COL.전문기관),
    사업년도: row[COL.사업년도],
    과제번호: getVal(COL.과제번호),
    과제명: getVal(COL.과제명).replace(/\r?\n/g, ' '),
    연구수행기관: getVal(COL.연구수행기관),
    기관고유번호: getVal(COL.기관고유번호),
    기관형태: getVal(COL.기관형태),
    정산진행상태: getVal(COL.정산진행상태),
    집행건수: getNum(COL.집행건수),
    미확정: getNum(COL.미확정),
    보완완료: getNum(COL.보완완료),
    보완요청: getNum(COL.보완요청),
    이행률: getVal(COL.이행률) || null,
    총예산: getNum(COL.총예산),
    집행금액: getNum(COL.집행금액),
    회계사: getVal(COL.회계사),
    담당자: getVal(COL.담당자),
    점검날짜: getVal(COL.점검날짜) || null,
    특이사항: getVal(COL.특이사항),
  };
}

/**
 * 필터 및 정렬 로직 (일관성 유지)
 */
function getFilteredTasks(data, { 담당자, status, sort }) {
  let filtered = data;

  if (담당자) {
    filtered = filtered.filter(r => r.담당자 === 담당자);
  }
  if (status) {
    filtered = filtered.filter(r => r.정산진행상태 === status);
  }

  // 정렬: 미확정 많은 순(기본) / 보완완료 많은 순
  if (sort === 'supplement') {
    filtered = [...filtered].sort((a, b) => b.보완완료 - a.보완완료 || b.미확정 - a.미확정);
  } else {
    // 기본: 미확정 많은 순
    filtered = [...filtered].sort((a, b) => b.미확정 - a.미확정 || b.집행건수 - a.집행건수);
  }

  // 작업 순번 부여 (1부터)
  return filtered.map((task, i) => ({ ...task, 작업순번: i + 1 }));
}

function createEzbaroRoutes(robotManager, batchRunner) {
  const router = Router();

  // 엑셀 업로드
  router.post('/upload', upload.single('file'), (req, res) => {
    if (!req.file) {
      return res.status(400).json({ error: '파일이 없습니다' });
    }

    try {
      const wb = XLSX.readFile(req.file.path);
      const ws = wb.Sheets['상시'];
      if (!ws) {
        return res.status(400).json({ error: "'상시' 시트를 찾을 수 없습니다" });
      }

      const raw = XLSX.utils.sheet_to_json(ws, { header: 1 });
      const rows = [];
      for (let i = 1; i < raw.length; i++) {
        if (!raw[i][0]) continue; // 빈 행 스킵
        const parsed = parseRow(raw[i]);
        if (parsed) rows.push(parsed);
      }

      parsedData = rows;
      uploadedFileName = req.file.originalname;

      // 파일 저장 (재시작 후에도 유지)
      saveData();

      // 담당자 목록 추출
      const 담당자Map = {};
      for (const r of rows) {
        if (!담당자Map[r.담당자]) 담당자Map[r.담당자] = 0;
        담당자Map[r.담당자]++;
      }
      const 담당자목록 = Object.entries(담당자Map)
        .filter(([name]) => name.trim())
        .map(([name, count]) => ({ name, count }))
        .sort((a, b) => b.count - a.count);

      // 상태별 요약
      const 상태Map = {};
      for (const r of rows) {
        상태Map[r.정산진행상태] = (상태Map[r.정산진행상태] || 0) + 1;
      }

      res.json({
        fileName: uploadedFileName,
        totalRows: rows.length,
        담당자목록,
        상태요약: 상태Map,
      });
    } catch (err) {
      console.error('[ezbaro] 업로드 파싱 에러:', err);
      res.status(500).json({ error: '엑셀 파싱 실패: ' + err.message });
    } finally {
      // 업로드 임시파일 삭제
      try { fs.unlinkSync(req.file.path); } catch {}
    }
  });

  // 기관 목록 (담당자 필터)
  router.get('/tasks', (req, res) => {
    if (!parsedData) {
      return res.status(404).json({ error: '엑셀이 업로드되지 않았습니다' });
    }

    const { 담당자, status, sort } = req.query;
    const filtered = getFilteredTasks(parsedData, { 담당자, status, sort });

    // 요약 통계
    const summary = {
      total: filtered.length,
      점검완료: filtered.filter(r => r.정산진행상태 === '점검완료').length,
      보완요청: filtered.filter(r => r.정산진행상태 === '보완요청').length,
      보완완료: filtered.filter(r => r.정산진행상태 === '보완완료').length,
      점검중: filtered.filter(r => r.정산진행상태 === '점검중').length,
      점검전: filtered.filter(r => r.정산진행상태 === '점검전').length,
      미완료: filtered.filter(r => r.정산진행상태 !== '점검완료').length,
      총집행건수: filtered.reduce((s, r) => s + r.집행건수, 0),
      총미확정: filtered.reduce((s, r) => s + r.미확정, 0),
    };

    res.json({
      fileName: uploadedFileName,
      summary,
      tasks: filtered,
    });
  });

  // 기관 상세 (순번으로 조회)
  router.get('/tasks/:seq', (req, res) => {
    if (!parsedData) {
      return res.status(404).json({ error: '엑셀이 업로드되지 않았습니다' });
    }
    const seq = Number(req.params.seq);
    const task = parsedData.find(r => r.순번 === seq);
    if (!task) {
      return res.status(404).json({ error: '해당 기관을 찾을 수 없습니다' });
    }
    res.json(task);
  });

  // 배치 시작
  router.post('/batch-start', (req, res) => {
    if (!parsedData) {
      return res.status(404).json({ error: '엑셀이 업로드되지 않았습니다' });
    }

    const { 담당자, status, sort, project, host, staff } = req.body || {};

    // 동일한 필터/정렬 기준 적용
    const targets = getFilteredTasks(parsedData, { 담당자, status, sort });

    if (targets.length === 0) {
      return res.status(400).json({ error: '필터 조건에 맞는 과제가 없습니다' });
    }

    try {
      batchRunner.startBatch(robotManager, targets, {
        project: project || 'ezbaro', // 기본값 부여
        host,
        staff,
        port: 9446,
      });
      res.json({
        ok: true,
        message: `배치 시작: ${targets.length}개 과제`,
        total: targets.length,
      });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  // 배치 중단
  router.post('/batch-stop', (req, res) => {
    batchRunner.stopBatch();
    res.json({ ok: true, message: '배치 중단됨' });
  });

  // 배치 상태
  router.get('/batch-status', (req, res) => {
    res.json(batchRunner.getStatus());
  });

  return router;
}

module.exports = { createEzbaroRoutes };
