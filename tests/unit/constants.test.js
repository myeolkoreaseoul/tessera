const constants = require('../../lib/constants');

describe('constants', () => {
  it('CDP_HOST 기본값', () => {
    expect(constants.CDP_HOST).toBe('100.87.3.123');
  });

  it('포트 번호가 숫자', () => {
    expect(typeof constants.CDP_PORT_ENARADOMUM).toBe('number');
    expect(typeof constants.CDP_PORT_EZBARO).toBe('number');
    expect(typeof constants.CDP_PORT_BOTAME).toBe('number');
  });

  it('세션 연장 간격이 양수', () => {
    expect(constants.SESSION_EXTEND_INTERVAL_MS).toBeGreaterThan(0);
  });

  it('지원 파일 확장자 목록', () => {
    expect(constants.SUPPORTED_FILE_EXTENSIONS).toContain('.pdf');
    expect(constants.SUPPORTED_FILE_EXTENSIONS).toContain('.xlsx');
    expect(constants.SUPPORTED_FILE_EXTENSIONS).toContain('.hwp');
  });
});
