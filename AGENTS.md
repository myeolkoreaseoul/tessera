# e-naradomum-rpa — 정산검토 자동화

## Overview
e나라도움, 이지바로, 보탬e 등 정부 보조금 정산검토를 자동화하는 RPA 도구.

## Tech Stack
- **RPA**: Playwright (Chrome CDP over Tailscale)
- **Data**: xlsx, exceljs, pdf-parse
- **AI**: Google Generative AI (Gemini)
- **CLI**: Commander, Inquirer, Chalk, Ora

## Build & Test
```bash
npm run dev      # 개발 모드
npm run build    # 빌드
npm run test     # 테스트
npm start        # 실행
```

## Project Structure
- `src/` — 핵심 RPA 로직
- `projects/` — 사업별 정산검토 데이터/설정
- `paper/` — 논문/문서 관련
- `criteria/` — 정산검토 기준 문서

## Code Style
- JavaScript/Node.js
- ES Modules
- async/await 패턴 (Playwright 비동기)

## Conventions
- CDP 연결: 회사 PC Chrome에 Tailscale로 연결 (localhost 아님)
- CDP 포트: 9444(e나라도움), 9445(보탬e), 9446(이지바로)
- 사업별 데이터는 `projects/<사업명>/` 하위에 격리
- API 키 하드코딩 금지
