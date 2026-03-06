const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const XLSX = require('xlsx');

const EXCEL_PATH = process.env.EXCEL_PATH || '/home/john/company-pc/cdrive/Users/정동회계법인/Documents/이지바로_과제리스트_이정승_20260218_v2.xlsx';
const EXCEL_SHEET = process.env.EXCEL_SHEET || '상시';
const ROOT = '/home/john/e-naradomum-rpa';
const WORKER = path.join(ROOT, 'scripts-ezbaro-auto-next-from-excel.js');
const STAMP = new Date().toISOString().replace(/[:.]/g, '-');
const OUT_DIR = path.join(ROOT, 'projects');
const OUT_JSON = path.join(OUT_DIR, `이지바로-v2-배치요약-${STAMP}.json`);
const OUT_XLSX = path.join(OUT_DIR, `이지바로-v2-배치요약-${STAMP}.xlsx`);
const PER_TARGET_TIMEOUT_MS = Number(process.env.PER_TARGET_TIMEOUT_MS || 1000 * 60 * 20);
const BETWEEN_TARGET_SLEEP_MS = Number(process.env.BETWEEN_TARGET_SLEEP_MS || 1500);

const N = (v) => Number(String(v || '').replace(/[^0-9-]/g, '')) || 0;
const cleanIe = (v) => String(v || '').replace(/\([^)]*\)/g, '').replace(/\s+/g, ' ').trim();

function loadTargets() {
  const wb = XLSX.readFile(EXCEL_PATH);
  const ws = wb.Sheets[EXCEL_SHEET] || wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(ws, { defval: '' });
  return rows
    .map((r, i) => ({
      row: i + 1,
      no: N(r['순번']),
      agency: String(r['전문기관'] || '').trim(),
      year: String(r['사업년도'] || '').trim(),
      taskNo: String(r['과제번호'] || '').trim(),
      ieNm: String(r['연구수행기관'] || '').trim(),
      ieCore: cleanIe(r['연구수행기관'] || ''),
      unconfirmedHint: N(r['미확정']),
    }))
    .filter((x) => x.taskNo && x.ieCore && x.unconfirmedHint > 0);
}

function runOne(target) {
  const env = {
    ...process.env,
    EXCEL_PATH,
    EXCEL_SHEET,
    TARGET_TASK: target.taskNo,
    TARGET_IE: target.ieCore,
  };

  const p = spawnSync('node', [WORKER], {
    cwd: ROOT,
    env,
    encoding: 'utf-8',
    maxBuffer: 1024 * 1024 * 20,
    timeout: PER_TARGET_TIMEOUT_MS,
  });

  const stdout = String(p.stdout || '').trim();
  const stderr = String(p.stderr || '').trim();

  let parsed = null;
  try {
    parsed = JSON.parse(stdout || '{}');
  } catch {
    parsed = { ok: false, parseError: true, raw: stdout.slice(-3000) };
  }

  if (p.error && p.error.code === 'ETIMEDOUT') {
    parsed = { ok: false, timeout: true, msg: `target timeout after ${PER_TARGET_TIMEOUT_MS}ms` };
  }

  return {
    exitCode: p.status,
    stdout: stdout.slice(0, 4000),
    stderr: stderr.slice(0, 4000),
    parsed,
  };
}

function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

(function main() {
  const targets = loadTargets();
  const summary = {
    startedAt: new Date().toISOString(),
    excel: EXCEL_PATH,
    sheet: EXCEL_SHEET,
    totalTargets: targets.length,
    done: 0,
    success: 0,
    skipped: 0,
    failed: 0,
    items: [],
  };

  for (const t of targets) {
    const started = new Date().toISOString();
    console.log(`[START ${summary.done + 1}/${summary.totalTargets}] ${t.taskNo} / ${t.ieNm}`);
    fs.writeFileSync(OUT_JSON, JSON.stringify({ ...summary, current: { started, row: t.row, taskNo: t.taskNo, ieNm: t.ieNm } }, null, 2), 'utf-8');
    const result = runOne(t);
    const ended = new Date().toISOString();

    let status = 'failed';
    if (result.parsed?.ok && result.parsed?.msg === '처리 가능한 미확정 대상 없음') status = 'skipped';
    else if (result.parsed?.ok) status = 'success';

    if (status === 'success') summary.success += 1;
    else if (status === 'skipped') summary.skipped += 1;
    else summary.failed += 1;

    summary.done += 1;
    const item = {
      row: t.row,
      no: t.no,
      taskNo: t.taskNo,
      ieNm: t.ieNm,
      unconfirmedHint: t.unconfirmedHint,
      started,
      ended,
      status,
      output: result.parsed,
      exitCode: result.exitCode,
      stderr: result.stderr,
    };
    summary.items.push(item);

    fs.writeFileSync(OUT_JSON, JSON.stringify(summary, null, 2), 'utf-8');
    console.log(`[${summary.done}/${summary.totalTargets}] ${t.taskNo} / ${t.ieNm} => ${status}`);
    if (BETWEEN_TARGET_SLEEP_MS > 0) sleep(BETWEEN_TARGET_SLEEP_MS);
  }

  summary.finishedAt = new Date().toISOString();
  fs.writeFileSync(OUT_JSON, JSON.stringify(summary, null, 2), 'utf-8');

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(summary.items.map((x) => ({
    row: x.row,
    순번: x.no,
    과제번호: x.taskNo,
    수행기관: x.ieNm,
    엑셀미확정: x.unconfirmedHint,
    상태: x.status,
    처리시작: x.started,
    처리종료: x.ended,
  }))), '배치결과');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet([{
    startedAt: summary.startedAt,
    finishedAt: summary.finishedAt,
    totalTargets: summary.totalTargets,
    done: summary.done,
    success: summary.success,
    skipped: summary.skipped,
    failed: summary.failed,
  }]), '요약');
  XLSX.writeFile(wb, OUT_XLSX);

  console.log(JSON.stringify({ ok: true, outJson: OUT_JSON, outXlsx: OUT_XLSX, totalTargets: summary.totalTargets, success: summary.success, skipped: summary.skipped, failed: summary.failed }, null, 2));
})();
