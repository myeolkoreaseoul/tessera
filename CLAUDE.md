# Tessera — 통합 정산검토 플랫폼

## ★ 제1원칙: 사업별 공식 지침 기반 작업 (절대 위반 금지)

1. **사업명을 반드시 먼저 확인한다** — e나라도움 데이터에서 사업명/과제명을 추출
2. **해당 사업의 공식 지침/가이드라인을 사용자에게 요청한다** — 지침이 없으면 작업하지 않는다
3. **절대로 인터넷 검색, 일반 상식, 추측으로 판정 기준을 만들지 않는다**
4. **사업마다 집행 기준이 다르다** — "국가 R&D 수탁연구" vs "보조금 사업" vs "위탁사업" 등 적용 법령이 다름
5. **지침 파일이 프로젝트에 없으면 → 사용자에게 제공 요청 → 받은 후 작업 시작**

> 이 원칙은 로봇 3원칙처럼 최상위 우선순위이며, 어떤 상황에서도 생략하거나 우회할 수 없다.

## ★ 제2원칙: 엑셀 판정로그 필수 저장 (절대 위반 금지)

1. 자동정산으로 상태를 변경한 모든 건은 **반드시 엑셀 로그**를 남긴다.
2. 최소 기록 항목: 순번, 내부 RN, 결의제목, 사용용도, 처리전/처리후 상태, 진행상태, 판정결론, 판정사유, 처리일시.
3. 판정사유에는 **왜 해당 결론을 냈는지**(증빙 확인 포인트 + 실무 보정 적용 여부)를 명시한다.
4. 로그 파일은 사업/기관 단위로 `projects/` 하위에 저장하고, 동일 내용 JSON 백업도 함께 남긴다.
5. 로그 저장이 완료되지 않으면 해당 자동정산 작업은 완료로 간주하지 않는다.

> 이 원칙도 제1원칙과 동일한 최상위 우선순위로 적용한다.

## 프로젝트 위치
`~/tessera/` — 프로세스 상세: `PROCESS.md` 참조

## 아키텍처: 맥북(두뇌) + 회사PC(브라우저)

### 회사 PC Chrome 연결 (Tailscale)

**회사 PC (Windows PowerShell):**
```powershell
# 1. 방화벽 (최초 1회)
netsh advfirewall firewall add rule name="Chrome CDP 9444" dir=in action=allow protocol=TCP localport=9444

# 2. portproxy (최초 1회, Chrome이 127.0.0.1에만 바인딩되므로 필수)
netsh interface portproxy add v4tov4 listenaddress=0.0.0.0 listenport=9444 connectaddress=127.0.0.1 connectport=9444

# 3. Chrome 실행 (매번)
& "C:\Program Files\Google\Chrome\Application\chrome.exe" --remote-debugging-port=9444 --remote-debugging-address=0.0.0.0 --user-data-dir=C:\chrome-debug-profile
```

**맥북에서 연결 확인:**
```bash
curl -s http://100.87.3.123:9444/json/version  # Tailscale IP
```

**Playwright 연결:** `chromium.connectOverCDP('http://100.87.3.123:9444')`

### 멀티 Chrome (트랙별)
| 포트 | 용도 | user-data-dir |
|------|------|---------------|
| 9444 | e나라도움 | `C:\chrome-debug-profile` |
| 9445 | 보탬e | `C:\chrome-debug-2` |
| 9446 | 이지바로 | `C:\chrome-debug-3` |

> 각 포트마다 방화벽 + portproxy 설정 필요

### SSH/SCP 연결 (맥북 ↔ 회사PC)

**네트워크:**
- 맥북(리눅스): `100.75.130.73` (Tailscale), 유저 `john`
- 회사PC(Windows): `100.87.3.123` (Tailscale), 유저 `정동회계법인`

**설정 완료 항목 (최초 1회):**
- 회사PC에 OpenSSH 서버 설치됨 (OpenSSH_for_Windows_9.5)
- 맥북 공개키(`id_ed25519`)가 회사PC `C:\ProgramData\ssh\administrators_authorized_keys`에 등록됨
- ⚠️ 윈도우 관리자 계정은 `~/.ssh/authorized_keys` 무시 → 반드시 `C:\ProgramData\ssh\administrators_authorized_keys` 사용

**파일 전송 (맥북 → 회사PC):**
```bash
scp /home/john/tessera/파일명 '정동회계법인@100.87.3.123:C:\Users\정동회계법인\Documents\'
```

**파일 전송 (회사PC → 맥북):**
```bash
scp '정동회계법인@100.87.3.123:C:\Users\정동회계법인\Documents\파일명' /home/john/tessera/
```

