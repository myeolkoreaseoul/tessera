/**
 * 로봇 프로세스 관리자
 *
 * child_process.fork로 run-pipeline.js 실행
 * IPC로 진행 보고 수신 → EventEmitter로 브로드캐스트
 */

const { fork } = require('child_process');
const path = require('path');
const EventEmitter = require('events');
const { v4: uuidv4 } = require('uuid');

const PIPELINE_SCRIPT = path.join(__dirname, '..', 'run-pipeline.js');

class RobotManager extends EventEmitter {
  constructor() {
    super();
    // robotId → { id, system, project, institution, status, process, startedAt, lastMessage, progress }
    this.robots = new Map();
  }

  /**
   * 로봇 시작
   * @returns {string} robotId
   */
  start({ system, project, institution, options = {} }) {
    // 같은 시스템에서 이미 실행 중인 로봇 확인
    for (const [id, robot] of this.robots) {
      if (robot.system === system && robot.status === 'running') {
        throw new Error(`${system} 로봇이 이미 실행 중입니다 (id: ${id})`);
      }
    }

    const robotId = uuidv4().slice(0, 8);

    // CLI 인자 구성
    const args = [`--system=${system}`];
    if (institution) args.push(`--inst=${institution}`);
    if (project) args.push(`--project=${project}`);
    if (options.kw) args.push(`--kw=${options.kw}`);
    if (options.dir) args.push(`--dir=${options.dir}`);
    if (options.year) args.push(`--year=${options.year}`);
    if (options.settlement) args.push(`--settlement=${options.settlement}`);
    if (options.start) args.push(`--start=${options.start}`);
    if (options.port) args.push(`--port=${options.port}`);
    if (options.dryRun) args.push('--dry-run');
    if (options.skipJudge) args.push('--skip-judge');
    if (options.staff) args.push(`--staff=${options.staff}`);
    if (options.task) args.push(`--task=${options.task}`);

    const child = fork(PIPELINE_SCRIPT, args, {
      cwd: path.join(__dirname, '..'),
      stdio: ['pipe', 'pipe', 'pipe', 'ipc'],
      env: { ...process.env },
    });

    const robot = {
      id: robotId,
      system,
      project: project || null,
      institution: institution || null,
      options,
      status: 'running',
      process: child,
      pid: child.pid,
      startedAt: Date.now(),
      lastMessage: null,
      progress: { current: 0, total: 0, phase: null },
      log: [],
    };

    this.robots.set(robotId, robot);

    // IPC 메시지 수신
    child.on('message', (msg) => {
      robot.lastMessage = msg;

      switch (msg.type) {
        case 'progress':
          robot.progress.current = msg.current;
          robot.progress.total = msg.total;
          break;
        case 'phase-change':
          robot.progress.phase = msg.label;
          break;
        case 'done':
          robot.status = 'completed';
          break;
        case 'error':
          if (!msg.recoverable) robot.status = 'error';
          break;
      }

      // 최근 100개 로그만 유지
      robot.log.push(msg);
      if (robot.log.length > 100) robot.log.shift();

      this.emit('robot-message', robotId, msg);
    });

    // stdout/stderr 캡처
    child.stdout.on('data', (data) => {
      const text = data.toString().trim();
      if (text) {
        const logMsg = { type: 'stdout', message: text, timestamp: Date.now() };
        robot.log.push(logMsg);
        if (robot.log.length > 100) robot.log.shift();
        this.emit('robot-message', robotId, logMsg);
      }
    });

    child.stderr.on('data', (data) => {
      const text = data.toString().trim();
      if (text) {
        const logMsg = { type: 'stderr', message: text, timestamp: Date.now() };
        robot.log.push(logMsg);
        if (robot.log.length > 100) robot.log.shift();
        this.emit('robot-message', robotId, logMsg);
      }
    });

    // 프로세스 종료
    child.on('exit', (code, signal) => {
      if (robot.status === 'running' || robot.status === 'stopping') {
        robot.status = code === 0 ? 'completed' : 'crashed';
      }
      robot.exitCode = code;
      robot.exitSignal = signal;
      robot.endedAt = Date.now();
      if (robot._killTimer) { clearTimeout(robot._killTimer); robot._killTimer = null; }

      this.emit('robot-message', robotId, {
        type: 'exit',
        code,
        signal,
        status: robot.status,
        timestamp: Date.now(),
      });

      // 1시간 후 완료된 로봇 레코드 정리 (메모리 누수 방지)
      setTimeout(() => {
        if (robot.status !== 'running' && robot.status !== 'stopping') {
          this.robots.delete(robotId);
        }
      }, 60 * 60 * 1000);
    });

    child.on('error', (err) => {
      robot.status = 'crashed';
      this.emit('robot-message', robotId, {
        type: 'error',
        message: err.message,
        timestamp: Date.now(),
      });
    });

    return robotId;
  }

  /**
   * 로봇 중지 (SIGTERM → 현재 건 완료 후 종료)
   */
  stop(robotId) {
    const robot = this.robots.get(robotId);
    if (!robot) throw new Error(`로봇을 찾을 수 없습니다: ${robotId}`);
    if (robot.status !== 'running') throw new Error(`로봇이 실행 중이 아닙니다 (상태: ${robot.status})`);

    robot.status = 'stopping';
    robot.process.kill('SIGTERM');

    // 30초 후에도 종료 안 되면 SIGKILL
    robot._killTimer = setTimeout(() => {
      if (robot.status === 'stopping') {
        try { robot.process.kill('SIGKILL'); } catch {}
        robot.status = 'killed';
      }
    }, 30000);

    return true;
  }

  /**
   * 전체 로봇 목록
   */
  list() {
    return Array.from(this.robots.values()).map(r => ({
      id: r.id,
      system: r.system,
      project: r.project,
      institution: r.institution,
      status: r.status,
      pid: r.pid,
      startedAt: r.startedAt,
      endedAt: r.endedAt || null,
      progress: r.progress,
      lastMessage: r.lastMessage,
    }));
  }

  /**
   * 특정 로봇 상세 (로그 포함)
   */
  get(robotId) {
    const robot = this.robots.get(robotId);
    if (!robot) return null;
    return {
      id: robot.id,
      system: robot.system,
      project: robot.project,
      institution: robot.institution,
      status: robot.status,
      pid: robot.pid,
      startedAt: robot.startedAt,
      endedAt: robot.endedAt || null,
      progress: robot.progress,
      log: robot.log,
    };
  }
}

module.exports = { RobotManager };
