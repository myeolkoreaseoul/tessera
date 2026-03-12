# Tessera Progress

## 2026-03-12
- v1.3.0 배포 완료 (GitHub Releases + 회사PC 설치 확인)
- 배치 자동화 (엑셀 업로드 → 순차 실행), GitHub Actions CI/CD, electron-updater 자동 업데이트
- 프론트엔드 QA: Codex/Gemini 리뷰 + Playwright headless 36개 테스트 통과
- 수정: 네비게이션 버튼 추가(/ezbaro, /results), planned 시스템 출격 차단, launch URL param 동기화, 버전 표시
- 이지바로 배치 UX 전면 개편: 담당자 필수 → 정렬 기준(미확정순/보완완료순) → 작업순번 확정 → 배치 실행
- Codex 리뷰 8개 이슈 수정: 에러 응답 필드, 폴링 무한루프, 진행률 100% 미달, 업로드 시 상태 초기화, 빈 담당자 필터
- Playwright headless 12개 테스트 전부 통과
- v1.5.0 수동 업데이트 버튼, 파일명 한글 인코딩 fix, 담당자 전체 표시
- 이지바로 UX 완성: 상태 유지(페이지 이동 후 복귀), 원스텝 출격(Chrome 자동+로그인 모달), 초기화 버튼
- electron-updater 업데이트 시스템 근본 수정: private repo 404 → public 전환, 이벤트 push 방식 재구현, 디버그 로그 추가
- v1.6.5→v1.6.6 자동 업데이트 검증 완료 (회사PC SSH 직접 확인: 감지+다운로드+다이얼로그 정상)
