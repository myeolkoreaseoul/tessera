/**
 * 로봇 진행 보고 모듈 (IPC/stdout 겸용)
 *
 * - child_process.fork()로 실행 시: process.send()로 IPC 메시지
 * - 직접 CLI 실행 시: console.log()로 stdout 출력
 *
 * 메시지 타입:
 *   progress      — 건별 진행률 (current, total, item)
 *   item-complete — 건 처리 완료 (item, result, duration)
 *   phase-change  — 단계 전환 (phase, label)
 *   error         — 오류 발생 (message, stack, recoverable)
 *   done          — 전체 완료 (summary)
 */

class Reporter {
  constructor(options = {}) {
    this.useIPC = typeof process.send === 'function';
    this.silent = options.silent || false;
    this.system = options.system || 'unknown';
    this.projectId = options.projectId || null;
  }

  _send(type, payload) {
    const msg = {
      type,
      system: this.system,
      projectId: this.projectId,
      timestamp: Date.now(),
      ...payload,
    };

    if (this.useIPC) {
      process.send(msg);
    }

    if (!this.silent) {
      const prefix = `[${this.system}]`;
      switch (type) {
        case 'phase-change':
          console.log(`\n${prefix} ═══ Phase ${payload.phase}: ${payload.label} ═══`);
          break;
        case 'progress':
          console.log(`${prefix} [${payload.current}/${payload.total}] ${payload.item || ''}`);
          break;
        case 'item-complete':
          console.log(`${prefix} ✓ ${payload.item} → ${payload.result} (${payload.duration}ms)`);
          break;
        case 'error':
          console.error(`${prefix} ✗ ${payload.message}`);
          break;
        case 'done':
          console.log(`${prefix} ══ 완료 ══ ${JSON.stringify(payload.summary)}`);
          break;
        default:
          console.log(`${prefix} [${type}]`, payload);
      }
    }
  }

  phaseChange(phase, label) {
    this._send('phase-change', { phase, label });
  }

  progress(current, total, item) {
    this._send('progress', { current, total, item });
  }

  itemComplete(item, result, duration) {
    this._send('item-complete', { item, result, duration: Math.round(duration) });
  }

  error(message, stack, recoverable = true) {
    this._send('error', { message, stack, recoverable });
  }

  done(summary) {
    this._send('done', { summary });
  }

  log(message) {
    this._send('log', { message });
  }
}

module.exports = { Reporter };
