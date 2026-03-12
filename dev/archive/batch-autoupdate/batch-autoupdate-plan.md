# Tessera — 배치 자동화 + GitHub Releases 자동 업데이트 계획

## 목적

tessera.exe를 실무 배포 가능한 상태로 완성:
1. 엑셀 업로드 → 수백 개 과제 순차 자동 실행 (배치 자동화)
2. git push → GitHub Actions → .exe 빌드 → GitHub Release (CI/CD)
3. 앱 실행 시 자동 업데이트 체크 + 설치 (electron-updater)

## 아키텍처

```
개발자(비보북)
  └─ 코드 수정 → git push

GitHub Actions
  └─ Windows runner에서 electron-builder
  └─ .exe + latest.yml → GitHub Release 자동 생성

직원 PC
  └─ tessera.exe 실행 → autoUpdater가 GitHub Release 체크
  └─ 신버전 있으면 → 백그라운드 다운로드 → "업데이트 설치" 알림
  └─ 재시작하면 새 버전 적용
```

## 섹션 1: 배치 러너 (백엔드)

- **목적**: 엑셀 업로드 → 전체 과제 순차 자동 실행
- **파일**:
  - `server/batch-runner.js` (신규) — 배치 큐 + 순차 실행 엔진
  - `server/routes/api-ezbaro.js` (수정) — 엑셀 파일 저장 + batch-start/stop/status API
  - `server/index.js` (수정) — batch-runner 등록
- **구현**:
  - BatchRunner 클래스: queue[], running, currentIdx
  - robotManager.start() → exit 이벤트 → 다음 기관 자동 시작
  - 에러 시 skip + 로그, 다음 진행
  - 엑셀 파싱 결과를 `projects/ezbaro-batch.json`에 파일 저장 (재시작 후에도 유지)
  - batch-start: 필터(담당자/상태)된 과제 목록을 큐 등록 + 실행
  - batch-stop: 현재 로봇 정지 + 큐 중단
  - batch-status: 전체 진행률 + 기관별 상태
- **예상 문제점**: robot-manager가 같은 시스템 중복 실행 차단 → 순차 실행이므로 문제없음
- **완료기준**: curl로 batch-start → 2개 과제 순차 실행 → batch-status에서 done 확인
- **의존**: 없음

## 섹션 2: 배치 UI (프론트엔드)

- **목적**: 엑셀 업로드 → 일괄 시작 → 진행률 실시간 표시
- **파일**:
  - `web/src/app/ezbaro/page.tsx` (수정) — 일괄 시작 버튼 + 배치 진행 패널
- **구현**:
  - "전체 출격" 버튼 (필터된 과제 일괄 시작)
  - 배치 진행 패널: 전체 N/M, 현재 기관명, 기관별 상태 (대기/진행/완료/에러)
  - "긴급 정지" 버튼
  - 5초 폴링으로 batch-status 갱신
- **예상 문제점**: Next.js 정적 빌드(web/out/) 필요 → 프론트 수정 후 `cd web && npm run build`
- **완료기준**: UI에서 엑셀 업로드 → 전체 출격 → 진행률 실시간 표시
- **의존**: 섹션 1

## 섹션 3: GitHub Actions CI/CD

- **목적**: git push → 자동 빌드 → GitHub Release
- **파일**:
  - `.github/workflows/build.yml` (신규) — Windows electron-builder 워크플로우
  - `package.json` (수정) — publish 설정 추가
  - `electron-builder.yml` (수정) — publish.provider: github
- **구현**:
  - trigger: push to main (tag v* 또는 모든 push)
  - Windows runner: actions/setup-node → npm ci → cd web && npm run build → electron-builder --publish always
  - GH_TOKEN: repo secret
  - 산출물: .exe + latest.yml → GitHub Release
- **예상 문제점**:
  - Playwright Chromium 번들링 → `scripts/copy-chromium.js` 실행 필요 (CI에서도)
  - 빌드 시간 10-20분 → 캐싱으로 단축 가능
  - private repo면 GH_TOKEN 스코프 주의
- **완료기준**: git push → Actions 성공 → Release에 .exe + latest.yml 확인
- **의존**: 없음

## 섹션 4: electron-updater 통합

- **목적**: 앱 시작 시 자동 업데이트 체크 + 다운로드 + 설치
- **파일**:
  - `electron/main.js` (수정) — autoUpdater 설정
  - `package.json` (수정) — electron-updater 의존성 추가
- **구현**:
  - `electron-updater` 패키지 설치
  - app.whenReady() 후 `autoUpdater.checkForUpdatesAndNotify()`
  - 이벤트: update-available → 로그, update-downloaded → dialog로 "재시작" 안내
  - 개발 모드에서는 비활성화
- **예상 문제점**:
  - NSIS per-machine 설치 시 UAC 프롬프트 → per-user로 설정
  - 업데이트 중 자동화 실행 중이면 → 배치 완료 후 재시작 유도
- **완료기준**: 구버전 앱 실행 → 신버전 Release 존재 → 자동 다운로드 → 재시작 후 신버전 확인
- **의존**: 섹션 3

## 섹션 5: 검증 + 배포

- **목적**: 전체 E2E 검증 + 회사 PC 배포
- **구현**:
  1. 비보북에서 서버 실행 → curl 배치 테스트
  2. git push → Actions 빌드 → Release .exe 다운로드
  3. 회사 PC에 설치 → 이지바로 로그인 → 엑셀 업로드 → 배치 실행
  4. 코드 수정 → push → 앱 자동 업데이트 확인
- **완료기준**: 회사 PC에서 엑셀 업로드 → 자동 배치 → 자동 업데이트 전부 동작
- **의존**: 섹션 1-4

## 리스크

| 리스크 | 영향 | 대응 |
|--------|------|------|
| GitHub Actions Windows runner 비용 | private repo: 2,000분/월 무료 | 충분. 빌드당 15분 × 130회/월 |
| Playwright Chromium CI 번들링 실패 | .exe에 브라우저 미포함 | copy-chromium.js + 캐싱 |
| 정부사이트 Playwright 차단 | 로그인 불가 | channel: 'chrome' fallback (이미 구현) |
| 배치 중 이지바로 세션 만료 | 자동화 중단 | keepAlive 이미 구현됨 |
| 기관명 매칭 실패 (ieNm 에러) | 기관 skip | 에러 로그 + 다음 기관 진행 |
