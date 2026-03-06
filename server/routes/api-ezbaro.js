/**
 * REST API: 이지바로 전용
 *
 * POST /api/ezbaro/upload        — 과제리스트 엑셀 업로드 + 파싱
 * GET  /api/ezbaro/tasks         — 업로드된 기관 목록 (담당자 필터)
 * GET  /api/ezbaro/tasks/:seq    — 기관 상세
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
    if (/\.(xlsx|xlsb|xls|csv)$/i.test(file.originalname)) {
      cb(null, true);
    } else {
      cb(new Error('엑셀 파일만 업로드 가능합니다'));
    }
  },
});

// 메모리에 파싱된 데이터 보관 (서버 재시작 시 초기화)
let parsedData = null;
let uploadedFileName = null;

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
  return {
    순번: row[COL.순번],
    전문기관: (row[COL.전문기관] || '').toString().trim(),
    사업년도: row[COL.사업년도],
    과제번호: (row[COL.과제번호] || '').toString().trim(),
    과제명: (row[COL.과제명] || '').toString().trim().replace(/\r?\n/g, ' '),
    연구수행기관: (row[COL.연구수행기관] || '').toString().trim(),
    기관고유번호: (row[COL.기관고유번호] || '').toString().trim(),
    기관형태: (row[COL.기관형태] || '').toString().trim(),
    정산진행상태: (row[COL.정산진행상태] || '').toString().trim(),
    집행건수: Number(row[COL.집행건수]) || 0,
    미확정: Number(row[COL.미확정]) || 0,
    보완완료: Number(row[COL.보완완료]) || 0,
    보완요청: Number(row[COL.보완요청]) || 0,
    이행률: row[COL.이행률],
    총예산: Number(row[COL.총예산]) || 0,
    집행금액: Number(row[COL.집행금액]) || 0,
    회계사: (row[COL.회계사] || '').toString().trim(),
    담당자: (row[COL.담당자] || '').toString().trim(),
    점검날짜: row[COL.점검날짜] || null,
    특이사항: (row[COL.특이사항] || '').toString().trim(),
  };
}

function createEzbaroRoutes() {
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
        rows.push(parseRow(raw[i]));
      }

      parsedData = rows;
      uploadedFileName = req.file.originalname;

      // 담당자 목록 추출
      const 담당자Map = {};
      for (const r of rows) {
        if (!담당자Map[r.담당자]) 담당자Map[r.담당자] = 0;
        담당자Map[r.담당자]++;
      }
      const 담당자목록 = Object.entries(담당자Map)
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
    let filtered = parsedData;

    if (담당자) {
      filtered = filtered.filter(r => r.담당자 === 담당자);
    }
    if (status) {
      filtered = filtered.filter(r => r.정산진행상태 === status);
    }

    // 기본 정렬: 순번
    if (sort === 'unchecked') {
      filtered = [...filtered].sort((a, b) => b.미확정 - a.미확정);
    } else {
      filtered = [...filtered].sort((a, b) => a.순번 - b.순번);
    }

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

  return router;
}

module.exports = { createEzbaroRoutes };
