const { getAdapter } = require('../../lib/adapters/interface');

describe('adapter factory', () => {
  it('enaradomum 어댑터 로드', () => {
    const adapter = getAdapter('enaradomum');
    expect(adapter.navigate).toBeDefined();
    expect(adapter.collect).toBeDefined();
    expect(adapter.review).toBeDefined();
  });

  it('ezbaro 어댑터 로드', () => {
    const adapter = getAdapter('ezbaro');
    expect(adapter.navigate).toBeDefined();
    expect(adapter.collect).toBeDefined();
    expect(adapter.review).toBeDefined();
  });

  it('없는 시스템 → 에러', () => {
    expect(() => getAdapter('unknown')).toThrow('Unknown system');
  });
});
