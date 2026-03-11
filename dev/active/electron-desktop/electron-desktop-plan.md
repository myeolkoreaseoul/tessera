# Tessera Desktop — CDP 제거, Electron+Playwright 브라우저 앱

## 목적
CDP 원격 연결 의존성 제거. Electron 앱으로 패키징하여 설치만 하면 누구든 사용 가능하게 전환.

## 아키텍처
```
┌─────────────────────────────────────┐
│ Tessera Desktop (.exe)              │
│                                     │
│  ┌─ Electron BrowserWindow ───────┐ │
│  │  Next.js UI (localhost:3500)   │ │
│  └────────────────────────────────┘ │
│                                     │
│  ┌─ Express Server (in-process) ──┐ │
│  │  REST API + WebSocket          │ │
│  └────────────────────────────────┘ │
│                                     │
│  ┌─ Playwright Chromium ──────────┐ │
│  │  창1: e나라도움 (port 9444)     │ │
│  │  창2: 보탬e    (port 9445)     │ │
│  │  창3: 이지바로  (port 9446)     │ │
│  └────────────────────────────────┘ │
└─────────────────────────────────────┘
```

---

## 섹션 1: browser-provider.js 생성

- **목적**: Playwright launchPersistentContext() 래퍼. 시스템별 프로필 분리, 캐시 관리.
- **파일**: `lib/browser-provider.js` (신규, ~50줄)
- **구현**:
  - `launchLocal(port)` — port(9444/9445/9446)에 해당하는 시스템별 userDataDir 결정
  - `playwright.chromium.launchPersistentContext(userDataDir, options)` 호출
  - options: `headless: false`, `--disable-blink-features=AutomationControlled`, 일반 Chrome user-agent
  - Map 캐시: port → context. 이미 열려있으면 재사용
  - `closeAll()` — 모든 context 종료 (앱 종료 시)
  - `getContext(port)` — 캐시에서 context 반환
- **예상 문제점+해결책**:
  - 정부사이트 Playwright 감지 → `channel: 'chrome'` fallback 옵션 제공
  - userDataDir 잠금 충돌 → port별 독립 디렉토리로 회피
- **완료기준**: `launchLocal(9444)` 호출 시 Chromium 창이 뜨고, 재호출 시 기존 context 재사용
- **의존**: 없음

## 섹션 2: utils.js + constants.js 수정

- **목적**: 환경변수 `TESSERA_MODE=electron`으로 CDP/로컬 분기
- **파일**: `lib/utils.js` (수정, 6줄 추가), `lib/constants.js` (수정, 3줄 추가)
- **구현**:
  - `utils.js` `connectBrowser(port)`:
    - `if (process.env.TESSERA_MODE === 'electron')` → `browserProvider.launchLocal(port)` 호출
    - else → 기존 CDP 코드 유지
  - `constants.js`:
    - `LOCAL_DL_DIR` export: `path.join(process.cwd(), 'downloads')`
    - 기존 `REMOTE_DL_WIN`은 CDP 모드용으로 보존
- **예상 문제점+해결책**:
  - constants.js에서 electron 전용 모듈 import 불가 → 순수 path 연산만 사용
- **완료기준**: `TESSERA_MODE=electron` 시 connectBrowser가 로컬 Chromium 반환
- **의존**: 섹션 1

## 섹션 3: Electron 셸 (main.js + preload.js)

- **목적**: Electron 메인 프로세스. Express 서버 in-process 실행, BrowserWindow로 UI 로드.
- **파일**: `electron/main.js` (신규, ~80줄), `electron/preload.js` (신규, ~20줄), `package.json` (수정)
- **구현**:
  - `main.js`:
    - `process.env.TESSERA_MODE = 'electron'` 설정
    - Express 서버 require하여 in-process 실행
    - `BrowserWindow` 생성, `http://localhost:3500` 로드
    - `app.on('before-quit')` → `browserProvider.closeAll()`
    - 메뉴바 최소화
  - `preload.js`:
    - `contextBridge.exposeInMainWorld('tessera', { ... })`
    - IPC: 브라우저 열기, 상태 확인
  - `package.json`: `"main": "electron/main.js"`, electron + electron-builder devDependencies 추가, scripts 추가
