const { getConfig, listConfigs, configs } = require('../../lib/configs');

describe('getConfig', () => {
  it('직접 매칭', () => {
    const cfg = getConfig('디지털헬스케어');
    expect(cfg.system).toBe('enaradomum');
    expect(cfg.legalBasis).toBe('보조금');
    expect(cfg.consultFeeLimit).toBe(600000);
  });

  it('이지바로 설정', () => {
    const cfg = getConfig('이지바로-공통');
    expect(cfg.system).toBe('ezbaro');
    expect(cfg.legalBasis).toBe('혁신법');
    expect(cfg.withholdingRate).toBe(0.088);
  });

  it('보탬e 설정', () => {
    const cfg = getConfig('캠퍼스타운');
    expect(cfg.system).toBe('botame');
  });

  it('alias 매칭', () => {
    const cfg = getConfig('국가신약개발재단');
    expect(cfg.system).toBe('ezbaro');
    expect(cfg.agency).toBe('국가신약개발재단');
  });

  it('미등록 사업 → 기본값', () => {
    const cfg = getConfig('없는사업');
    expect(cfg.consultFeeLimit).toBe(600000);
    expect(cfg.withholdingRate).toBe(0.088);
  });

  it('오버라이드 적용', () => {
    const cfg = getConfig('디지털헬스케어', { consultFeeLimit: 999999 });
    expect(cfg.consultFeeLimit).toBe(999999);
    expect(cfg.system).toBe('enaradomum');
  });

  it('이지바로 자동 감지', () => {
    const cfg = getConfig('이지바로-신규사업');
    expect(cfg.system).toBe('ezbaro');
    expect(cfg.legalBasis).toBe('혁신법');
  });
});

describe('listConfigs', () => {
  it('설정 목록 반환', () => {
    const list = listConfigs();
    expect(list).toContain('디지털헬스케어');
    expect(list).toContain('이지바로-공통');
    expect(list.length).toBeGreaterThan(5);
  });
});

describe('configs object', () => {
  it('모든 설정에 system 필드 존재', () => {
    for (const [name, cfg] of Object.entries(configs)) {
      expect(cfg.system, `${name}에 system 필드 없음`).toBeDefined();
    }
  });

  it('모든 설정에 legalBasis 필드 존재', () => {
    for (const [name, cfg] of Object.entries(configs)) {
      expect(cfg.legalBasis, `${name}에 legalBasis 필드 없음`).toBeDefined();
    }
  });
});