**SSH 접속:**
```bash
ssh 정동회계법인@100.87.3.123
```

**sshfs 마운트 (회사PC 다운로드 폴더):**
```bash
sshfs 정동회계법인@100.87.3.123:/mnt/c/projects/e-naradomum-rpa/downloads ~/company-pc/downloads
```

### 파일 다운로드
- 증빙 PDF는 회사 PC에 다운로드됨
- sshfs로 마운트하여 접근 (위 SSH 섹션 참조)

## ★ 자동정산 공통 원칙 (모든 시스템/사업 공통)

### 금액 대조 원칙
증빙서류(영수증, 청구서, 세금계산서 등) PDF에는 다양한 금액이 포함되어 있다 (전월 미납액, 당월 청구액, 부가세, 합계, 기타 수수료 등). **집행 상세내역의 집행금액을 기준으로, 해당 금액이 증빙서류 안에 존재하는지 역방향 대조한다.**

```
방법:
1. 집행 상세화면에서 집행금액(공급가액, 집행금액 등) 추출
2. 증빙서류 PDF 텍스트에서 해당 금액 문자열 검색
3. 금액이 존재하면 → 금액 일치 확인됨
4. 금액이 존재하지 않으면 → "증빙서류에서 집행금액 미확인" 플래그

예시:
- 집행금액: 315,510원
- PDF 텍스트에서 "315,510" 검색
- 찾으면 OK, 못 찾으면 플래그
```

> **주의**: PDF에서 금액을 먼저 추출하여 비교하는 방식이 아니라, 집행금액을 가져와서 PDF에 대조하는 방식이다. 영수증에는 수많은 금액이 있으므로, 어떤 금액이 "정답"인지 추론하는 것보다 집행금액을 기준으로 검색하는 것이 정확하다.

### 증빙 충족 판정 원칙
1. **증빙유형(집행방식)이 전자세금계산서/카드** → 시스템에서 결제증빙 자동 충족 (추가 증빙 불필요)
2. **증빙유형이 기타** → 첨부파일에서 납부/결제 증빙 확인 필요
3. **파일이 존재하고 금액이 확인되면** → 기본적으로 적정 처리
4. **비목별 한도 초과 여부** → criteria에 명시된 한도와 대조

### 금액 대조 시 예외 처리 원칙
1. **전자세금계산서/보조금카드** → 금액 대조 생략 (시스템에서 결제 확인됨, PDF에서 재확인 불필요)
2. **이미지 PDF** → 금액 대조 불가 (스캔 문서는 pdf-parse로 텍스트 추출 안 됨). FAIL이 아닌 SKIP 처리
3. **기본서류 ≠ 결제증빙** → 기본서류는 계획서, 기안, 결과보고 등 사업 관련 서류일 수 있으며, 집행금액이 없는 것이 정상. 금액 대조 대상은 영수증/세금계산서/청구서 등 결제 관련 서류에 한정
4. **금액 대조 FAIL 조건** → 증빙유형이 "기타"이고, PDF가 텍스트 추출 가능하고, 결제 관련 서류인데 집행금액이 미발견일 때만 FAIL

### 이미지 PDF 판별 기준
- PDF에서 추출한 텍스트의 한글/숫자 비율이 30% 미만이면 이미지 PDF로 판정
- 가스요금 청구서 등 스캔 문서가 해당됨 (전기요금 청구서는 텍스트 기반이라 정상 추출됨)
- 이미지 PDF는 파일명 매칭만 가능하고, 금액 대조는 SKIP

## 자동정산 프로세스

> 사용자가 "기관명 자동정산해", "다음 기관 해", "OO병원 정산" 등으로 지시하면 아래 순서대로 진행.
> **시스템별 파이프라인 현황:**
> - e나라도움: 완성 (수집+분석+입력 전자동)
> - 보탬e: 부분 (수집 일부, 입력 미완성)
> - 이지바로/RCMS: 미착수 (첫 기관 할 때 스크립트 신규 개발 필요)
> 미완성 시스템은 첫 기관에서 Chrome 연결→화면 파악→스크립트 개발→guidelines 기록 순서로 진행.

### Step 0: 사전 확인
1. `lib/configs/index.js`에 해당 사업 config 있는지 확인
2. 없으면 → 사업 지침 요청 → config 추가 + guidelines .md 작성
3. `projects/progress.md`에서 해당 기관 기처리 여부 확인

### Step 1: 수집 + 심층분석 (원커맨드)
```bash
node run-all.js --inst=기관명 --kw=키워드 --dir=출력명 --project=사업명 --skip-judge --skip-review
```
- Phase 0~4: 네비게이션 → 그리드 → 다운로드 → OCR → data.json
- **Phase 4.5: 심층분석** → data-enriched.json (플래그 자동 생성)

