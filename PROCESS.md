# e나라도움 정산검토 자동화 프로세스 (현행)

> 최종 업데이트: 2025-02-12 (빔웍스 디지털헬스케어 19건 처리 완료)

---

## 전체 흐름

```
Phase 0: 네비게이션 (자동)
    ↓
Phase 1: 그리드 추출 (자동)
    ↓
Phase 2: 첨부파일 다운로드 (자동)
    ↓
Phase 3: OCR (자동)
    ↓
Phase 4: data.json 저장 (자동)
    ↓
Phase 5: 판정 ← Claude Code가 직접 수행 (수동)
    ↓
Phase 6: e나라도움 입력 (자동)
```

## 자동 구간 (Phase 0~4)

```bash
node run-all.js --inst=빔웍스 --kw=빔웍스,디지털헬스케어 --dir=빔웍스 --year=2025 --skip-judge --skip-review
```

### Phase 0: 네비게이션 (`lib/navigate.js`)
- Chrome 디버그 모드(포트 9444)에 Playwright로 연결
- 점검대상사업조회(DD001005Q) → 기관 검색 → 사업 선택 → 집행내역조회(DD001002Q)
- `--kw=키워드1,키워드2` AND 조건으로 정확한 사업 매칭 (국산의료기기 vs 디지털헬스케어 구분)

### Phase 1: 그리드 추출
- DD001002Q 그리드에서 전체 집행내역 추출
- 페이지네이션 자동 처리 (pagesize=20 기준)
- 필드: 집행일, 증빙유형, 용도, 비목/세목, 거래처, 금액, 첨부파일수 등

### Phase 2: 첨부파일 다운로드
- 각 행의 상세 페이지 진입 → 첨부파일 ZIP 다운로드 → 압축 해제
- `downloads/{기관명}/r{N}/` 폴더 구조
- 상세→목록 복귀 시 정산구분 재설정 (중간정산/최종정산)

### Phase 3-4: OCR → JSON 저장
- PDF: pdf-parse
- HWP: hwp5txt
- Excel: exceljs
- 이미지: tesseract
- 텍스트 상한: 12,000자 (기존 4,000 → 확장)
- 결과: `{기관명}-data.json`

---

## 판정 (Phase 5) — Claude Code 직접 수행

### 왜 자동 judge를 폐기했는가

| 방식 | 문제 |
|------|------|
| rule-based (`judge-digital-healthcare.js`) | 키워드 매칭 기반 → 70% 오탐. OCR 공백/오탈자에 취약. "품의서"를 "내부결재"로 인식 못함 |
| API 호출 (`judge-ai.js`) | 종량제 비용 발생. 사용자가 거부 |

### 현재 방식: Claude Code가 대화 중 직접 판정

1. `{기관명}-data.json` 읽기
2. 각 항목의 OCR 텍스트를 직접 분석
   - 문서 종류 파악 (품의서, 회의록, 세금계산서, 급여대장, 자문확인서 등)
   - 문서 내용에서 핵심 정보 추출 (금액, 참석자, 일시, 결재 상태 등)
   - 가이드라인(`guidelines/digital-healthcare.md`) 대조
3. 종합 판단하여 `{기관명}-results.json` 작성

### 판정 기준 (디지털헬스케어 사업)

| 비목 | 적정 조건 | 확인 사유 |
|------|----------|----------|
| 인건비 | 급여대장에 해당 직원명 확인 | 급여대장 미첨부, 직원명 불일치 |
| 회의비 | 내부결재 + 회의록 + 영수증, 1인당 5만원 이하, 외부참석자 포함 | 회의록 미첨부, 내부결재 미첨부, 인원 초과 |
| 자문료 | 자문확인서/의견서, 단가 기준 이내 (2h≤20만, 3h≤30만, 3h+≤40만, 1일 60만) | 자문확인서 미첨부, 단가 초과 |
| 여비 | 출장계획서 + 복명서 (국외 시 전담기관 승인) | 출장증빙 미첨부 |
| 임차료 | 세금계산서 + 지출결의서 (2천만 미만 수의계약 가능) | 계약서 미첨부 (대규모 시) |
| 수수료 | 전자세금계산서 (e나라 자동 연동) | - |

### rule-based 대비 개선 사례

| 항목 | rule-based 결과 | Claude 직접 판정 | 이유 |
|------|----------------|-----------------|------|
| R17 내부결재 | "미첨부" (❌ 오탐) | "품의서 ✓" | 파일명 "회의사전신청.pdf" 안의 품의서를 내부결재로 인식 |
| R18 임차료 | "확인" (과잉) | "적정" | 일시 행사 대관료에 계약서/검수조서 불요 |
| R5 교통비 | "적정" (과소) | "확인" | 급여대장만 첨부, 출장계획서/복명서 실제 없음 |

---

## e나라도움 입력 (Phase 6) — 자동

```bash
node lib/review-generic.js --results=빔웍스-results.json --save --settlement=interim --pagesize=20
```

### `lib/review-generic.js` 동작
1. Chrome에 연결 → DD001002Q 페이지 확인
2. 정산구분 설정 (사업수행중→중간정산, 집행마감→최종정산)
3. 각 항목에 대해:
   - 금액+업체명으로 그리드 행 동적 매칭 (`findAndSelectRow()`)
   - `grid.focus(row)` 사용 (selectRow 버그로 사용 금지)
   - 상세 페이지 진입
   - 적정 → "검토완료" / 확인 → "보완요청" + issues 코멘트 입력
   - 저장 → 목록 복귀 → 정산구분 재설정 → 다음 행

### results.json 형식

```json
{
  "rowNum": 17,
  "type": "회의비",
  "purpose": "회의비_251112",
  "amount": 500000,
  "vendor": "개정 경대병원칠곡점",
  "status": "확인",
  "issues": ["회의록(결과보고서) 미첨부"],
  "ok": ["내부결재(품의서) ✓", "외부참석자 4명 확인 ✓", "1인당 약 45,455원 < 5만원 ✓"]
}
```

---

## 정산구분 자동 결정

| 사업상태 | 정산구분 | 비고 |
|---------|---------|------|
| 집행마감 | 최종정산 | 세부내역검토 진입 가능 |
| 사업수행중 | 중간정산 | 최종정산 시 "집행마감 처리후 등록" 에러 |

---

## 실행 예시 (전체 파이프라인)

```bash
# 1. 자동 수집 (Phase 0~4)
node run-all.js --inst=빔웍스 --kw=빔웍스,디지털헬스케어 --dir=빔웍스 --year=2025 --skip-judge --skip-review

# 2. Claude Code가 빔웍스-data.json 읽고 직접 판정 → 빔웍스-results.json 작성

# 3. 자동 입력 (Phase 6)
node lib/review-generic.js --results=빔웍스-results.json --save --settlement=interim
```

---

## 주요 파일

| 파일 | 역할 |
|------|------|
| `run-all.js` | 전체 파이프라인 오케스트레이터 |
| `lib/navigate.js` | e나라도움 네비게이션 (AND 키워드 매칭) |
| `lib/collect-generic.js` | OCR 수집 모듈 |
| `lib/review-generic.js` | e나라도움 결과 입력 모듈 |
| `lib/utils.js` | 공통 유틸 (sleep, dismissModals, waitForGrid 등) |
| `guidelines/digital-healthcare.md` | 디지털헬스케어 사업 검토 기준 |
| `guidelines/common.md` | 공통 상위법 기준 |
| `lib/judge-digital-healthcare.js` | (구) rule-based judge — 현재 미사용 |
| `lib/judge-ai.js` | (구) API judge — 현재 미사용 |
