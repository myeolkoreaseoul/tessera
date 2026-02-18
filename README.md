# e나라도움 상시점검 RPA

e나라도움 보조금 집행내역 상시점검을 자동화하는 RPA 도구입니다.

## 기능

1. **지침 PDF 분석**: 사업 지침서에서 핵심 규정 자동 추출
2. **집행내역 수집**: e나라도움 페이지에서 데이터 파싱
3. **첨부파일 다운로드**: 증빙서류 일괄/개별 다운로드
4. **문서 분석**: PDF 텍스트 추출, 이미지 OCR (Claude Vision)
5. **지침 기반 판단**: 규정과 대조하여 적정/부적정/확인필요 판단
6. **결과 엑셀 출력**: 판단 결과를 엑셀로 출력

## 설치

```bash
cd e-naradomum-rpa
npm install
npm run build
```

## 사전 준비

### 1. Anthropic API 키 설정

```bash
export ANTHROPIC_API_KEY="your-api-key"
```

### 2. Chrome 디버그 모드로 실행

**Windows:**
```bash
"C:\Program Files\Google\Chrome\Application\chrome.exe" --remote-debugging-port=9222
```

**Mac:**
```bash
/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome --remote-debugging-port=9222
```

### 3. e나라도움 접속

1. 디버그 모드로 실행된 Chrome에서 e나라도움 로그인
2. 집행정산 → 상시점검 → 사업 선택
3. 사업별집행내역조회 화면으로 이동

## 사용법

```bash
# 기본 실행 (대화형)
npm start

# 지침 파일 지정
npm start -- --guideline="C:\지침\사업지침.pdf"

# 결과 출력 경로 지정
npm start -- --guideline="./지침.pdf" --output="./결과"

# 상세 로그
npm start -- --guideline="./지침.pdf" --verbose
```

## 실행 흐름

```
1. 지침 PDF 파일 경로 입력
2. 지침 분석 → 규정 추출 → 확인
3. Chrome 브라우저 연결
4. 집행내역 목록 수집
5. 첨부파일 다운로드
6. 문서 분석 (OCR)
7. 지침 기반 판단
8. 결과 엑셀 생성
```

## 출력 결과

`results/` 폴더에 엑셀 파일 생성:

- **전체 목록**: 모든 집행건 + 판단 결과
- **부적정_확인필요**: 문제 있는 건만 필터
- **통계**: 건수/금액 요약

### 판단 결과

| 판단 | 색상 | 의미 |
|------|------|------|
| 적정 | 흰색 | 문제 없음 |
| 부적정 | 빨강 | 규정 위반 |
| 확인필요 | 노랑 | 수동 확인 필요 |

## 보수적 판단 원칙

- 확실한 경우에만 "적정" 또는 "부적정" 판단
- 조금이라도 애매하면 "확인필요"로 분류
- 최종 판단은 사람이 검토

## 폴더 구조

```
e-naradomum-rpa/
├── src/                    # 소스코드
│   ├── index.ts           # 메인 진입점
│   ├── browser/           # 브라우저 제어
│   ├── analyzer/          # 문서/지침 분석
│   ├── downloader/        # 파일 다운로드
│   ├── inspector/         # 판단 로직
│   ├── output/            # 결과 출력
│   ├── types/             # 타입 정의
│   └── utils/             # 유틸리티
├── downloads/             # 다운로드된 파일
├── results/               # 결과 엑셀
├── logs/                  # 로그 파일
└── config/                # 설정
```

## 주의사항

1. **읽기 전용**: Phase 1에서는 e나라도움에 쓰기 작업 없음
2. **결과 검토 필수**: 자동 판단 결과는 반드시 사람이 검토
3. **API 비용**: Claude API 사용량에 따른 비용 발생

## 문제 해결

### Chrome 연결 실패

```
Chrome을 디버그 모드로 실행해주세요:
chrome.exe --remote-debugging-port=9222
```

### 테이블 파싱 실패

e나라도움 페이지 구조가 변경되었을 수 있습니다. DOM 셀렉터 업데이트 필요.

### API 키 오류

```bash
export ANTHROPIC_API_KEY="sk-ant-..."
```

---

*정동회계법인 AI 프로젝트*
