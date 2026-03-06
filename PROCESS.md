# e나라도움 자동정산 프로세스 (DOM 조작 상세)

> 이 문서는 e나라도움 RPA 자동화의 모든 DOM 조작, 셀렉터, API 호출, 대기 조건, 에러 복구 로직을 기록합니다.
> 소스 코드를 읽지 않고도 자동화 흐름을 이해하고 디버깅할 수 있도록 작성되었습니다.
>
> **최종 업데이트:** 2026-02-19

---

## ★★★ 올바른 한건씩 검토 프로세스 (반드시 이 순서대로) ★★★

### 1단계: 집행내역 목록 (DD001002Q)
- 1페이지에서 첫번째 행 선택 → **세부내역검토** 버튼 클릭

### 2단계: 세부내역검토 화면 (DD001003S)
- 상단에 사용정보, 거래처 정보, 계좌정보 표시됨
- **개별첨부파일** 옆의 **"개별파일첨부"** 버튼 클릭 → 해당 건의 증빙파일 확인
- 개별첨부파일이 없는 경우 → **"공용파일첨부"** 버튼 클릭 → 공용증빙 확인
- 증빙 파일을 읽고 분석

### 3단계: 3모델 교차검증 판정
- criteria-v1.md 기준으로 **Claude + Gemini + Codex** 3개 모델이 교차검증
- 판정: 적정(검토완료) / 확인(보완요청) / SKIP(0원)

### 4단계: 결과 입력
- 비목 채점 정보 그리드에서 검토상태 변경 (검토완료/보완요청)
- 보완요청인 경우 보완요청사유 입력
- 저장

### 5단계: 다음 건 이동
- **이전/다음 버튼** (`< 이전` / `다음 >`)으로 바로 이동
- ※ 목록 복귀 불필요! 정산구분 초기화 문제 없음!

### 핵심 주의사항
- ❌ 전체 페이지 벌크 추출하지 말 것
- ❌ 목록으로 돌아갔다 다시 들어가지 말 것
- ✅ 세부내역 화면에서 이전/다음으로 순차 이동
- ✅ 개별파일 없으면 반드시 공용파일도 확인
- ✅ 3모델 교차검증 필수

---
>
> **주요 소스 파일:**
> | 파일 | 역할 |
> |------|------|
> | `lib/navigate.js` | 네비게이션 (점검대상사업조회 -> 집행내역조회) |
> | `run-all.js` | 메인 파이프라인 (Phase 0~6 + 4.5 심층분석) |
> | `lib/review-generic.js` | 검토결과 입력 (세부내역검토) |
> | `lib/collect-generic.js` | OCR 수집 모듈 |
> | `lib/utils.js` | 공통 유틸리티 (브라우저 연결, 모달 처리, 그리드 대기) |
> | `lib/deep-analyze.js` | 심층분석 엔진 (플러그인 아키텍처) |
> | `lib/configs/index.js` | 사업별 설정 레지스트리 |

---

## 목차

