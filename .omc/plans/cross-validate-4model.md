# 4모델 교차검증 시스템 계획

## 요약
대구경북재단 180건 집행내역을 Opus 4.6, Sonnet 4.6, Gemini 2.5 Pro, Codex 5.3 4개 모델로 교차검증하고, 불일치 항목은 토론/재검증하여 최종 results.json을 생성한다.

## 이전 batch-1(30건) 비교에서 발견된 문제점
- **Opus 4.6**: 적정 90% — 너무 관대 (인쇄비 세금계산서 누락도 적정 판정)
- **Sonnet 4.6**: 적정 73% — 중간, 급여 이체확인증/회의비 인원 세밀 체크
- **Gemini 2.5 Pro**: 적정 53% — "집행취소 협조 요청" 파일을 취소건으로 오판
- **Codex 5.3**: 적정 40% — "출장복명서 미첨부" 과도 지적, vendorName=기관명을 불일치로 오판

## 수용 기준
1. criteria-v2.md에 오판 방지 규칙 최소 5개 추가
2. 4개 모델 전부 180건 판정 완료
3. 만장일치+다수결로 90%+ 항목 확정
4. 2:2 팽팽 항목은 토론 후 100% 해소
5. 최종 results.json이 review-generic.js 입력 포맷과 호환

## 구현 단계

### Phase 1: criteria-v2.md 작성 (오판 방지 강화)
- **파일**: `cross-validate/criteria-v2.md`
- 추가할 규칙:
  1. "집행취소 협조 요청" 파일 = 단순 참고문서, 취소 아님 (금액>0이면 유효)
  2. 출장복명서 = 선택 증빙, 미첨부가 확인 사유 아님
  3. vendorName이 기관명(대구경북첨단의료산업진흥재단)일 때 = 자체 집행, 불일치 아님
  4. 자문료 vendorName이 기관명이고 개인명이 purpose에 있으면 = 정상
  5. 위촉직 급여: 지출결의서 + 급여내역조회 + 위촉직급여정보 = 충분 (이체확인증 선택)
  6. 인쇄비: 견적서2개 + 구매신청 + 구매검사 + 거래명세서 = 충분 (세금계산서 없어도 적정)
  7. 회의비: 방명록 첨부 시 인원 확인 가능으로 간주 (보수적 인원 추정 불필요)
  8. R21~R30이 R1~R10과 동일 데이터 → 같은 판정 필수 (일관성)

### Phase 2: prompt-template-v2.md 작성
- **파일**: `cross-validate/prompt-template-v2.md`
- criteria-v2.md 내용을 프롬프트에 통합
- 오판 방지 규칙을 "주의사항" 섹션으로 명시
- 출력 포맷 동일 유지 (JSON 배열)

### Phase 3: 배치 분할 스크립트
- **파일**: `cross-validate/split-batches-v2.js`
- 180건을 6개 배치(30건씩)로 분할
- 각 배치에 prompt-template-v2 + 데이터 결합

### Phase 4: 4모델 병렬 실행
- **실행 방법**:
  - Opus 4.6: 내(Claude Code)가 직접 판정
  - Sonnet 4.6: `Task(model="sonnet")` 서브에이전트
  - Gemini 2.5 Pro: `gemini -m gemini-2.5-pro` CLI (stdin pipe)
  - Codex 5.3: `codex exec --skip-git-repo-check -o output.txt - < prompt.txt` CLI
- **병렬화**: 4모델 x 6배치 = 24개 작업, 모델별 순차/배치간 병렬
- **출력**: `{model}-batch-{n}.json` 파일

### Phase 5: 비교 + 불일치 감지
- **파일**: `cross-validate/compare-v2.js`
- 4개 모델 결과를 rowNum 기준으로 병합
- 분류: 만장일치(4/4), 다수결(3:1), 팽팽(2:2)
- 팽팽 항목 목록을 `disputed-items.json`으로 추출

### Phase 6: 불일치 토론/재검증
- **방법**: 팽팽 항목에 대해 Opus가 "심판" 역할
- **프롬프트**:
  ```
  이 항목에 대해 4개 모델이 다음과 같이 판정했습니다:
  [각 모델의 판정 + 사유]

  판정 기준을 근거로, 각 모델의 논거를 분석하고 최종 판정을 내리세요.
  ```
- **출력**: 토론 결과를 `debate-results.json`에 저장

### Phase 7: 최종 results.json 생성
- **파일**: `cross-validate/finalize-v2.js`
- 만장일치 → 해당 판정 채택
- 다수결 → 다수 의견 채택
- 팽팽 → Phase 6 토론 결과 채택
- review-generic.js 호환 포맷으로 변환:
  ```json
  {"rowNum": 1, "status": "적정", "issues": [], "vendorName": "...", "totalAmount": ...}
  ```

## 리스크 및 대응
| 리스크 | 대응 |
|--------|------|
| Gemini CLI 출력 잘림 | 배치 크기 20건으로 축소, 재시도 로직 |
| Codex 모델 제한 | 기본모델(gpt-5.3-codex) 사용 확인됨 |
| 모델 간 일관성 낮음 | criteria-v2로 오판 방지 후 재검증 |
| 토론이 끝없이 길어짐 | 심판(Opus) 1회로 확정, 추가 라운드 없음 |

## 검증 단계
1. criteria-v2.md에 오판 방지 규칙 8개+ 포함 확인
2. 4모델 x 180건 = 720개 판정 전부 생성 확인
3. 만장일치 비율 50%+ (criteria 강화 효과)
4. 최종 results.json이 180건 전부 포함
5. review-generic.js로 dry-run 가능 확인
