# e나라도움 자동정산 — 빠른 시작 가이드

> Gemini/Codex CLI가 읽고 바로 실행하는 용도. 배경 설명 없이 실행 절차만 기술.

## 환경 체크 (매번 실행 전)

```bash
# 1) Chrome 연결 확인 (포트는 실행 명령어에 지정된 것 사용)
curl -s http://100.87.3.123:PORT/json/version | head -1

# 2) sshfs 마운트 확인
mount | grep sshfs
# 없으면: sshfs 정동회계법인@100.87.3.123:/mnt/c/projects/e-naradomum-rpa/downloads ~/company-pc/downloads

# 3) e나라도움 로그인 확인
curl -s http://100.87.3.123:PORT/json/list | grep gosims
```

체크 통과하면 아래 실행 명령어를 그대로 실행.
실패하면 사용자에게 "Chrome 재시작" 또는 "e나라도움 로그인" 요청.

## 실행

사용자가 지정한 기관의 명령어를 실행:

```bash
cd ~/e-naradomum-rpa
node run-all.js --inst=기관명 --kw=키워드 --project=config명 --settlement=final --save --port=PORT
```

## 모니터링

5분마다 실행:

```bash
tail -10 로그파일경로
```

로그에서 `[RN/총건수]` 패턴으로 진행률 확인.
`ERROR`나 프로세스 종료 감지 시 → `--start=마지막R+1`로 재시작.

## 세션 끊김 대응

```bash
# 프로세스 생존 확인
ps aux | grep run-all | grep -v grep

# 죽었으면 마지막 R번호 확인
tail -30 로그파일 | grep '\[R'

# 재시작
node run-all.js --inst=기관명 --kw=키워드 --project=config명 --settlement=final --save --port=PORT --start=N
```

## 완료 시

```bash
# 결과 요약
node -e 'const r=require("./결과파일.json"); const ok=r.filter(x=>x.status==="적정").length; const ng=r.filter(x=>x.status==="확인").length; console.log("적정:"+ok+", 확인:"+ng+", 총:"+r.length)'
```

사용자에게 결과 보고.
