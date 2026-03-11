/**
 * 배치 러너 — 이지바로 과제 순차 자동 실행
 *
 * 엑셀에서 파싱된 과제 목록을 큐에 넣고,
 * robotManager.start() → exit 이벤트 → 다음 과제 자동 시작.
 *
 * 사용:
 *   batchRunner.startBatch(robotManager, tasks, options)
 *   batchRunner.stopBatch()
 *   batchRunner.getStatus()
 */

const EventEmitter = require('events');

class BatchRunner extends EventEmitter {
  constructor() {
    super();
    this.queue = [];        // { task, status: 'pending'|'running'|'done'|'error'|'skipped', error?, robotId? }
    this.running = false;
    this.stopping = false;  // stopBatch() 호출 후 로봇 종료 대기 중
    this.currentIdx = -1;
    this.robotManager = null;
    this.options = {};
    this._onRobotMessage = null;
  }

  /**
   * 배치 시작
   * @param {RobotManager} robotManager
   * @param {Array} tasks — parsedData에서 필터된 과제 배열
   * @param {object} options — { project, port, host, ... } robotManager.start()에 전달할 옵션
   * @returns {boolean} 첫 task 시작 성공 여부
   */
  startBatch(robotManager, tasks, options = {}) {
    if (this.running) {
      throw new Error('배치가 이미 실행 중입니다. 먼저 stopBatch()를 호출하세요.');
    }

    this.robotManager = robotManager;
    this.options = options;
    this.queue = tasks.map(t => ({
      task: t,
      status: 'pending',
      error: null,
      robotId: null,
    }));
    this.running = true;
    this.stopping = false;
    this.currentIdx = -1;

    // robotManager exit 이벤트 리스너
    this._onRobotMessage = (robotId, msg) => {
      if (msg.type !== 'exit') return;
      const current = this.queue[this.currentIdx];
      if (!current || current.robotId !== robotId) return;

      // stopBatch()로 중단된 경우
      if (this.stopping) {
        current.status = 'skipped';
        this._finish();
        return;
      }

      if (msg.status === 'completed') {
        current.status = 'done';
      } else if (msg.status === 'killed' || msg.signal === 'SIGTERM') {
        // 수동 stop (api-robots에서 직접 정지) → 배치도 중단
        current.status = 'skipped';
        for (const q of this.queue) {
          if (q.status === 'pending') q.status = 'skipped';
        }
        this.emit('task-done', this.currentIdx, current);
        this._finish();
        return;
      } else {
        current.status = 'error';
        current.error = `exit code: ${msg.code}, signal: ${msg.signal}`;
      }

      this.emit('task-done', this.currentIdx, current);

      // 다음 과제로
      this._runNext();
    };

    this.robotManager.on('robot-message', this._onRobotMessage);

    // 첫 과제 시작
    const started = this._runNext();
    if (!started) {
      // 첫 task도 시작 못하면 즉시 실패
      this._finish();
      throw new Error('배치 시작 실패: 실행 가능한 과제가 없습니다.');
    }
    return true;
  }

  /**
   * @returns {boolean} task 시작 성공 여부
   */
  _runNext() {
    if (!this.running || this.stopping) return false;

    // 다음 pending 과제 찾기
    const nextIdx = this.queue.findIndex((q, i) => i > this.currentIdx && q.status === 'pending');
    if (nextIdx === -1) {
      // 모든 과제 완료
      this._finish();
      return false;
    }

    this.currentIdx = nextIdx;
    const entry = this.queue[nextIdx];
    const t = entry.task;

    try {
      const robotId = this.robotManager.start({
        system: 'ezbaro',
        institution: t.연구수행기관,
        project: this.options.project || null,
        options: {
          task: t.과제번호,
          port: this.options.port || 9446,
          host: this.options.host,
          staff: this.options.staff,
        },
      });

      entry.status = 'running';
      entry.robotId = robotId;
      this.emit('task-start', nextIdx, entry);
      return true;
    } catch (err) {
      entry.status = 'error';
      entry.error = err.message;
      this.emit('task-done', nextIdx, entry);

      // 에러여도 다음 과제 진행
      return this._runNext();
    }
  }

  _finish() {
    this.running = false;
    this.stopping = false;
    if (this._onRobotMessage && this.robotManager) {
      this.robotManager.off('robot-message', this._onRobotMessage);
      this._onRobotMessage = null;
    }
    this.emit('batch-done', this.getStatus());
  }

  /**
   * 배치 중단 — 현재 로봇 정지 요청 + 남은 큐 skip
   * 실제 종료는 로봇 exit 이벤트에서 처리
   */
  stopBatch() {
    if (!this.running) return;

    this.stopping = true;

    // 남은 pending 전부 skip
    for (const q of this.queue) {
      if (q.status === 'pending') q.status = 'skipped';
    }

    // 현재 실행 중인 로봇 정지 요청
    const current = this.queue[this.currentIdx];
    if (current && current.status === 'running' && current.robotId) {
      try {
        this.robotManager.stop(current.robotId);
        // exit 이벤트에서 _finish() 호출됨
      } catch {
        // 이미 종료된 경우
        current.status = 'skipped';
        this._finish();
      }
    } else {
      // 실행 중인 로봇이 없으면 바로 종료
      this._finish();
    }
  }

  /**
   * 배치 상태 조회
   */
  getStatus() {
    const total = this.queue.length;
    const done = this.queue.filter(q => q.status === 'done').length;
    const errors = this.queue.filter(q => q.status === 'error').length;
    const skipped = this.queue.filter(q => q.status === 'skipped').length;
    const pending = this.queue.filter(q => q.status === 'pending').length;
    const runningTask = this.queue.find(q => q.status === 'running');

    return {
      running: this.running,
      stopping: this.stopping,
      total,
      done,
      errors,
      skipped,
      pending,
      currentIdx: this.currentIdx,
      currentTask: runningTask ? {
        institution: runningTask.task.연구수행기관,
        과제번호: runningTask.task.과제번호,
        robotId: runningTask.robotId,
      } : null,
      tasks: this.queue.map((q, i) => ({
        idx: i,
        institution: q.task.연구수행기관,
        과제번호: q.task.과제번호,
        status: q.status,
        error: q.error,
      })),
    };
  }
}

module.exports = { BatchRunner };
