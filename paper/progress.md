# 페이퍼 정산 개발 및 실행 현황 (Progress Log)

## 📌 실행 환경 및 경로 구조 (중요)
- **개발/실행 엔진 (뇌):** 리눅스 (MacBook SSH)
- **파일 저장소 (몸):** 윈도우 (Company PC)
- **연결 고리:** `/home/john/company-pc/downloads/` 마운트 포인트
  - 윈도우의 `C:\projects\e-naradomum-rpa\downloads`와 동기화됨.
  - 별도의 파일 복사/이동 없이 이 경로를 통해 윈도우 파일에 접근 가능.

## ✅ 개발 완료 항목
- **핵심 엔진:**
  - `run-clinical.js`: 사용자 임상평가 전용 파이프라인 (Smart Collector + Rules + Gemini)
  - `smart-collector.js`: 맥락 기반 증빙 자동 수집 (경로/파일명/내용 분석)
  - `write-result-to-excel.js`: 원본 엑셀에 판정 결과(G/H열) 기입
- **검증 로직:**
  - `salary-check.js`: 인건비 세전/세후 비교, 과다지급 탐지, 수령인 오매칭 방지
- **기준:**
  - `guidelines/.../사용자임상평가.md`: 비목별 필수 증빙 및 검토 기준 수립

## ⏳ 진행 중
- **강남세브란스병원 실전 정산:**
  - 데이터 경로: `/home/john/company-pc/downloads/강남세브란스/` (추정)
  - 실행 명령: `node paper/run-clinical.js --excel="..." --evidence="..."`

## 🚀 다음 단계
1. `강남세브란스` 폴더 내의 정확한 엑셀 파일명과 증빙 폴더명 파악.
2. `dry-run`으로 경로 및 파일 인식 테스트.
3. 실전 정산 수행 및 결과(엑셀) 확인.
