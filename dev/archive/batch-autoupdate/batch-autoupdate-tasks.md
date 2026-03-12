# Tessera 배치 자동화 + 자동 업데이트 — 작업 체크리스트

- [x] 섹션 1: 배치 러너 (백엔드) — batch-runner.js + api-ezbaro.js + index.js
- [x] 섹션 2: 배치 UI (프론트엔드) — ezbaro/page.tsx (Gemini+Stitch 위임)
- [x] 섹션 3: GitHub Actions CI/CD — build.yml + electron-builder.yml
- [x] 섹션 4: electron-updater 통합 — main.js + electron-updater 패키지
- [x] 섹션 5: 검증 + 배포 — git push 완료 + API 스모크 테스트 통과
  - [x] git commit + push (workflow 제외 — PAT scope 필요)
  - [x] 서버 모듈 로드 테스트 통과
  - [x] API 스모크 테스트 (health, batch-status) 통과
  - [ ] GitHub workflow push (PAT workflow scope 추가 후)
  - [ ] git tag v1.1.0 → Actions 빌드 → Release .exe
  - [ ] 회사 PC E2E: 엑셀 업로드 → 배치 실행 → 자동 업데이트
- [ ] 최종 리뷰
