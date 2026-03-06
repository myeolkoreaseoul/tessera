/**
 * 시스템별 어댑터 공통 인터페이스
 *
 * 각 시스템(e나라도움, 이지바로, 보탬e, 페이퍼)은
 * 이 인터페이스를 구현하는 어댑터를 제공한다.
 */

class SystemAdapter {
  constructor(config) {
    this.config = config;
    this.system = config.system || 'unknown';
  }

  async connect(opts) {
    throw new Error(`${this.system}: connect() not implemented`);
  }

  async navigate(opts) {
    throw new Error(`${this.system}: navigate() not implemented`);
  }

  async collectRow(page, idx) {
    throw new Error(`${this.system}: collectRow() not implemented`);
  }

  async downloadFiles(page) {
    throw new Error(`${this.system}: downloadFiles() not implemented`);
  }

  async inputResult(page, result) {
    throw new Error(`${this.system}: inputResult() not implemented`);
  }

  async nextItem(page) {
    throw new Error(`${this.system}: nextItem() not implemented`);
  }

  async keepAlive(page) {
    throw new Error(`${this.system}: keepAlive() not implemented`);
  }
}

/**
 * 시스템명으로 어댑터 모듈 반환
 * 어댑터는 클래스가 아닌 기존 모듈을 그대로 반환 (하위 호환)
 */
function getAdapter(systemName) {
  switch (systemName) {
    case 'enaradomum':
      return {
        navigate: require('./enaradomum/navigate'),
        collect: require('./enaradomum/collect'),
        review: require('./enaradomum/review'),
      };
    case 'ezbaro':
      return {
        navigate: require('./ezbaro/navigate'),
        collect: require('./ezbaro/collect'),
        review: require('./ezbaro/review'),
      };
    default:
      throw new Error(`Unknown system: ${systemName}. Available: enaradomum, ezbaro`);
  }
}

module.exports = { SystemAdapter, getAdapter };
