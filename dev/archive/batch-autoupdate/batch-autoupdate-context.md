# Tessera 배치 자동화 + 자동 업데이트 — 컨텍스트

## 설계 결정

1. **배치 실행 방식**: robot-manager의 EventEmitter exit 이벤트를 활용한 순차 실행 (동시 실행 X, 순차 체이닝)
2. **데이터 영속성**: 엑셀 파싱 결과를 `projects/ezbaro-batch.json`에 파일 저장 (현재는 메모리 only → 재시작 시 소실)
3. **업데이트 방식**: GitHub Releases + electron-updater (업계 표준, Cloudflare R2나 funnel 방식 대신)
4. **설치 타입**: NSIS per-user (UAC 프롬프트 회피)
5. **프론트엔드**: Gemini CLI + Stitch MCP로 위임 (looprun 규칙)

## 발견사항

- `server/routes/api-ezbaro.js`: `let parsedData = null;` (line 27-28) — 메모리 전용, 파일 저장 필요
- `server/robot-manager.js`: 같은 시스템 중복 실행 차단 (line 27-31) — 순차이므로 문제없음
- `run-ezbaro.js`: CLI args `--inst`, `--task` 필수. `main()` export됨 (line 503)
- `electron/main.js`: TESSERA_MODE=electron 설정, Express in-process, IPC 핸들러 구현됨
- `lib/browser-provider.js`: launchLocal/connectLocal 분리 (메인 프로세스 / fork 프로세스)
- `electron-builder.yml`: NSIS, asar:false, extraResources playwright-chromium

## 관련 파일

| 파일 | 역할 | 수정 여부 |
|------|------|-----------|
| `server/batch-runner.js` | 배치 큐 엔진 | 신규 |
| `server/routes/api-ezbaro.js` | 이지바로 API | 수정 (파일 저장 + batch API) |
| `server/index.js` | Express 서버 | 수정 (batch-runner 등록) |
| `server/robot-manager.js` | 로봇 프로세스 관리 | 참조 (수정 없음) |
| `run-ezbaro.js` | 이지바로 파이프라인 | 참조 (수정 없음) |
| `web/src/app/ezbaro/page.tsx` | 이지바로 UI | 수정 (배치 패널) |
| `.github/workflows/build.yml` | CI/CD | 신규 |
| `electron-builder.yml` | 빌드 설정 | 수정 (publish) |
| `electron/main.js` | Electron 메인 | 수정 (autoUpdater) |
| `package.json` | 의존성 | 수정 (electron-updater) |

## 코드 리뷰 결과

### 섹션 1 Codex 리뷰 → 수정 완료
1. **batch-start가 실패해도 ok:true 반환** → startBatch()에서 첫 task 실패 시 throw하도록 수정
2. **stopBatch()가 로봇 종료 전 finish** → stopping 플래그 추가, exit 이벤트에서 finish 처리
3. **수동 stop 시 배치 계속 진행** → SIGTERM/killed 감지 시 배치도 함께 중단
4. **CSV 허용 문제** → 파일 필터에서 .csv 제거

### 섹션 2 Codex 리뷰 → 핵심 2건 수정
1. **fetchBatchStatus unmount 후 setState** → mounted ref guard 추가, 배치 활성 시에만 폴링
2. **stopping 상태에서 start 버튼 활성화** → stopping도 disabled 조건에 포함
- #3(non-JSON 응답), #5(poll 실패 시 stale), #6(any 타입) — 서버가 항상 JSON 반환 + 3초 자동복구 + 기존 코드 동일 패턴이므로 보류

### 섹션 2 셀프체크
- **빠진 것?**: 프론트엔드 배치 UI 기능 전체 구현 완료 (출격/정지/진행률/폴링)
- **연관 파일 영향?**: ezbaro/page.tsx만 수정. 백엔드 API 계약 일치 확인 (batch-start/stop/status)
- **빌드/테스트**: `npx next build` 성공, 정적 export 완료

### 섹션 3 Codex 리뷰 → 3건 수정
1. **web 의존성 캐시 누락** → cache-dependency-path에 web/package-lock.json 추가
2. **Playwright Chromium 캐시 누락** → actions/cache@v4로 ms-playwright 디렉토리 캐시
3. **releaseType 미설정 (기본 draft)** → releaseType: release 명시

### 섹션 3 셀프체크
- **빠진 것?**: package.json에 repository 필드 추가 (electron-builder 호환성)
- **연관 파일 영향?**: publish config의 owner/repo가 실제 GitHub repo와 일치 확인
- **빌드/테스트**: YAML 구문 검증 통과

### 섹션 4 Codex 리뷰 → 4건 수정
1. **quitAndInstall vs before-quit 레이스** → quitAndInstall 전에 cleanup 수행, isQuitting guard로 중복 방지
2. **autoInstallOnAppQuit=true로 "나중에" 무효화** → false로 변경, 사용자 선택 존중
3. **checkForUpdatesAndNotify 중복 알림** → checkForUpdates()로 변경 (커스텀 dialog만 사용)
4. **재진입/종료 상태 guard 부재** → isQuitting + mainWindow null 체크 추가

### 섹션 4 셀프체크
- **빠진 것?**: "나중에" 선택 시 다음 앱 시작에서 재체크됨. autoInstallOnAppQuit=false이므로 정상 종료 시 강제 설치 안 됨
- **연관 파일 영향?**: before-quit에 isQuitting guard 추가. quitAndInstall 경로에서 먼저 cleanup → before-quit는 skip
- **빌드/테스트**: electron-updater 모듈 로드 성공

### 섹션 5 Codex 리뷰 — 해당 없음 (검증/배포 단계, 신규 코드 없음)

### 섹션 5 검증 결과
- **git push**: 성공 (c298d70). workflow 파일은 PAT workflow scope 부재로 별도 push 필요
- **서버 스모크 테스트**: health OK, batch-status OK (빈 상태 정상 반환)
- **남은 작업**: gh auth에 workflow scope 추가 → build.yml push → tag → Actions 빌드 → 회사 PC E2E

### 섹션 5 셀프체크
- **빠진 것?**: workflow push가 블로킹 — PAT scope 해결 필요. 나머지 코드는 모두 push 완료
- **연관 파일 영향?**: 없음 (push 단계)
- **빌드/테스트**: API 스모크 테스트 통과

### 섹션 1 셀프체크
- **빠진 것?**: 엣지 케이스 (첫 task 실패, 수동 stop, 전체 실패) 모두 처리됨
- **연관 파일 영향?**: createEzbaroRoutes 시그니처 변경 — 호출처 2곳 (api-ezbaro.js, index.js) 모두 수정됨
- **빌드/테스트**: `node -e` 모듈 로드 성공. 다음 섹션 블로커 없음