### Step 2: 심층분석 결과 확인
- Phase 4.5 출력에서 플래그 요약 확인
- 사용자에게 주요 플래그 보고 (원천세, 내부인건비, 자문료 등)
- 필요시 `data-enriched.json` 읽어서 상세 분석

### Step 3: AI 판정
- **Claude 직접**: enriched data + criteria-v3.md 기반 판정 → results.json
- **4모델 교차검증**: `cross-validate/` + criteria-v3.md

### Step 4: e나라도움 입력
```bash
node lib/review-generic.js --results=기관명-results.json --save --settlement=interim --pagesize=20
```

### Step 5: progress.md 업데이트
- 완료 기관, 건수, 판정 결과 기록

### 심층분석 엔진 (lib/deep-analyze.js)
- **플러그인 구조**: `lib/rules/common/`, `lib/rules/보조금/`, `lib/rules/혁신법/`
- **새 규칙 추가**: 파일 1개 추가 → 자동 로드 (엔진 수정 불필요)
- **단독 실행**: `node lib/deep-analyze.js --data=xxx-data.json --institution=기관명 --project=사업명`
- **사업별 설정**: `lib/configs/index.js` (자문료 한도, 회의비 한도, 인건비 비율 등)
- **검토 기준**: `guidelines/` 계층구조 (common→보조금/혁신법→시스템→전문기관→사업)

### 시스템별 수집 파이프라인 (adapter 구조)
각 시스템은 완전히 다른 UI/API를 사용하므로, 수집(navigate+collect+review)은 시스템별로 별도 구현.
분석(deep-analyze)과 정규화(normalize)만 공통.

| 시스템 | 수집 | 분석 | 입력 | 상태 |
|--------|------|------|------|------|
| e나라도움 | run-all.js + lib/navigate.js | deep-analyze.js | lib/review-generic.js | **완성** |
| 보탬e | 별도 세션에서 부분 구현 | deep-analyze.js | 미완성 | **부분** |
| 이지바로 | 미착수 | deep-analyze.js | 미착수 | **미착수** |
| RCMS | 미착수 | deep-analyze.js | 미착수 | **미착수** |
| 페이퍼 | Excel 읽기만 | deep-analyze.js | N/A (수기) | **부분** |

새 시스템 첫 기관 할 때: Chrome 연결 → DOM/API 파악 → adapter 개발 → guidelines common.md 기록

## 보탬e (losims.go.kr) 원칙

### 시스템 정보
- URL: `https://www.losims.go.kr/lss.do` (지방보조금시스템, e나라도움과 별도)
- Chrome: port 9445, portproxy 설정 또는 SSH 터널: `ssh -L 9445:127.0.0.1:9445 정동회계법인@100.87.3.123 -N -f`
- UI 프레임워크: cl-* (커스텀, 모든 요소가 div로 렌더링됨)
- 데이터 통신: WebSocket (XHR 인터셉트 불가)

### ★ 세션 연장 (필수)
- 보탬e는 **5분 타임아웃** — 세션 만료 시 모든 작업 손실
- 화면 우상단: 접속일시 옆 카운트다운 타이머 + **파란색 새로고침 버튼**
- **5분마다 반드시 새로고침 버튼 클릭** (세션 연장)
- RPA 장시간 실행 시 별도 keep-alive 스크립트 필요

### 네비게이션 경로
- 정산관리 → 민간회계사정산검토 → 검토대상 목록조회(민간회계사)
- 회계연도 2025, 보조사업자명 검색 → "작성중" 클릭 → 집행내역 목록조회

### 고려대학교 캠퍼스타운
- 보조사업코드: 20253070000000296751
- 보조사업명: G-local 대학타운형 안암 창업밸리 조성
- 집행내역: 685건

### 그리드 페이지네이션 제한
- CLEOPATRA 그리드의 goToPage/페이지번호 클릭은 **실제로 페이지를 이동하지 않음** (다른 페이지 번호를 클릭해도 동일한 데이터가 표시됨)
- 항목 간 이동은 반드시 **상세 화면 진입 후 "다음 집행정보 보기" / "이전 집행정보 보기" 버튼**으로 순차 이동
- 그리드에서 특정 항목으로 바로 점프하는 방법 없음 — N번째 항목을 보려면 1번부터 N-1번 "다음" 클릭 필요