- **예상 문제점+해결책**:
  - Express 포트 충돌 → 이미 사용 중이면 에러 다이얼로그 표시
  - Playwright Chromium과 Electron Chromium 충돌 → 별도 프로세스이므로 문제 없음
- **완료기준**: `npx electron .` 실행 시 UI 창이 뜨고 localhost:3500 로드됨
- **의존**: 섹션 1, 2

## 섹션 4: run-all.js 다운로드 경로 + robot-manager.js 조정

- **목적**: 다운로드를 로컬 경로로 전환, fork() 대신 in-process 실행 옵션
- **파일**: `run-all.js` (수정, ~10줄), `server/robot-manager.js` (수정, ~20줄)
- **구현**:
  - `run-all.js`:
    - electron 모드: `REMOTE_DL_LOCAL` → `path.join(process.cwd(), 'downloads')`
    - `Page.setDownloadBehavior` → 로컬 절대 경로 설정
    - sshfs 관련 코드 조건부 스킵
  - `robot-manager.js`:
    - electron 모드: `fork()` 유지하되 `TESSERA_MODE` 환경변수 전달
    - 브라우저 context는 browserProvider의 Map 캐시로 프로세스 간 공유 불필요 (각 fork가 자체 context 생성)
- **예상 문제점+해결책**:
  - fork 시 Playwright context 공유 불가 → fork된 프로세스에서 browserProvider가 새 context 생성하지만, 이미 열린 브라우저의 CDP로 연결하는 방식으로 해결 가능. 또는 v1은 in-process 실행
  - 다운로드 경로 권한 → mkdirSync recursive
- **완료기준**: electron 모드에서 파일 다운로드가 로컬 downloads/에 저장됨
- **의존**: 섹션 2, 3

## 섹션 5: 브라우저 제어 API + UI

- **목적**: 브라우저 열기/상태 API + UI 버튼
- **파일**: `server/routes/api-browser.js` (신규), `server/index.js` (수정), Next.js 컴포넌트 (Gemini 위임)
- **구현**:
  - `api-browser.js`:
    - `POST /api/browser/launch` — systemId → browserProvider.launchLocal()
    - `GET /api/browser/status` — 시스템별 브라우저 상태
    - `POST /api/browser/close` — 특정 시스템 브라우저 닫기
  - `server/index.js`: 라우트 등록
  - Next.js UI: 프론트엔드 → Gemini+Stitch 위임
- **예상 문제점+해결책**:
  - 브라우저 열기 실패 시 → 에러 응답 + WebSocket 알림
- **완료기준**: API로 Chromium 열리고 UI에서 상태 확인 가능
- **의존**: 섹션 1, 3

## 섹션 6: electron-builder 패키징

- **목적**: .exe 인스톨러 생성
- **파일**: `electron-builder.yml` (신규), `package.json` (빌드 설정)
- **구현**:
  - appId: `com.tessera.desktop`, productName: `Tessera`
  - Playwright Chromium → `extraResources`
  - NSIS 인스톨러, `asar: false`
  - scripts: `electron:dev`, `electron:build`
- **예상 문제점+해결책**:
  - 앱 크기 350MB+ → NSIS 압축 ~150MB. 1회 설치 수용
  - Playwright Chromium 경로 해결 → `PLAYWRIGHT_BROWSERS_PATH` 환경변수
- **완료기준**: `npm run electron:build` → dist/에 .exe 생성
- **의존**: 섹션 3, 4, 5

## 섹션 7: 최종 리뷰

- codex + gemini 병렬 리뷰
- 이슈 수정 → 재리뷰 (최대 10회)