1. [시스템 연결](#시스템-연결)
2. [페이지 구조 및 DOM 맵](#페이지-구조-및-dom-맵)
3. [공통 유틸리티 함수](#공통-유틸리티-함수)
4. [Phase 0: 네비게이션](#phase-0-네비게이션)
5. [Phase 1: 그리드 데이터 추출](#phase-1-그리드-데이터-추출)
6. [Phase 2: 첨부파일 다운로드](#phase-2-첨부파일-다운로드)
7. [Phase 3: OCR](#phase-3-ocr)
8. [Phase 4: data.json 생성](#phase-4-datajson-생성)
9. [Phase 4.5: 심층분석](#phase-45-심층분석)
10. [Phase 5: AI 판정 (Judge)](#phase-5-ai-판정-judge)
11. [Phase 6: 검토결과 입력 (review-generic.js)](#phase-6-검토결과-입력)
12. [에러 복구 로직 (recoverToList)](#에러-복구-로직-recovertolsit)
13. [전체 파이프라인 CLI](#전체-파이프라인-cli)
14. [주요 교훈 / 주의사항](#주요-교훈--주의사항)

---

## 전체 흐름

```
Phase 0: 네비게이션 (자동)
    |  브라우저 연결 -> 점검대상사업조회 -> 기관 검색 -> 집행내역조회 -> 정산구분 설정
    v
Phase 1: 그리드 추출 (자동)
    |  DD001002QGridObj에서 모든 행 페이지네이션하며 추출
    v
Phase 2: 첨부파일 다운로드 (자동)
    |  각 행의 atchmnflId로 팝업 열어 CDP 다운로드 + ZIP 해제
    v
Phase 3: OCR (자동)
    |  PDF/HWP/Excel/이미지 -> 텍스트 추출
    v
Phase 4: data.json 저장 (자동)
    v
Phase 4.5: 심층분석 (자동)
    |  플러그인 규칙 엔진 (원천세, 내부인건비, 자문료 역산, 중복 등)
    v
Phase 5: AI 판정 (수동/자동)
    |  Claude Code 직접 판정 또는 judge 모듈
    v
Phase 6: e나라도움 입력 (자동)
       행 선택 -> 세부내역검토 -> 검토완료/보완요청 -> 저장 -> 목록 복귀 -> 반복
```

---

## 시스템 연결

### Chrome CDP 연결

| 항목 | 값 |
|------|-----|
| 프로토콜 | Chrome DevTools Protocol (CDP) over Playwright |
| 회사PC Tailscale IP | `100.87.3.123` |
| e나라도움 포트 | `9444` |
| CDP 주소 | `http://100.87.3.123:9444` |
| 환경변수 | `CDP_HOST` (기본값 `100.87.3.123`) |

```javascript
// lib/utils.js - connectBrowser(port = 9444)
const host = process.env.CDP_HOST || '100.87.3.123';
const browser = await chromium.connectOverCDP(`http://${host}:${port}`);
const context = browser.contexts()[0];
return { browser, context };
```

### e나라도움 페이지 탐색

```javascript
// lib/utils.js - findEnaraPage(context)
// 1. about:blank 페이지 모두 닫기
for (const p of context.pages()) {
  if (p.url().includes('blank') || p.url() === 'about:blank') {
    await p.close();
  }
}
// 2. URL에 'gosims' 또는 'dd001' 포함된 페이지 반환
const page = context.pages().find(p =>
  p.url().includes('gosims') || p.url().includes('dd001')
);
// 3. dialog 자동 수락 핸들러 등록
page.on('dialog', async d => { try { await d.accept(); } catch {} });
```

### e나라도움 기본 URL

| 시스템 | URL 패턴 |
|--------|----------|
| e나라도움 (정산검토) | `https://gvs.gosims.go.kr/exe/dd/dd001/...` |

---

## 페이지 구조 및 DOM 맵

### 1. 점검대상사업조회 (검증기관) -- DD001005Q

| 항목 | 값 |
|------|-----|
| **URL** | `/exe/dd/dd001/getDD001005QView.do?PJTCD=EXE` |
| **전체 URL** | `https://gvs.gosims.go.kr/exe/dd/dd001/getDD001005QView.do?PJTCD=EXE` |
| **IBSheet 그리드** | `DD001005QGridObj` (window 전역 변수) |
| **즐겨찾기 이동 함수** | `f_redirectToBookmark("/exe/dd/dd001/getDD001005QView.do?PJTCD=EXE", "EXE")` |

#### DOM 요소

| 셀렉터/ID | 타입 | 역할 | 비고 |
|-----------|------|------|------|
| `#DD001005Q_selBsnsyear` | `<select>` | 사업연도 드롭다운 | 값: `"2024"`, `"2025"` 등 |
| `#DD001005Q_srcExcInsttNm` | `<input>` | 하위보조사업자명 검색 필드 | 기관명 텍스트 입력 |
| `#DD001005Q_btnRetrieveChckTrgetBsnsList` | `<button>` | 검색 버튼 | 클릭 -> 그리드 검색 실행 |
| `#DD001005Q_btnExcutDetlInqire` | `<button>` | 집행내역조회 버튼 | 행 선택 후 클릭 -> DD001002Q 이동 |

#### 그리드 컬럼 (DD001005QGridObj)

| 필드명 | 설명 |
|--------|------|
| `taskNm` | 사업명 |
| `excInsttNm` | 보조사업자(기관명) |
| `excutLmttResnNm` | 사업상태 ("사업수행중", "집행마감" 등) |
| `bsnsyear` | 사업연도 |
| `taskNo` | 사업번호 |

#### 페이지 존재 확인 방법

```javascript
// navigate.js - isOnInspectionPage(page)
typeof DD001005QGridObj !== 'undefined' ||
document.getElementById('DD001005Q_selBsnsyear') !== null;
```

---

### 2. 사업별집행내역조회 -- DD001002Q

| 항목 | 값 |
|------|-----|
| **페이지 ID 접두사** | `DD001002Q` |
| **IBSheet 그리드** | `DD001002QGridObj` (window 전역 변수) |
| **페이지네이션 함수** | `f_retrieveListBsnsExcutDetl(pageNumber)` (전역) |

#### DOM 요소

| 셀렉터/ID | 타입 | 역할 | 비고 |
|-----------|------|------|------|
| `#DD001002Q_btnRetrieve` | `<button>` | 검색 버튼 | |
| `#DD001002Q_selPageSize` | `<select>` | 페이지 크기 드롭다운 | 옵션: `"20"`, `"50"`, `"100"` |
| `#DD001002Q_searchCnt` | 텍스트 엘리먼트 | 총 건수 표시 | 정규식 `/(\d+)/`로 숫자 추출 |
| `#DD001002Q_excclcSeCode_1` | `<input type="radio">` | 정산구분: **최종정산**(009) | |
| `#DD001002Q_excclcSeCode_2` | `<input type="radio">` | 정산구분: **중간정산**(002) | |
| `#DD001002Q_detlListExmnt` | `<button>` | 세부내역검토 버튼 | 행 선택 후 클릭 -> DD001003S 이동 |

#### 정산구분 라디오 버튼 상세

| 라디오 ID | 코드 값 | 의미 | 사용 조건 |
|-----------|---------|------|-----------|
| `DD001002Q_excclcSeCode_1` | `009` | 최종정산 | 사업상태 = "집행마감" |
| `DD001002Q_excclcSeCode_2` | `002` | 중간정산 | 사업상태 = "사업수행중" |

> **주의:** 상세(DD001003S) -> 목록(DD001002Q) 복귀 시 정산구분이 기본값으로 초기화됨!
> 반드시 매번 `ensureSettlement()` 호출하여 재설정 + 재검색 필요.

#### 그리드 컬럼 (DD001002QGridObj)

| 필드명 | 설명 | 타입 |
|--------|------|------|
| `excutExecutDe` | 집행일자 | `YYYYMMDD` 문자열 |
| `excutRegistDe` | 등록일자 | `YYYYMMDD` 문자열 |
| `writngDe` | 작성일자 | `YYYYMMDD` 문자열 |
| `prufSeNm` | 증빙구분명 | 문자열 ("세금계산서", "카드전표" 등) |
| `etcPruf` | 기타증빙 상세 | 문자열 ("소득 지급명세서 외 1개" 등) |
| `excutPrposCn` | 집행목적 (사유) | 문자열 |
| `asstnExpitmNm` | 보조비목명 (대분류) | 문자열 |
| `asstnTaxitmNm` | 보조세목명 (소분류) | 문자열 |
| `prdlstNm` | 물품명 | 문자열 |
| `bcncCmpnyNm` | 거래처명 | 문자열 |
| `dpstrNm` | 입금자명 | 문자열 |
| `bcncIndutyNm` | 업종명 | 문자열 |
| `excutSplpc` | 공급가액 | 숫자 |
| `excutVat` | 부가세 | 숫자 |
| `rcvrySumAmount` | 반납금액 | 숫자 |
| `lastAmount` | 최종금액 | 숫자 |
| `nrcgnAmount` | 불인정금액 | 숫자 |
| `atchmnflId` | 첨부파일 ID | 문자열 (팝업 다운로드 파라미터) |
| `cmnuseAtchmnflId` | 공통첨부파일 ID | 문자열 (공유 증빙 다운로드) |
| `excutId` | 집행 ID | 문자열 (고유 식별자) |
| `exmntPrgstNm` | 검토진행상태명 | 문자열 ("미검토", "검토완료" 등) |

#### 검색 버튼 폴백 로직

코드에서 `#DD001002Q_btnRetrieve`를 못 찾을 경우 아래 순서로 폴백:
1. ID에 `DD001002` 포함 + 텍스트 "검색" 인 button
2. 텍스트 "검색" + `offsetWidth > 0` (화면에 보이는) 인 button

```javascript
const btn = document.getElementById('DD001002Q_btnRetrieve') ||
  [...document.querySelectorAll('button')].find(
    b => b.textContent.trim() === '검색' && b.id.includes('DD001002')
  ) ||
  [...document.querySelectorAll('button')].find(
    b => b.textContent.trim() === '검색' && b.offsetWidth > 0
  );
```

#### 페이지 존재 확인 방법

```javascript
// navigate.js - isOnExecutionPage(page)
typeof DD001002QGridObj !== 'undefined';
```

---

### 3. 세부내역검토 (상세 페이지) -- DD001003S

| 항목 | 값 |
|------|-----|
| **페이지 ID 접두사** | `DD001003S` |
| **URL 패턴** | URL에 `DD001003S` 또는 `dd001003` 포함 |
| **IBSheet 그리드** | `DD001003SGridObj` (window 전역 변수) |

#### DOM 요소

| 셀렉터/ID | 타입 | 역할 | 비고 |
|-----------|------|------|------|
| `#DD001003S_btnSave` | `<button>` | 저장 버튼 | 검토결과 저장 |
| `#DD001003S_btnList` | `<button>` | 목록 버튼 | 목록(DD001002Q)으로 복귀 |
| `#DD001003S_btnPrevPage` | `<button>` | 이전 페이지 버튼 | 목록 복귀 대체 |

#### 전역 JS 함수

| 함수 | 파라미터 | 동작 |
|------|---------|------|
| `f_changeExmntPrgst("001")` | `"001"` | 검토완료 (적정) 설정 |
| `f_changeExmntPrgst("002")` | `"002"` | 보완요청 (확인) 설정 |
| `f_prevPage()` | 없음 | 이전 페이지(목록)로 이동 |

#### 그리드 조작 (DD001003SGridObj)

| 조작 | 코드 | 비고 |
|------|------|------|
| 불인정금액 설정 | `grid.setValue(rows[0], "nrcgnAmount", "금액문자열")` | 상세는 항상 1행 |
| 검증검토의견 설정 | `grid.setValue(rows[0], "exclexCn", "HTML의견")` | `\n` -> `<br>` 변환 |
| 원본의견 동기화 | `grid.setValue(rows[0], "orgExclexCn", "HTML의견")` | exclexCn과 동일값 |

---

### 4. 첨부파일 다운로드 팝업 -- DB003002S

| 항목 | 값 |
|------|-----|
| **URL** | `/exe/db/db003/getDB003002SView.do?atchmnflId={ID}` |
| **다운로드 함수** | `f_downloadDB003002S()` (window 전역) |
| **창 속성** | `width=700,height=500,scrollbars=yes` |

#### DOM 요소

| 셀렉터 | 타입 | 역할 |
|---------|------|------|
| `input[type="checkbox"]` | 체크박스 (복수) | 다운로드할 파일 선택 -- 전체 선택하여 사용 |

---

### 5. 공통 모달/팝업 구조

e나라도움은 각종 작업 후 확인/경고 모달을 빈번히 표시합니다. 모달이 남아있으면 다음 DOM 조작이 차단됩니다.

| 셀렉터 | 역할 | 비고 |
|---------|------|------|
| `.popupMask.on` | 활성 모달 컨테이너 | 여러 개 동시 존재 가능 |
| `.popupMask.on button.fn.ok` | 확인 버튼 (1순위) | |
| `.popupMask.on .fn.ok` | 확인 버튼 (2순위) | |
| `.popupMask.on footer button` | 확인 버튼 (3순위, 가장 범용) | |
| `.popupMask.on .message` | 모달 메시지 텍스트 | 에러 내용 확인용 |

### 6. 세션 연장

| 항목 | 값 |
|------|-----|
| **버튼 ID** | `#headSessionExtend` |
| **연장 확인 모달** | `.popupMask.on` 내 `button.fn.ok` / `.fn.ok` / `footer button` |
| **주기** | 5분 (300,000ms) |
| **시작 시점** | Phase 0 브라우저 연결 직후 |

```javascript
// navigate.js - startKeepAlive(page, intervalMs = 5 * 60 * 1000)
// 즉시 1회 실행 + setInterval로 5분 간격 반복
const doExtend = async () => {
  document.getElementById('headSessionExtend').click();
  // 1초 후 확인 모달이 뜨면 클릭
  setTimeout(() => {
    const modal = document.querySelector('.popupMask.on');
    if (modal) {
      const ok = modal.querySelector('button.fn.ok, .fn.ok, footer button');
      if (ok) ok.click();
    }
  }, 1000);
};
```

---

## 공통 유틸리티 함수

> 소스: `lib/utils.js`

### `sleep(ms)`

단순 Promise 기반 대기. 모든 단계의 대기에 사용.

### `connectBrowser(port = 9444)`

```
입력: CDP 포트 번호
동작:
  1. CDP_HOST 환경변수 확인 (기본 '100.87.3.123')
  2. chromium.connectOverCDP(`http://${host}:${port}`)
  3. browser.contexts()[0] 가져오기
출력: { browser, context }
```

### `findEnaraPage(context)`

```
동작:
  1. about:blank 페이지 모두 닫기 (p.close())
  2. URL에 'gosims' 또는 'dd001' 포함 페이지 찾기
  3. dialog 자동수락 핸들러 등록
출력: page 또는 undefined
```

### `dismissModals(page)`

```
동작 (page.evaluate):
  1. document.querySelectorAll('.popupMask.on') 전체 순회
  2. 각 모달에서 확인 버튼 찾기 (우선순위):
     - button.fn.ok
     - .fn.ok
     - footer button
  3. 찾은 버튼 클릭
  4. 에러 발생 시 무시 (catch 빈 블록)
```

### `waitModal(page, timeout = 10000)`

```
동작:
  1. 타임아웃까지 300ms 간격으로 폴링
  2. .popupMask.on 모달 존재 확인
  3. 확인 버튼(button.fn.ok / .fn.ok / footer button) 찾아 클릭
출력: true (모달 발견+클릭) 또는 false (타임아웃)
```

### `waitForGrid(page, gridName, timeout = 15000)`

```
동작:
  1. 타임아웃까지 500ms 간격으로 폴링
  2. window[gridName] 존재 확인
  3. typeof grid.getDataRows === 'function' 확인
  4. grid.getDataRows().length > 0 확인
출력: true (그리드 준비됨) 또는 false (타임아웃)
```

### `restoreXHR(page)`

```
동작 (page.evaluate):
  1. 숨겨진 iframe 생성 (display: none)
  2. iframe의 contentWindow.XMLHttpRequest를 window.XMLHttpRequest에 할당
  3. iframe 제거
목적: e나라도움이 XHR 프로토타입을 오버라이드하는 문제 우회
```

### `clickRowByText(page, gridName, text)`

```
동작 (page.evaluate):
  1. window[gridName].getDataRows() 모든 행 순회
  2. getRowValue(row)의 모든 값을 합쳐서 텍스트 매칭
  3. 1순위: [data-row="${row}"] 또는 tr[data-index="${row}"] DOM 클릭
  4. 2순위: grid.selectRow(row) 폴백
```

### `clickRowByIndex(page, gridName, idx)`

```
동작 (page.evaluate):
  1. window[gridName].getDataRows()[idx]
  2. 1순위: #${gridName} tbody tr / .${gridName} tbody tr 의 idx번째 DOM 클릭
  3. 2순위: grid.selectRow(row) 폴백
출력: row value 객체 또는 null
```

---

## Phase 0: 네비게이션

> 소스: `lib/navigate.js` + `run-all.js` Phase 0 부분
>
> 목적: 브라우저 연결 -> 점검대상사업조회 -> 기관 검색 -> 사업 선택 -> 집행내역조회 -> 정산구분 설정

### Step 0-1: 브라우저 연결

```
함수: goToInstitution(opts) 내부

1. connectBrowser(port=9444) 호출
2. context.pages()에서 URL에 'gosims' 포함 페이지 찾기
3. 없으면 에러 throw: "e나라도움 페이지를 찾을 수 없습니다. Chrome에서 e나라도움에 로그인해주세요."
4. dialog 자동 수락 핸들러 등록:
   page.on('dialog', async d => { try { await d.accept(); } catch {} });
```

### Step 0-2: 세션 연장 시작

```
함수: startKeepAlive(page, intervalMs = 300000)

1. 기존 타이머 정리: stopKeepAlive()
2. 즉시 1회 실행 (doExtend):
   - document.getElementById('headSessionExtend').click()
   - 1초 후 .popupMask.on 모달이 뜨면 확인 버튼 클릭
3. setInterval(doExtend, 300000)으로 5분 간격 반복
4. 콘솔 로그: "[세션 연장 HH:MM:SS]"
```

### Step 0-3: 점검대상사업조회 페이지 이동

```
함수: goToInspectionPage(page)

[현재 페이지 확인]
  isOnInspectionPage(page):
    typeof DD001005QGridObj !== 'undefined' 또는
    document.getElementById('DD001005Q_selBsnsyear') !== null
  -> 이미 해당 페이지면 즉시 반환 (true)

[1단계: 즐겨찾기 네비게이션]
  page.evaluate:
    f_redirectToBookmark("/exe/dd/dd001/getDD001005QView.do?PJTCD=EXE", "EXE")
  sleep(3000)
  dismissModals(page)

[2단계: 페이지 로드 대기 (최대 20초)]
  for (20회 반복):
    isOnInspectionPage(page) 확인
    true면 반환
    sleep(1000)

[3단계: URL 직접 이동 폴백]
  page.goto('https://gvs.gosims.go.kr/exe/dd/dd001/getDD001005QView.do?PJTCD=EXE', {
    waitUntil: 'domcontentloaded',
    timeout: 15000
  })
  sleep(3000)
  isOnInspectionPage(page) 최종 확인
```

### Step 0-4: 기관 검색

```
함수: searchInstitution(page, institutionName, year = 2025)

[1] 사업연도 설정:
  page.selectOption('#DD001005Q_selBsnsyear', String(year))
  sleep(500)

[2] 기관명 입력:
  page.fill('#DD001005Q_srcExcInsttNm', institutionName)
  sleep(300)

[3] 검색 실행:
  page.click('#DD001005Q_btnRetrieveChckTrgetBsnsList')
  sleep(3000)
  dismissModals(page)

[4] 결과 대기:
  waitForGrid(page, 'DD001005QGridObj', 10000)

[5] 결과 추출 (page.evaluate):
  const grid = window.DD001005QGridObj;
  const rows = grid.getDataRows();
  rows.map((row, i) => {
    const rv = grid.getRowValue(row);
    return {
      index: i,
      taskNm: rv.taskNm,           // 사업명
      excInsttNm: rv.excInsttNm,     // 보조사업자(기관명)
      excutLmttResnNm: rv.excutLmttResnNm, // 사업상태
      bsnsyear: rv.bsnsyear,
      taskNo: rv.taskNo,
    };
  });

[결과 없으면 에러]
  "검색 결과가 없습니다. 기관명을 확인해주세요."
```

### Step 0-5: 사업 선택 + 집행내역조회 이동

```
함수: selectProjectAndGoToExecution(page, searchResults, projectKeyword)

[1] 사업명 매칭:
  - projectKeyword가 있으면:
    쉼표로 분리 -> 각 키워드를 소문자로 변환
    searchResults에서 taskNm에 모든 키워드 포함(AND) 하는 행 찾기
    예: "디지털,헬스" -> taskNm에 "디지털"과 "헬스" 모두 포함해야 매칭
  - 키워드 없고 결과 1건 -> 자동 선택
  - 키워드 없고 결과 여러건 -> 첫번째 선택 + 경고 출력
  - 매칭 실패 -> 에러 throw: "선택할 사업이 없습니다."

[2] 그리드 행 선택 (page.evaluate):
  const grid = DD001005QGridObj;
  const rows = grid.getDataRows();
  grid.focus(rows[matchIdx]);
  // *** selectRow() 절대 사용 금지 -- getFocusedRow null 버그 ***
  sleep(500)

[3] 집행내역조회 클릭:
  page.click('#DD001005Q_btnExcutDetlInqire')
  sleep(4000)
  dismissModals(page)

[4] DD001002Q 페이지 대기 (최대 15초):
  for (15회 반복):
    isOnExecutionPage(page) -> typeof DD001002QGridObj !== 'undefined'
    true면 break
    sleep(1000)
    dismissModals(page)
  실패 시 에러: "사업별집행내역조회 페이지 로드 실패"

[5] 검색 실행:
  1순위: page.$('#DD001002Q_btnRetrieve') -> click()
  2순위 (page.evaluate):
    [...document.querySelectorAll('button')]
      .find(b => b.textContent.trim() === '검색' && b.id.includes('DD001002'))
  3순위:
    [...document.querySelectorAll('button')]
      .find(b => b.textContent.trim() === '검색' && b.getBoundingClientRect().width > 0)
  sleep(3000)
  dismissModals(page)
  waitForGrid(page, 'DD001002QGridObj', 15000)

[6] 결과 건수 확인:
  DD001002QGridObj.getDataRows().length
```

### Step 0-6: 정산구분 자동 결정 + 재검색

> 소스: `run-all.js` Phase 0 후반부

```
[1] 사업상태 기반 자동 결정:
  if (selected.excutLmttResnNm === '집행마감')
    SETTLEMENT = 'final'   // 최종정산
  else
    SETTLEMENT = 'interim'  // 중간정산 (기본)
  // --settlement CLI 인수로 수동 오버라이드 가능

[2] 라디오 ID 결정:
  const radioId = (SETTLEMENT === 'interim')
    ? 'DD001002Q_excclcSeCode_2'   // 중간정산
    : 'DD001002Q_excclcSeCode_1';  // 최종정산

[3] 라디오 클릭 (page.evaluate):
  const r = document.getElementById(radioId);
  if (r && !r.checked) r.click();

[4] 재검색:
  document.getElementById('DD001002Q_btnRetrieve').click()
  // 폴백: 텍스트 "검색" + offsetWidth > 0 버튼
  sleep(3000)
```

---

## Phase 1: 그리드 데이터 추출

> 소스: `run-all.js` -- `extractAllGridData(page)`
>
> 목적: DD001002QGridObj에서 모든 행을 페이지네이션하며 추출

### Step 1-1: 페이지 크기 최대화

```
[현재 그리드 행 수 확인]
  const currentRows = DD001002QGridObj.getDataRows().length;

[0건이면 페이지 크기 변경 + 재검색]
  page.evaluate:
    const sel = document.getElementById('DD001002Q_selPageSize');
    const opts = [...sel.options].map(o => o.value);
    if (opts.includes('100')) { sel.value = '100'; sel.dispatchEvent(new Event('change')); }
    else if (opts.includes('50')) { sel.value = '50'; sel.dispatchEvent(new Event('change')); }

    const btn = document.getElementById('DD001002Q_btnRetrieve') ||
      [...document.querySelectorAll('button')].find(
        b => b.textContent.trim() === '검색' && b.offsetWidth > 0
      );
    if (btn) btn.click();
  sleep(4000)
```

### Step 1-2: 페이지별 행 추출 루프

```
const allRows = [];
let pageNum = 1;

while (true) {
  [page.evaluate에서 현재 페이지 데이터 추출]
    const grid = window.DD001002QGridObj;
    const dataRows = grid.getDataRows();
    const rows = dataRows.map(row => {
      const v = grid.getRowValue(row);
      return {
        excutExecutDe, excutRegistDe, writngDe,
        prufSeNm, etcPruf, excutPrposCn,
        asstnExpitmNm, asstnTaxitmNm, prdlstNm,
        bcncCmpnyNm, dpstrNm, bcncIndutyNm,
        excutSplpc, excutVat, rcvrySumAmount,
        lastAmount, nrcgnAmount,
        atchmnflId, cmnuseAtchmnflId, excutId,
        exmntPrgstNm,
      };
    });

  [총 건수 확인]
    const totalEl = document.getElementById('DD001002Q_searchCnt');
    정규식 /(\d+)/ 로 숫자 추출
    또는 grid.getRowValue(dataRows[0]).totalNum 폴백

  allRows.push(...pageData.rows);

  [종료 조건]
    allRows.length >= total 또는 pageData.rows.length === 0

  [다음 페이지 이동]
    page.evaluate: f_retrieveListBsnsExcutDetl(pageNum)
    sleep(3000)
    pageNum++
}
```

### Step 1-3: 레코드 정규화

```
각 추출 행을 표준 형식으로 변환:
{
  rowNum: i + 1,                    // 1부터 시작
  executionDate: fmtDate(YYYYMMDD), // "2025-01-15" 형식
  registDate, writeDate,
  evidenceType: prufSeNm,
  evidenceSub: etcPruf,
  purpose: excutPrposCn,
  budgetCategory: asstnExpitmNm,
  subCategory: asstnTaxitmNm,
  itemName: prdlstNm,
  vendorName: bcncCmpnyNm,
  depositorName: dpstrNm,
  bizType: bcncIndutyNm,
  supplyAmount: excutSplpc,
  vat: excutVat,
  cancelAmount: rcvrySumAmount,
  totalAmount: lastAmount,
  disallowedAmount: nrcgnAmount,
  reviewStatus: exmntPrgstNm,
  atchmnflId, cmnuseAtchmnflId, excutId,
  files: []                         // Phase 3에서 채워짐
}
```

---

## Phase 2: 첨부파일 다운로드

> 소스: `run-all.js` -- `downloadFromPopup(page, context, atchmnflId, dlDir)`
>
> 목적: 각 행의 증빙파일을 회사 PC 로컬에 다운로드

### Step 2-0: 다운로드 필요 여부 판단

```
각 레코드에 대해:
1. downloads/{dirName}/r{rowNum}/ 디렉토리 존재 + 파일 있으면 -> 스킵 (중복 다운로드 방지)
2. atchmnflId와 cmnuseAtchmnflId 모두 빈 문자열이면 -> 스킵 (첨부 없음)
```

### Step 2-1: 기존 팝업 정리

```
1. context.pages() 순회
2. URL에 'getDB003002SView' 포함된 페이지 모두 닫기
   -> 이전에 닫히지 않은 다운로드 팝업 정리
3. page.waitForTimeout(300)
```

### Step 2-2: 첨부파일 팝업 열기

```
[팝업 이벤트 대기 설정]
  const popupPromise = context.waitForEvent('page', { timeout: 8000 });

[팝업 열기 (page.evaluate)]
  window.open(
    '/exe/db/db003/getDB003002SView.do?atchmnflId=' + atchmnflId,
    '_blank',
    'width=700,height=500,scrollbars=yes'
  );

[팝업 참조 획득]
  1순위: await popupPromise
  2순위 (1순위 실패 시):
    page.waitForTimeout(2000)
    context.pages().find(p => p.url().includes('getDB003002SView'))
  팝업 없으면 빈 배열 반환
```

### Step 2-3: 파일 다운로드 실행

```
[준비]
  1. 팝업에 dialog 핸들러 등록
  2. popup.waitForLoadState('domcontentloaded', { timeout: 10000 })
  3. popup.waitForTimeout(2000) -- DOM 완전 로드 대기
  4. 다운로드 함수 존재 확인:
     typeof window.f_downloadDB003002S === 'function'
     -> 없으면 팝업 닫고 빈 배열 반환

[CDP 다운로드 경로 설정]
  const cdp = await popup.context().newCDPSession(popup);
  await cdp.send('Page.setDownloadBehavior', {
    behavior: 'allow',
    downloadPath: winPath
  });

  // 경로 변환: Linux(/mnt/c/...) -> Windows(C:\...)
  dlDir.replace(/^\/mnt\/([a-z])\//, (_, d) => `${d.toUpperCase()}:\\`).replace(/\//g, '\\')

[체크박스 전체 선택]
  popup.evaluate:
    document.querySelectorAll('input[type="checkbox"]').forEach(cb => cb.checked = true);

[파일 목록 스냅샷]
  const filesBefore = new Set(fs.readdirSync(dlDir));

[다운로드 실행 + 모달 자동 처리]
  popup.evaluate:
    // MutationObserver로 확인 모달 자동 클릭
    const obs = new MutationObserver(() => {
      const mask = document.querySelector('.popupMask.on');
      if (mask) {
        const btn = mask.querySelector('footer button');
        if (btn) setTimeout(() => btn.click(), 200);
      }
    });
    obs.observe(document.body, {
      subtree: true,
      attributes: true,
      attributeFilter: ['class']
    });
    window.f_downloadDB003002S();

[다운로드 완료 대기 (최대 25초)]
  for (25회, 1초 간격):
    현재 파일 목록 = fs.readdirSync(dlDir)
    새 파일 = filesBefore에 없는 + .crdownload가 아닌 파일
    새 파일 있으면:
      - .zip 파일: AdmZip으로 압축 해제 -> ZIP 삭제
      - 일반 파일: 파일명 수집
      break

[정리]
  cdp.detach()
  popup.close()
```

### Step 2-4: 공통첨부파일 처리

```
atchmnflId 다운로드 완료 후:
if (rec.cmnuseAtchmnflId) {
  // 동일한 downloadFromPopup 프로세스로 추가 다운로드
  const sharedFiles = await downloadFromPopup(page, context, rec.cmnuseAtchmnflId, dlDir);
  files = files.concat(sharedFiles);
}
```

### Step 2-5: 다운로드 간 대기

```
각 레코드 처리 후: page.waitForTimeout(500)
진행률 출력: 매 5건 또는 마지막 건
```

---

## Phase 3: OCR

> 소스: `run-all.js` -- `ocrDir(dlDir)` + `lib/collect-generic.js`
>
> 목적: 다운로드된 증빙 파일에서 텍스트 추출

### 지원 파일 형식

| 확장자 | 추출 방법 | 라이브러리/도구 | 상세 |
|--------|-----------|----------------|------|
| `.pdf` | pdf-parse 시도 -> OCR 폴백 | `pdf-parse` -> `pdftoppm` + `tesseract` | 아래 상세 참조 |
| `.xlsx`, `.xls` | 셀 텍스트 추출 | `exceljs` | 모든 시트, 모든 행 |
| `.hwp` | hwp5txt CLI | `pyhwp` (hwp5txt) | timeout 30초 |
| `.jpg`, `.jpeg`, `.png` | OCR | `tesseract -l kor` | timeout 30초 |

### PDF 추출 상세 (extractPdfText)

```
[1단계: pdf-parse 시도]
  const pdfParse = require('pdf-parse');
  const data = await pdfParse(buf);
  -> data.text가 50자 이상이면 성공, 즉시 반환

[2단계: OCR 폴백 (pdf-parse 실패 또는 텍스트 부족)]
  1. 임시 디렉토리 생성: /tmp/ocr-{timestamp}-{random}
  2. PDF -> PNG 변환:
     pdftoppm -png -r 250 -f 1 -l 3 "{filePath}" "{tmpDir}/p"
     // 처음 3페이지를 250dpi PNG로 변환
     // timeout: 30초
  3. 각 PNG에 OCR 실행:
     tesseract "{imgPath}" "{outBase}" -l kor
     // 한국어 모델 사용
     // timeout: 30초
  4. 결과 텍스트 합산
  5. 임시 디렉토리 삭제: rm -rf
```

### 텍스트 길이 제한

```
각 파일의 텍스트: 최대 12,000자
text.substring(0, 12000)
```

### 출력 형식

```
records[i].files = [
  { name: "세금계산서.pdf", text: "공급받는자: ..." },
  { name: "급여대장.xlsx", text: "이름 급여 ..." },
  ...
];
```

---

## Phase 4: data.json 생성

> 소스: `run-all.js`

```
[1] records 배열에서 내부 전용 필드 제거:
  atchmnflId, cmnuseAtchmnflId, excutId 제외

[2] JSON 파일 저장:
  파일명: {dirName}-data.json
  경로: 프로젝트 루트 (__dirname)
  인코딩: utf-8
  포맷: JSON.stringify(output, null, 2)
```

---

## Phase 4.5: 심층분석

> 소스: `lib/deep-analyze.js` + `lib/configs/index.js`
>
> DOM 조작 없음 -- 순수 데이터 분석 단계

### 설정 로드

```
함수: getConfig(projectName, overrides)

1. configs 객체에서 직접 키 매칭 (예: '디지털헬스케어')
2. 실패 시 aliases 배열 매칭 (부분 문자열 매칭)
3. 실패 시 기본값 사용:
   { legalBasis: '보조금', consultFeeLimit: 600000, meetingFeePerPerson: 50000,
     salaryCapRatio: 0.30, withholdingRate: 0.088 }
```

### 규칙 로드 및 실행

```
함수: analyze(data, config)

[규칙 로드: loadRules(legalBasis)]
  1. lib/rules/common/*.js -- 번호순 정렬 로드 (모든 정산 공통)
  2. lib/rules/{legalBasis}/*.js -- 번호순 정렬 로드 (보조금 또는 혁신법)

[Phase 1: cross-row 규칙 (행 간 교차분석)]
  rule.phase === 'cross-row' 인 규칙을 순차 실행
  입력: (data 전체, config)
  출력: Map<rowNum, { flags, fields }>

[Phase 2: per-row 규칙 (단건 분석)]
  rule.phase === 'per-row' 인 규칙을 각 행마다 실행
  입력: (row 1건, config)
  출력: { flags, fields }

[enriched data 생성]
  각 행에 analysis: { flags: [...], fields: {...} } 추가
```

### 현재 등록된 규칙

| 파일 | 범위 | 설명 |
|------|------|------|
| `common/010-withholding-tax.js` | 공통 | 원천세(3.3%/8.8%) 확인 |
| `common/020-internal-salary.js` | 공통 | 내부인건비 탐지 |
| `common/030-duplicate-detect.js` | 공통 | 동일 금액/거래처 중복 탐지 |
| `common/040-consult-fee-calc.js` | 공통 | 자문료 역산 (시급/일급 한도) |
| `common/050-travel-report.js` | 공통 | 출장보고서/복명서 확인 |
| `common/060-common-attachment.js` | 공통 | 공통 첨부파일 확인 |
| `common/070-zero-amount.js` | 공통 | 0원 집행 |
| `common/080-no-evidence.js` | 공통 | 증빙 미첨부 |
| `보조금/010-card-usage.js` | 보조금 | 보조금전용카드 사용 확인 |
| `보조금/020-contract-threshold.js` | 보조금 | 2천만원 이상 계약 확인 |
| `보조금/030-vat-check.js` | 보조금 | 부가세 포함 여부 확인 |

### 출력

```
{dirName}-data-enriched.json
각 행에 analysis 필드 추가:
{
  rowNum: 1,
  purpose: "...",
  ...기존 필드,
  analysis: {
    flags: ["WITHHOLDING_TAX", "CONSULT_FEE_OVER_LIMIT"],
    fields: {
      grossAmount: 650000,
      withholdingTaxRate: 0.088,
      ...
    }
  }
}
```

---

## Phase 5: AI 판정 (Judge)

> 소스: `lib/judge-digital-healthcare.js` 또는 Claude 직접 판정
>
> `--skip-judge` 옵션 사용 시 이 단계 건너뜀 -- Claude Code가 직접 판정
>
> DOM 조작 없음

### 출력 형식

```
{dirName}-results.json

[
  {
    "rowNum": 1,
    "type": "인건비",        // 비목 분류
    "purpose": "12월 급여",   // 집행 사유
    "amount": 3500000,       // 최종금액
    "vendor": "홍길동",       // 거래처/입금자
    "status": "적정",        // "적정" 또는 "확인"
    "issues": [],            // 확인 사유 배열
    "ok": ["급여대장 확인"]   // 적정 근거 배열
  },
  ...
]
```

---

## Phase 6: 검토결과 입력

> 소스: `lib/review-generic.js`
>
> 목적: AI 판정 결과(results.json)를 e나라도움에 실제 입력
>
> 가장 복잡한 DOM 조작이 이루어지는 단계

### 초기화

```
함수: run({ results, overrides, saveMode, startRow, pageSize, settlement })

[1] 브라우저 연결:
  connectBrowser() -> { context }

[2] e나라도움 페이지 찾기:
  findEnaraPage(context) -> page
  없으면 에러: "e나라도움 페이지를 찾을 수 없습니다."

[3] dismissModals(page) + sleep(500)

[4] 상세 페이지에 있으면 목록 복귀:
  if (page.url().includes('DD001003S') || page.url().includes('dd001003')):
    page.evaluate(() => f_prevPage())
    sleep(3000) + dismissModals(page)

[5] 그리드 대기:
  waitForGrid(page, 'DD001002QGridObj')
  실패 시:
    ensureSettlement(page, settlement) -- 정산구분 설정
    검색 버튼 클릭: #DD001002Q_btnRetrieve 또는 폴백
    sleep(4000) + dismissModals + waitForGrid(15000)
    최종 실패: "ERROR: 목록 그리드 데이터 없음" + return

[6] 현재 URL 저장:
  const listUrl = page.url();
  -> 에러 복구(recoverToList)에서 사용

[7] 정산구분 확인/설정:
  ensureSettlement(page, settlement)

[8] 시작 페이지 이동:
  startPage = Math.ceil(startRow / PAGE_SIZE)
  if (startPage > 1):
    goToListPage(page, startPage)
```

### Step 6-1: 행 선택

> 각 results 항목에 대해 반복

```
[페이지 계산]
  targetPage = Math.ceil(r.rowNum / PAGE_SIZE)
  gridIdx = r.rowNum - (targetPage - 1) * PAGE_SIZE - 1

[페이지 이동 (필요 시)]
  if (targetPage !== currentPage):
    goToListPage(page, targetPage)
    -> page.evaluate: f_retrieveListBsnsExcutDetl(pageNum)
    -> sleep(3000) + dismissModals + waitForGrid('DD001002QGridObj')
    currentPage = targetPage

[인덱스 기반 행 선택: selectGridRow(page, gridIdx)]
  page.evaluate:
    const grid = DD001002QGridObj;
    const rows = grid.getDataRows();
    if (gridIdx >= rows.length) return null;
    const row = rows[gridIdx];
    const rv = grid.getRowValue(row);
    // 행 선택 우선순위:
    1. grid.focus(row)             // *** 반드시 이것 사용 ***
    2. grid.clickCell(row, 'excutPrposCn')  // focus 없을 때 폴백
    3. grid.selectRow(row)         // 최후 수단 (비권장)
    return rv;

[금액 불일치 검증]
  gridAmount = parseInt(rv.lastAmount || rv.excutSumAmount || '0')
  if (gridAmount !== r.amount):
    -> 동적 매칭 시도 (findAndSelectRow)

[동적 매칭: findAndSelectRow(page, amount, vendor, purpose)]
  page.evaluate:
    const grid = DD001002QGridObj;
    const rows = grid.getDataRows();
    for each row:
      rowAmt = parseInt(rv.lastAmount || rv.excutSumAmount || 0)
      if (rowAmt !== amount) continue;  // 금액 불일치 -> 스킵
      score = 1;                        // 금액 일치 기본점수
      if (vendor 첫5자 매칭) score += 3;
      if (purpose 첫10자 매칭) score += 2;
    -> 최고 점수 행에 grid.focus(row)
    return { rv, gridIdx }

  현재 페이지에서 못 찾으면 다른 모든 페이지 순차 탐색:
    for (pg = 1 to totalPages):
      goToListPage(page, pg)
      findAndSelectRow(page, amount, vendor, purpose)

  전체 실패: "SKIP: 그리드에서 찾을 수 없음 (이미 처리됨?)" -> errors++ + continue

sleep(500)
```

### Step 6-2: 세부내역검토 진입

```
최대 2회 시도 (attempt = 0, 1):

[focus 상태 확인]
  page.evaluate:
    const grid = DD001002QGridObj;
    return grid.getFocusedRow ? grid.getFocusedRow() !== null : true;
  -> null이면 행 재선택 (동적 or 인덱스)
  sleep(500)

[세부내역검토 버튼 클릭]
  page.click('#DD001002Q_detlListExmnt')
  sleep(3000)

[모달 체크]
  page.evaluate:
    const m = document.querySelector('.popupMask.on');
    return m ? m.textContent.trim() : null;

  if (모달텍스트 && /선택해주세요|선택하세요/.test(모달텍스트)):
    "행 선택 필요" -> dismissModals
    attempt 0이면: 행 재선택 -> continue
    attempt 1이면: errors++ + break

  기타 모달: dismissModals + sleep(1000)

[상세 그리드 대기]
  waitForGrid(page, 'DD001003SGridObj', 20000)
  -> true면 진입 성공

[실패 시 복구]
  recoverToList(page, listUrl, settlement) 호출
  -> 복구 성공: continue (다음 건)
  -> 복구 실패: break (전체 루프 종료)
```

### Step 6-3: 검토진행상태 변경

#### 적정 (검토완료) 입력

```javascript
// page.evaluate:
f_changeExmntPrgst("001");  // "001" = 검토완료
```

#### 확인 (보완요청) 입력

```javascript
// page.evaluate({ dis: disallowedAmount, cmt: commentText }):

// 1. 보완요청 상태 설정
f_changeExmntPrgst("002");  // "002" = 보완요청

// 2. 상세 그리드에서 불인정금액 + 의견 입력
const grid = DD001003SGridObj;
const rows = grid.getDataRows();
const row = rows[0];  // 상세 페이지는 항상 1행

// 불인정금액
if (dis > 0) {
  grid.setValue(row, "nrcgnAmount", String(dis));
}

// 검증검토의견 (줄바꿈 -> <br> HTML 변환)
const htmlComment = cmt.replace(/\n/g, "<br>");
grid.setValue(row, "exclexCn", htmlComment);
grid.setValue(row, "orgExclexCn", htmlComment);  // 원본 의견도 동일값 설정
```

의견 텍스트 출처:
- `overrides[r.rowNum].comment` 가 있으면 사용
- 없으면 `r.issues.join('; ')` 사용

### Step 6-4: 저장

```
[저장 버튼 클릭]
  page.click('#DD001003S_btnSave')
  sleep(500)

[확인 모달 대기 -- "저장하시겠습니까?" 등]
  waitModal(page, 5000)
  -> .popupMask.on 내 확인 버튼(button.fn.ok / .fn.ok / footer button) 자동 클릭

  미출현 시:
    WARNING 로그
    에러 메시지 확인: .popupMask.on .message 텍스트
    dismissModals
    errors++
    f_prevPage()로 목록 복귀 시도
    continue (다음 건)

[성공 모달 대기 -- "저장되었습니다" 등]
  sleep(2000)
  waitModal(page, 10000)
  성공 시: "저장 완료" 로그
  미출현 시: WARNING + dismissModals
  sleep(1000)
```

### Step 6-5: 목록 복귀

```
[1순위: f_prevPage()]
  page.evaluate(() => f_prevPage())

[2순위 (1순위 에러 시): 버튼 클릭]
  page.click('#DD001003S_btnPrevPage')

sleep(3000) + dismissModals(page) + sleep(500)

[목록 그리드 복귀 확인]
  waitForGrid(page, 'DD001002QGridObj')

  실패 시: recoverToList(page, listUrl, settlement) 호출
  -> 복구 실패: errors++ + break
  -> 복구 성공 + resetPage: currentPage = 1
```

### Step 6-6: 정산구분 재설정 + 재검색

```
함수: ensureSettlement(page, settlement)

*** 상세(DD001003S) -> 목록(DD001002Q) 복귀 시 정산구분이 초기화되므로 ***
*** 매 건 처리 후 반드시 호출! ***

[1] 라디오 ID 결정:
  interim -> 'DD001002Q_excclcSeCode_2'
  final   -> 'DD001002Q_excclcSeCode_1'

[2] 현재 상태 확인 + 변경:
  page.evaluate:
    const radio = document.getElementById(radioId);
    if (radio && !radio.checked) { radio.click(); return true; }
    return false;

[3] 변경되었으면 재검색:
  document.getElementById('DD001002Q_btnRetrieve').click()
  // 폴백: 텍스트 "검색" + offsetWidth > 0 버튼
  sleep(3000)
  dismissModals(page)
  waitForGrid(page, 'DD001002QGridObj', 15000)
```

### Step 6-7: 페이지 재이동 + 다음 건

```
[목록 복귀 후 행 수 확인]
  DD001002QGridObj.getDataRows().length

[페이지 재이동 (targetPage > 1 이고 행 수 = PAGE_SIZE)]
  goToListPage(page, targetPage)

[카운터 증가]
  processed++
  콘솔: "완료 (N/total)"

[다음 results 항목으로 진행]
```

---

## 에러 복구 로직 (recoverToList)

> 소스: `lib/review-generic.js` -- `recoverToList(page, listUrl, settlement)`
>
> 4단계 폴백 전략으로 목록(DD001002Q) 페이지 복귀 시도

### 전략 1: f_prevPage()

```
page.evaluate(() => f_prevPage())  // catch: 에러 무시
sleep(3000)
dismissModals(page)
waitForGrid(page, 'DD001002QGridObj', 5000)
성공 시: ensureSettlement(page, settlement) + return { ok: true, method: 'f_prevPage' }
```

### 전략 2: 목록 버튼 클릭

```
page.evaluate:
  버튼 탐색 (우선순위):
    1. document.getElementById('DD001003S_btnList')
    2. document.getElementById('DD001003S_btnPrevPage')
    3. [...document.querySelectorAll('button')].find(b => /목록|이전/.test(b.textContent.trim()))
  찾은 버튼 클릭
sleep(3000) + dismissModals
waitForGrid(page, 'DD001002QGridObj', 5000)
성공 시: ensureSettlement + return { ok: true, method: 'button' }
```

### 전략 3: URL 직접 이동

```
page.goto(listUrl, { waitUntil: 'domcontentloaded', timeout: 30000 })
sleep(3000)
dismissModals(page)

// 정산구분 라디오 먼저 설정 (중간정산이면)
if (settlement === 'interim'):
  document.getElementById('DD001002Q_excclcSeCode_2').click()

// 검색 버튼 클릭
document.getElementById('DD001002Q_btnRetrieve').click()
// 폴백: 텍스트 "검색" + offsetWidth > 0 버튼
sleep(4000) + dismissModals
waitForGrid(page, 'DD001002QGridObj', 15000)
성공 시: return { ok: true, method: 'goto+search', resetPage: true }
```

### 전략 4: 페이지 리로드

```
page.reload({ waitUntil: 'domcontentloaded', timeout: 30000 })
sleep(5000)
dismissModals(page)

// 정산구분 라디오 설정
if (settlement === 'interim'):
  document.getElementById('DD001002Q_excclcSeCode_2').click()

// 검색 버튼 클릭
document.getElementById('DD001002Q_btnRetrieve').click()
// 폴백
sleep(4000) + dismissModals
waitForGrid(page, 'DD001002QGridObj', 15000)
성공 시: return { ok: true, method: 'reload+search', resetPage: true }
```

### 모든 전략 실패

```
return { ok: false }
-> 호출자: "ERROR: 복구 불가, 중단" + break (전체 루프 종료)
```

> `resetPage: true`가 반환되면 호출자에서 `currentPage = 1`로 리셋.
> URL 이동이나 리로드 후에는 페이지네이션 상태가 1페이지로 돌아가기 때문.

---

## 전체 파이프라인 CLI

### 전체 실행 (수집 + 분석 + 입력)

```bash
node run-all.js \
  --inst=기관명 \           # 하위보조사업자명 (필수)
  --kw=사업키워드 \          # 사업명 매칭 키워드 (쉼표=AND)
  --dir=출력디렉토리명 \      # 기본: kw에서 자동 생성
  --year=2025 \             # 사업연도 (기본 2025)
  --project=사업설정명 \     # lib/configs/index.js 키
  --settlement=interim \    # interim(중간) | final(최종)
  --staff=이름1,이름2 \     # 참여인력 (자문료 중복체크)
  --skip-judge \            # Phase 5 건너뜀
  --skip-review \           # Phase 6 건너뜀
  --dry-run \               # Phase 6 DRY RUN
  --start=N                 # Phase 6 시작 행번호
```

### 검토결과만 입력

```bash
node lib/review-generic.js \
  --results=기관명-results.json \
  --save \                  # 없으면 DRY RUN
  --start=1 \              # 시작 행번호
  --pagesize=20 \          # 페이지 크기
  --settlement=interim     # interim | final
```

### 네비게이션만

```bash
node lib/navigate.js \
  --name=기관명 \
  --project=사업키워드 \
  --year=2025
```

### 심층분석만

```bash
node lib/deep-analyze.js \
  --data=기관명-data.json \
  --basis=보조금 \           # 보조금 | 혁신법
  --institution=기관명 \
  --limit=600000            # 자문료 한도
```

---

## 주요 교훈 / 주의사항

### IBSheet 그리드 조작 -- 반드시 숙지

| 규칙 | 설명 |
|------|------|
| **`grid.focus(row)` 사용 필수** | `grid.selectRow(row)` 호출 후 `getFocusedRow()`가 null을 반환하는 치명적 버그. 세부내역검토 진입이 불가능해짐 |
| `getDataRows()` 인덱스 주의 | 화면의 행 순서와 일치하지 않을 수 있음. `findAndSelectRow()`로 금액+업체명 동적 매칭 필수 |
| `getRowValue(row)` | 행의 모든 컬럼 값을 객체로 반환 |
| `grid.setValue(row, col, val)` | DD001003SGridObj 상세 그리드에서 불인정금액, 검토의견 입력에 사용 |
| `grid.clickCell(row, 'excutPrposCn')` | focus() 미지원 시 폴백 |

### 정산구분 리셋 -- 가장 빈번한 문제

```
문제: 상세(DD001003S) -> 목록(DD001002Q) 복귀 시 정산구분 라디오가 기본값으로 초기화
결과: 재검색 안 하면 그리드에 다른 정산구분 데이터가 표시됨
해결: 매 건 처리 후 반드시 ensureSettlement(page, settlement) 호출
      -> 라디오 확인 + 변경 시 재검색
```

### 페이지 크기 리셋

```
문제: 상세 -> 목록 복귀 시 페이지 크기가 20으로 리셋
해결: --pagesize=20 사용 (큰 페이지 크기를 유지하려고 하지 않음)
      goToListPage()로 올바른 페이지 번호로 이동
```

### evidenceSub 판정 규칙

| `evidenceSub` 값 | 의미 | 판정 영향 |
|-------------------|------|-----------|
| `""` (빈 문자열) | 증빙 없음 | files 필수 확인 |
| `"소득 지급명세서"` | 시스템 내장 증빙 (e나라도움 자동 연동) | files 없어도 적정 가능 |
| `"소득 지급명세서 외 N개"` | 시스템 내장 증빙 복수 | files 없어도 적정 가능 |
| `"기타(첨부파일필수확인)"` | 별도 첨부 필수 | files 없으면 부적정 |

### 모달 처리 원칙

```
- 모든 DOM 조작 후 dismissModals(page) 호출 권장
- e나라도움은 각종 작업 후 확인/경고 모달을 빈번히 표시
- 모달이 남아있으면 다음 클릭이 차단됨
- .popupMask.on 셀렉터로 활성 모달 탐지
- 확인 버튼 순서: button.fn.ok -> .fn.ok -> footer button
```

### 다운로드 경로 변환

```
맥북/리눅스 경로 -> Windows 경로 변환 필요 (CDP는 Windows Chrome에서 실행):
/mnt/c/projects/... -> C:\projects\...

변환 코드:
dlDir.replace(/^\/mnt\/([a-z])\//, (_, d) => `${d.toUpperCase()}:\\`).replace(/\//g, '\\')
```

### 대기 시간 종합표

| 작업 | 대기 시간 | 방법 | 비고 |
|------|-----------|------|------|
| 페이지 이동 후 | 3,000ms | `sleep` | 기본 DOM 로드 |
| 검색 실행 후 | 3,000~4,000ms | `sleep` | 서버 응답 대기 |
| 집행내역조회 클릭 후 | 4,000ms | `sleep` | 새 페이지 로드 |
| 세부내역검토 클릭 후 | 3,000ms | `sleep` | 상세 페이지 전환 |
| 저장 후 | 500ms + 모달대기 | `sleep` + `waitModal` | 확인+성공 2회 |
| f_prevPage() 후 | 3,000ms | `sleep` | 목록 복귀 |
| 다운로드 팝업 로드 | 2,000ms | `waitForTimeout` | DOM 완전 로드 |
| 다운로드 완료 폴링 | 최대 25,000ms | 1초 간격 루프 | 파일 감지까지 |
| 그리드 대기 (기본) | 최대 15,000ms | 500ms 간격 `waitForGrid` | |
| 그리드 대기 (상세) | 최대 20,000ms | 500ms 간격 `waitForGrid` | DD001003SGridObj |
| 페이지네이션 후 | 3,000ms | `sleep` | 그리드 데이터 로드 |
| 세션 연장 주기 | 300,000ms (5분) | `setInterval` | |
| 행 선택 후 | 500ms | `sleep` | focus 안정화 |
| 다운로드 간 간격 | 500ms | `waitForTimeout` | 서버 부하 방지 |

### 에러 패턴과 대응 종합

| 에러 현상 | 원인 | 대응 |
|-----------|------|------|
| "행을 선택해주세요" 모달 | `grid.focus()` 실패 또는 미호출 | 행 재선택 후 재시도 (최대 2회) |
| 상세 그리드 로드 실패 | 네트워크/세션 문제 | `recoverToList` 4단계 폴백 |
| 금액 불일치 | 그리드 순서 변경 (검색 후 정렬 등) | `findAndSelectRow` 동적 매칭 |
| 확인 모달 미출현 | 저장 실패 (유효성 검사 등) | `.message` 확인 후 목록 복귀 |
| 목록 복귀 실패 | 페이지 상태 비정상 | `recoverToList` (URL이동/리로드) |
| 정산구분 초기화 | 상세->목록 복귀 시 자동 리셋 | `ensureSettlement()` 매번 호출 |
| 세션 만료 | 5분 비활동 | `startKeepAlive()` 자동 연장 |
| XHR 프로토타입 손상 | e나라도움 내부 오버라이드 | `restoreXHR()` iframe 기법 |
| 다운로드 팝업 미열림 | 네트워크/팝업 차단 | 2초 대기 후 `context.pages()` 탐색 |
| ZIP 해제 실패 | 손상된 파일 | catch 무시 (파일 스킵) |
| `getFocusedRow()` null | `selectRow()` 사용한 경우 | **절대 `selectRow()` 사용 금지** -- `focus()` 사용 |

### 정산유형(settlement) 자동 판별 — 가장 흔한 실패 원인

```
핵심 규칙:
  사업상태 = "사업수행중" → --settlement=interim (중간정산, 라디오: DD001002Q_excclcSeCode_2)
  사업상태 = "집행마감"   → --settlement=final   (최종정산, 라디오: DD001002Q_excclcSeCode_1)

잘못된 정산유형을 선택하면:
  → DD001003S 상세페이지에 데이터가 로드되지 않음
  → 그리드 컬럼 헤더(비목명, 예금주명 등)만 0원으로 표시됨
  → goToNextItem에서 "다음" 버튼이 없어 루프 종료
  → 이걸 모르면 "0원 취소전표"로 오진단함

실제 사례 (2026-02-20):
  빔웍스 — 사업수행중인데 --settlement=final로 실행
  → 16건 전부 DD001003S 미진입 → 모든 건 SKIP
  → --settlement=interim으로 변경 후 16건 정상 처리

자동 결정 코드 (run-all.js Phase 0):
  if (selected.excutLmttResnNm === '집행마감') → final
  else → interim
  ※ --settlement CLI 인수로 수동 오버라이드 가능
```

### 0원 취소전표 / DD001003S 미진입 핸들링 (2026-02-20 추가)

```
상황: DD001003S에 진입했는데 그리드에 데이터가 없는 경우
  → typeof DD001003SGridObj === 'undefined' 또는 getDataRows().length === 0

원인:
  1) 0원 취소전표 (정상적 상황) — 금액이 0원인 건은 상세페이지가 없음
  2) 정산유형 불일치 (위 참조) — 이 경우 모든 건이 미진입
  3) 네트워크/세션 문제

처리 흐름 (run-all.js Phase 2):
  1. 루프 시작 시 DD001003S 존재 확인
     const onDD001003S = typeof DD001003SGridObj !== 'undefined' &&
       DD001003SGridObj.getDataRows().length > 0;
  2. 미진입 시 → SKIP 레코드 생성 (status='SKIP', comment='0원 취소전표')
  3. enterDetailFromList(page, itemIdx)로 다음 건의 DD001003S 진입 시도
  4. 반환값:
     - true → DD001003S 진입 성공 → continue (정상 처리)
     - 'on_list' → 다음 건도 목록에 남아있음 (연속 0원) → continue
     - false → 진입 실패 → break (루프 종료)

enterDetailFromList 상세:
  1. DD001002QGridObj에서 rowIdx행 focus
  2. DD001002Q_detlListExmnt (세부내역검토) 버튼 클릭
  3. DD001003SGridObj 로드 대기 (최대 15초)
  4. 로드 성공 → true 반환
  5. URL이 여전히 DD001002Q → 'on_list' 반환 (목록에 남음)
  6. 그 외 → false 반환 (실패)
```

### goToNextItem — 다음 건 이동 (5회 재시도 포함)

```
목적: DD001003S 상세 페이지에서 "다음 >" 버튼 클릭

흐름:
  1. 팝업/모달 전부 닫기 (.popupMask.on, .modal.show, .ui-dialog)
  2. "확인"/"닫기" 텍스트 버튼 클릭 (width>0, width<200)
  3. button/a/span/input[type="button"]/img 요소 중 "다음" 텍스트 포함 + 화면 보임(offsetParent !== null)
  4. 찾으면 클릭 → sleep(3000) → true 반환
  5. 못 찾으면 → 디버그 로그 (URL, 보이는 버튼 목록)
  6. 재시도 (최대 5회, 대기 1초+attempt×1초씩 증가)
  7. 전부 실패 → false 반환

실패 시 폴백 (메인 루프에서):
  → DD001002Q(목록 페이지)에 있으면 enterDetailFromList로 다음 건 진입 시도
```

### 심층분석 규칙 상세 (lib/rules/)

#### common/ (8개 — 모든 정산 공통)

| # | 파일 | Phase | 동작 | 플래그 |
|---|------|-------|------|--------|
| 010 | withholding-tax.js | cross-row | purpose에 "원천세" + 납부증빙(원천징수이행상황신고서 등) 미첨부 | `원천세_납부증빙_미첨부` |
| 020 | internal-salary.js | cross-row | purpose에 "내부인건비"/"흡수" + 산출근거(참여인력명단/급여대장/4대보험) 미비 | `내부인건비_산출근거_미비` |
| 030 | duplicate-detect.js | cross-row | OCR에서 동일 지출결의서 번호 + 같은 금액/거래처 | `재원변경_중복건` |
| 040 | consult-fee-calc.js | per-row | 자문료 8.8% 역산 (세전 = net/0.912), 사업별 한도 초과 여부 | `자문료_한도초과_교통비영수증_없음` / `자문료_교통비합산_영수증있음` |
| 050 | travel-report.js | per-row | 여비 건 + 출장복명서 미첨부 (파일명/OCR 텍스트 모두 검색) | `출장복명서_미첨부` / `출장신청서만_존재` |
| 060 | common-attachment.js | per-row | files=0 + cmnuseAtchmnflId 존재 (공용첨부 미수집) | `공용첨부파일_미수집` |
| 070 | zero-amount.js | per-row | totalAmount = 0 | `SKIP_0원` |
| 080 | no-evidence.js | per-row | files=0 + 시스템증빙(카드/세금계산서) 없음 + evidenceSub="" | `증빙_완전부재` |

#### 보조금/ (3개 + 사업 특화)

| # | 파일 | Phase | 동작 | 플래그 |
|---|------|-------|------|--------|
| 010 | card-usage.js | per-row | evidenceType에 "카드" + 보조금전용카드 아님 | `보조금전용카드_외_카드사용` (정보성) |
| 020 | contract-threshold.js | per-row | 물품/용역 금액 2천만원 초과 → 경쟁입찰, 3천만원 초과 → 계약서/검수조서 | `2천만원초과_경쟁입찰_확인필요` / `3천만원초과_계약서_미첨부` / `3천만원초과_검수조서_미첨부` |
| 030 | vat-check.js | per-row | vat > 0 이고 totalAmount = supply + vat | `부가세_포함_집행` |
| - | 사용자임상평가/salary-check.js | per-row | 인건비 건의 세전/세후 대조, 급여대장/이체증 확인 | `인건비_금액미확인` / `급여대장_미발견` / `이체증_미발견` / `과다지급의심` / `세후지급의심` |

### 사업별 설정 (lib/configs/index.js)

| 설정 키 | 시스템 | 법령 | 자문료 한도 | 회의비 한도 | 인건비 비율 |
|---------|--------|------|-----------|-----------|-----------|
| `디지털헬스케어` | e나라도움 | 보조금 | 600,000 | 50,000 | 30% |
| `지역책임의료기관` | e나라도움 | 보조금 | 400,000 | 50,000 | 30% |
| `국산의료기기교육훈련` | e나라도움 | 보조금 | 400,000 | 30,000 | 30% |
| `사용자임상평가` | e나라도움 | 보조금 | 400,000 | 50,000 | 50% |
| `캠퍼스타운` | 보탬e | 보조금 | 500,000 | 50,000 | 30% |

공통 설정값:
- `withholdingRate`: 8.8% (기타소득 = 소득세 6.6% + 주민세 2.2%)

config 필드 설명:

| 설정 키 | 설명 | 기본값 |
|---------|------|--------|
| `legalBasis` | 적용 법령 (`'보조금'` / `'혁신법'`) | `'보조금'` |
| `system` | 시스템 (`'enaradomum'` / `'botame'` / `'ezbaro'`) | |
| `consultFeeLimit` | 1일 자문료 한도 (원) | 600,000 |
| `meetingFeePerPerson` | 1인당 회의비 한도 (원) | 50,000 |
| `salaryCapRatio` | 인건비 상한 비율 (총사업비 대비) | 0.30 |
| `withholdingRate` | 기타소득 원천세율 (8.8%) | 0.088 |
| `guidelinesPath` | 사업별 가이드라인 .md 경로 | |

### e나라도움 메뉴 트리 (웹사이트 네비게이션)

```
e나라도움 (https://gvs.gosims.go.kr)
└─ 좌측 메뉴
   └─ 집행관리 (EXE)
      └─ 정산검토
         └─ 정산검토관리
            ├─ [점검대상사업조회(검증기관)] ← DD001005Q ★ 시작점
            │   - URL: /exe/dd/dd001/getDD001005QView.do?PJTCD=EXE
            │   - 즐겨찾기 이동: f_redirectToBookmark("...", "EXE")
            │   - 기관명/사업연도 검색 → 사업 목록 그리드 (DD001005QGridObj)
            │   - 사업 선택 후 [집행내역조회] 버튼 클릭
            │
            ├─ [사업별집행내역조회] ← DD001002Q
            │   - 집행건 목록 그리드 (DD001002QGridObj)
            │   - 정산구분 라디오: 최종정산(009) / 중간정산(002)
            │   - 페이지네이션: f_retrieveListBsnsExcutDetl(pageNum)
            │   - 행 선택 후 [세부내역검토] 버튼 클릭
            │
            └─ [세부내역검토] ← DD001003S
                - 상세 정보 그리드 (DD001003SGridObj) — 항상 1행
                - 상단: 집행용도, 증빙구분, 거래처, 금액 등
                - [개별파일첨부] 버튼 → DB003002S 팝업 (증빙파일 다운로드)
                - [공용파일첨부] 버튼 → DB003002S 팝업 (공용증빙 다운로드)
                - 하단: 검토상태 변경 (f_changeExmntPrgst)
                - [저장] 버튼 → DD001003S_btnSave
                - [< 이전] / [다음 >] 버튼 → 건별 순차 이동
                - [목록] 버튼 → DD001002Q 복귀
```

### run-all.js v2 — 건별 순차 처리 vs review-generic.js — 목록 기반 처리

```
run-all.js v2 (현재 메인):
  Phase 1에서 DD001003S 진입 → "다음 >" 버튼으로 건별 순차 이동
  장점: 정산구분 초기화 문제 없음 (상세 페이지에서 계속 이동)
  단점: N번째부터 시작하려면 "다음" N-1번 클릭 필요 (--start 옵션)
  적합: 전체 파이프라인 (수집+분석+입력) 일괄 실행

review-generic.js (입력 전용):
  목록(DD001002Q)에서 행 선택 → DD001003S → 입력 → 저장 → 목록 복귀 → 반복
  장점: 특정 행만 선택적 입력 가능, results.json 기반 일괄 입력
  단점: 매번 정산구분 재설정 필요 (ensureSettlement)
  적합: 이미 data/results가 있고 입력만 필요한 경우
```

### 완료 기관 처리 이력 (참조용)

| 기관 | 사업 | 건수 | 적정 | 확인 | 정산유형 | 소요시간 | 비고 |
|------|------|------|------|------|----------|----------|------|
| 대구경북재단 | 디지털헬스케어 | 180 | 137 | 35 | 최종 | - | 첫 기관, 수동+자동 혼합 |
| 연세대 | 교육훈련 | 642 | 535 | 107 | 최종 | 6시간 | 세션 끊김 2회 |
| 아주대 | 교육훈련 | 431 | 380 | 49 | 최종 | 263분 | R62 크래시 1회 |
| 태웅메디칼 | 사용자임상평가 | 12 | 11 | 1 | 최종 | 8.7분 | |
| 빔웍스 | 사용자임상평가 | 16 | 4 | 12 | **중간** | 6.4분 | 사업수행중→중간정산 |
| 알앤엑스 | 사용자임상평가 | 71 | 60 | 11 | 최종 | 37.7분 | |
| 고려대 | 캠퍼스타운(보탬e) | 685 | 573 | 3 | - | 63분 | 보탬e 시스템 |
