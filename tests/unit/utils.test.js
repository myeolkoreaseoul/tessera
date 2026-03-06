const {
  parseNumber,
  formatDate,
  hasFileByName,
  hasFileByContent,
  getTexts,
  extractParticipants,
  extractConsultHours,
  hasAlcohol,
  grossFromNet,
} = require('../../lib/utils');

describe('parseNumber', () => {
  it('숫자는 그대로 반환', () => {
    expect(parseNumber(12345)).toBe(12345);
  });

  it('콤마 포함 문자열 파싱', () => {
    expect(parseNumber('1,234,567')).toBe(1234567);
  });

  it('원 단위 포함 문자열 파싱', () => {
    expect(parseNumber('500,000원')).toBe(500000);
  });

  it('null/undefined → 0', () => {
    expect(parseNumber(null)).toBe(0);
    expect(parseNumber(undefined)).toBe(0);
    expect(parseNumber('')).toBe(0);
  });

  it('음수 파싱', () => {
    expect(parseNumber('-100')).toBe(-100);
  });
});

describe('formatDate', () => {
  it('빈 값 → 빈 문자열', () => {
    expect(formatDate('')).toBe('');
    expect(formatDate(null)).toBe('');
  });

  it('Date 객체 → ISO 날짜', () => {
    expect(formatDate(new Date('2025-03-15'))).toBe('2025-03-15');
  });

  it('문자열 그대로 반환', () => {
    expect(formatDate('2025-03-15')).toBe('2025-03-15');
  });
});

describe('hasFileByName', () => {
  const files = [
    { name: '회의록.pdf', text: '' },
    { name: '내부결재.pdf', text: '' },
    { name: '영수증_001.pdf', text: '' },
  ];

  it('키워드 매칭', () => {
    expect(hasFileByName(files, '회의록')).toBe(true);
    expect(hasFileByName(files, '영수증')).toBe(true);
  });

  it('대소문자 무시', () => {
    expect(hasFileByName(files, '회의록')).toBe(true);
  });

  it('미매칭', () => {
    expect(hasFileByName(files, '견적서')).toBe(false);
  });
});

describe('hasFileByContent', () => {
  const files = [
    { name: '회의록.pdf', text: '회 의 록\n참석자: 5명' },
  ];

  it('한글 OCR 공백 대응', () => {
    expect(hasFileByContent(files, '회의록')).toBe(true);
  });

  it('내용 키워드 매칭', () => {
    expect(hasFileByContent(files, '참석자')).toBe(true);
  });

  it('미매칭', () => {
    expect(hasFileByContent(files, '견적서')).toBe(false);
  });
});

describe('getTexts', () => {
  it('파일 텍스트 결합', () => {
    const files = [
      { name: 'a.pdf', text: 'hello' },
      { name: 'b.pdf', text: 'world' },
    ];
    expect(getTexts(files)).toBe('hello\nworld');
  });

  it('텍스트 없는 파일 처리', () => {
    const files = [{ name: 'a.pdf' }];
    expect(getTexts(files)).toBe('');
  });
});

describe('extractParticipants', () => {
  it('참석자 N명 패턴', () => {
    expect(extractParticipants('참석자: 5명')).toBe(5);
  });

  it('참석인원 패턴', () => {
    expect(extractParticipants('참석인원 3명')).toBe(3);
  });

  it('인원 미발견 → 0', () => {
    expect(extractParticipants('내용 없음')).toBe(0);
  });
});

describe('extractConsultHours', () => {
  it('14~16시 → 2시간', () => {
    expect(extractConsultHours('자문시간: 14~16시')).toBe(2);
  });

  it('10:00~12:30 → 2.5시간', () => {
    expect(extractConsultHours('10:00~12:30')).toBe(2.5);
  });

  it('시간 정보 없음 → 0', () => {
    expect(extractConsultHours('자문 완료')).toBe(0);
  });
});

describe('hasAlcohol', () => {
  it('주류 키워드 감지', () => {
    expect(hasAlcohol('맥주 2병')).toBe(true);
    expect(hasAlcohol('참이슬 소주')).toBe(true);
  });

  it('비주류 → false', () => {
    expect(hasAlcohol('콜라, 사이다')).toBe(false);
  });
});

describe('grossFromNet', () => {
  it('세전 추정금액 계산 (3.3%)', () => {
    const net = 290000;
    const gross = grossFromNet(net);
    expect(gross).toBeGreaterThan(net);
    expect(Math.abs(gross * 0.967 - net)).toBeLessThan(1);
  });
});
