const { analyze } = require('../../lib/deep-analyze');
const { getConfig } = require('../../lib/configs');
const { sampleRecords } = require('../fixtures/sample-data');

describe('deep-analyze', () => {
  const config = getConfig('디지털헬스케어');

  it('정상 건에 대해 분석 결과 반환', () => {
    const results = analyze([sampleRecords[0]], config);
    expect(results).toHaveLength(1);
    expect(results[0].analysis).toBeDefined();
    expect(results[0].analysis.flags).toBeInstanceOf(Array);
  });

  it('여러 건 일괄 분석', () => {
    const results = analyze(sampleRecords.slice(0, 3), config);
    expect(results).toHaveLength(3);
    for (const r of results) {
      expect(r.analysis).toBeDefined();
    }
  });

  it('0원 건에 0원 플래그 생성', () => {
    const results = analyze([sampleRecords[3]], config);
    const flags = results[0].analysis.flags;
    const hasZero = flags.some(f => {
      const id = typeof f === 'string' ? f : (f.id || '');
      return id.includes('0원') || id.includes('zero') || id.includes('SKIP');
    });
    expect(hasZero).toBe(true);
  });

  it('원본 데이터를 변형하지 않음', () => {
    const original = JSON.parse(JSON.stringify(sampleRecords[0]));
    analyze([sampleRecords[0]], config);
    expect(sampleRecords[0].rowNum).toBe(original.rowNum);
    expect(sampleRecords[0].totalAmount).toBe(original.totalAmount);
  });

  it('이지바로 config로도 동작', () => {
    const ezConfig = getConfig('이지바로-공통');
    const results = analyze([sampleRecords[0]], ezConfig);
    expect(results).toHaveLength(1);
    expect(results[0].analysis).toBeDefined();
  });
});