### 증빙 파일 다운로드 (보탬e 전용)
- 보탬e는 WebSocket 기반이라 일반 XHR 인터셉트 불가 → **page.evaluate 내 fetch → base64 → Node.js Buffer** 방식으로 메모리에서 처리
- Chrome의 실제 다운로드 창은 뜨지 않으며, 회사PC 디스크에 파일이 저장되지 않음
- `pdf-parse` 라이브러리로 Buffer에서 바로 텍스트 추출 → 금액 대조까지 메모리 내 처리
- **Browser.setDownloadBehavior 주의**: CDP로 `{behavior:'deny'}`를 설정하면 사용자의 수동 다운로드까지 차단됨. 스크립트 종료 전 반드시 `{behavior:'allow'}` 로 복원할 것

### 첨부파일 API
- **파일 목록 조회**: `POST /cm/retvFileList.do` (JSON body: `{atflGrpId, atflSnum:'', dutDvCd:'', fileCn:''}`)
  - 응답: `{fileList: [{fileNm, fileCpct, atflSnum, sysStrgFileNm, fileUrl, ...}]}`
  - atflGrpId는 기본서류 PDF 클릭 시 CDP Network 인터셉트로 획득
- **파일 다운로드**: `POST /cm/fileDownload.do` (JSON body: `{atflGrpId, atflSnum}`)
  - 응답: `application/octet-stream` (PDF 바이너리)
  - page.evaluate 내 fetch로 호출 → base64 변환 → Node.js에서 Buffer로 받아 pdf-parse

### DOM 셀렉터 패턴
- **필드값 읽기**: 라벨(`.cl-text` 중 `innerText===라벨명`)을 찾고 → 같은 y좌표, 오른쪽에 있는 `input.value` 또는 `.cl-text.innerText`로 값 추출
  - 주요 필드: 품목명, 증빙유형, 거래처명, 집행거래일, 기본서류
- **금액 읽기**: 스크롤 최하단 → "보조세목 재원별 집행금액" 라벨 아래 테이블에서 "집행합계금액" 행/열, "지방비" 행/열 추출
- **스크롤**: `.cl-layout.cl-scrollbar.cl-customscrollbar.cl-with-vscrollbar` 요소의 `scrollTop` 조작 (0=맨위, scrollHeight=맨아래)
- **팝업 닫기**: 화면에 "확인" 또는 "닫기" 텍스트가 있는 작은 버튼(width<200, childElementCount===0) 클릭

### 안전한 네비게이션 규칙
- **상세 화면에서 안전한 동작**: "다음 집행정보 보기", "이전 집행정보 보기", 스크롤, 필드값 읽기, 기본서류 PDF 클릭(파일팝업)
- **위험한 동작 (하지 말 것)**: 좌측 메뉴 클릭, 탭폴더 클릭(집행내역 목록 탭 등), 상단 메뉴 클릭 — 의도치 않은 화면 전환 발생
- **keepAlive**: 15~20항목마다 우상단 새로고침 이미지 클릭 (x>1200, y<50, 10<width<40인 img 요소)
- 스크립트 장시간 실행 시 5분 세션 타임아웃 주의 — keepAlive 미실행 시 세션 만료

## 핵심 교훈
- IBSheet: `grid.focus(row)` 만 사용 (selectRow → getFocusedRow null 버그)
- 정산구분: 사업수행중→중간정산, 집행마감→최종정산
- evidenceSub에 "소득 지급명세서" → 시스템 내장 증빙 (files 없어도 적정)
- navigate.js: `--kw=키워드1,키워드2` AND 조건, 검색결과 1건이라도 매칭 필수
- 상세→목록 복귀 시 정산구분 초기화됨 → 매번 재설정 필요

## 주요 파일
| 파일 | 역할 |
|------|------|
| `run-all.js` | 전체 파이프라인 (Phase 0~6 + 4.5 심층분석) |
| `lib/deep-analyze.js` | 심층분석 플러그인 엔진 |
| `lib/rules/common/` | 공통 분석 규칙 (원천세, 내부인건비, 자문료 등) |
| `lib/rules/보조금/` | 보조금법 전용 규칙 (카드, 계약, 부가세) |
| `lib/rules/혁신법/` | R&D혁신법 전용 규칙 (미작성) |
| `lib/configs/index.js` | 사업별 설정 레지스트리 |
| `lib/normalize.js` | 시스템별→표준 포맷 변환 |
| `lib/navigate.js` | e나라도움 네비게이션 |
| `lib/collect-generic.js` | OCR 수집 모듈 |
| `lib/review-generic.js` | e나라도움 결과 입력 모듈 |
| `lib/utils.js` | 공통 유틸 (CDP 주소 설정 포함) |
| `guidelines/` | 검토 기준 (common→보조금/혁신법→시스템→전문기관→사업) |
| `cross-validate/` | 4모델 교차검증 + criteria-v3.md |
| `projects/progress.md` | 작업 진행 세이브포인트 |
