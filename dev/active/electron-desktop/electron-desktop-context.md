# Tessera Desktop — 컨텍스트

## 설계 결정

1. **환경변수 분기 (`TESSERA_MODE=electron`)**: 기존 5,800줄 자동화 코드를 수정하지 않고, connectBrowser() 진입점에서만 분기
2. **port 번호 유지**: 9444/9445/9446을 논리적 시스템 ID로 계속 사용 (기존 코드 호환)
3. **launchPersistentContext**: 쿠키/세션 유지를 위해 일반 launch() 대신 사용. 시스템별 userDataDir 분리
4. **Express in-process**: Electron 메인 프로세스에서 Express 서버를 직접 실행. 별도 프로세스 불필요
5. **fork() + CDP 아키텍처**: 메인 프로세스에서 `launchLocal()` → `--remote-debugging-port` 노출 (19444/19445/19446). fork된 로봇 프로세스에서 `connectLocal()` → CDP로 연결하여 같은 브라우저 공유. 사용자가 UI에서 먼저 브라우저를 열어야 로봇 실행 가능.
6. **다운로드 경로 보안**: `path.resolve(BASE_DIR).startsWith(REMOTE_DL_LOCAL)` 검증으로 경로 탈출 방지

## 발견사항

- `connectBrowser()` — `lib/utils.js:120-126` — CDP 연결 진입점
- `REMOTE_DL_WIN` — `lib/constants.js:8` — Windows 다운로드 경로
- `REMOTE_DL_LOCAL` — `run-all.js:85` — sshfs 마운트 경로
- `downloadFromPopup()` — `run-all.js:147-240` — 다운로드+파일대기 로직
- `RobotManager.start()` — `server/robot-manager.js` — `child_process.fork()` 사용
- Express 서버 — `server/index.js` — port 3500
- Next.js 정적 빌드 — `web/out/` — Express에서 서빙

## 관련 파일

| 파일 | 변경 유형 | 역할 |
|------|-----------|------|
| `lib/browser-provider.js` | 신규 | Playwright 로컬 브라우저 래퍼 |
| `lib/utils.js` | 수정 | connectBrowser() 분기 |
| `lib/constants.js` | 수정 | 다운로드 경로 분기 |
| `run-all.js` | 수정 | 다운로드 경로 로컬화 |
| `server/robot-manager.js` | 수정 | TESSERA_MODE 전달 |
| `server/routes/api-browser.js` | 신규 | 브라우저 제어 API |
| `server/index.js` | 수정 | 라우트 등록 |
| `electron/main.js` | 신규 | Electron 메인 프로세스 |
| `electron/preload.js` | 신규 | contextBridge IPC |
| `electron-builder.yml` | 신규 | 패키징 설정 |
| `package.json` | 수정 | electron 의존성 + 스크립트 |

## 코드 리뷰 결과

### 최종 리뷰 (Codex + Gemini 병렬)

**수정 완료:**
1. High: 서버 0.0.0.0 바인딩 → Electron 모드에서 127.0.0.1로 제한
2. High: will-navigate 정책 없음 → 외부 탐색 차단 + setWindowOpenHandler deny
3. High: LOCAL_DL_DIR가 패키징 시 읽기 전용 경로 → ~/.tessera/downloads 로 변경
4. Medium: electron:build에 web 빌드 누락 → cd web && npm run build 추가
5. Medium: copy-chromium.js 플랫폼 미체크 → 경고 메시지 추가

**수정 보류 (기존 코드 이슈, 이번 마이그레이션 범위 밖):**
- robot-manager.js SIGTERM/SIGKILL Windows 호환 — 기존 코드 이슈. 별도 작업으로 처리
- api-robots.js 인증 없음 — 기존 코드 이슈. Electron 모드에서는 127.0.0.1 바인딩으로 완화
- 앱 종료 시 fork된 프로세스 정리 — v2에서 처리

### 섹션별 Codex 리뷰 요약
- 섹션 1: 4건 (race condition, browser 타입, close 에러, getStatus) → 모두 반영
- 섹션 2: 1건 (process.cwd → __dirname) → 반영
- 섹션 3: 5건 (서버 실패 후 계속, HTTP 미종료, IPC 검증, close 에러, sandbox) → 모두 반영
- 섹션 4: 3건 (fork+CDP race, path escape, context 미검증) → 모두 반영
- 섹션 5: 4건 (localhost 제한, body 검증, 에러 형식, 에러 노출) → 모두 반영
- 섹션 6: 4건 (env 순서, dev/packaged 분기, 하드코딩, 복사 범위) → 모두 반영
