#!/usr/bin/env python3
"""
보탬e 집행내역 판정 스크립트 (criteria-v3.md 기반)
캠퍼스타운 고려대 685건 → results.json 생성
"""
import json
import re
import sys
from pathlib import Path

DATA_PATH  = Path(__file__).parent / 'projects/캠퍼스타운-고려대/data.json'
OUTPUT     = Path(__file__).parent / 'projects/캠퍼스타운-고려대/results.json'

# ───────────────────────────────────────────────
# 보조세목 → 비목명 매핑
# ───────────────────────────────────────────────
ATIT_TYPE = {
    '공공운영비':         '공간운영비(5-2)',
    '사무관리비':         '사무관리비(5-3/5-7)',
    '보수':              '전담인력인건비(4-2)',
    '기간제근로자등보수': '전담인력인건비(4-2)',
    '국내여비':          '여비(5-4)',
    '시험연구비':         '교육연구프로그램(2-10)',
    '포상금':            '창업시상금(3-2)',
}

# ───────────────────────────────────────────────
# 키워드 → 세부 비목 힌트 (집행목적 텍스트 분석용)
# ───────────────────────────────────────────────
PURPOSE_KEYWORDS = [
    # (정규식 패턴,  힌트 비목,  확인사항)
    (r'강사비|강의료|강의',   '강사비(2-1)',    '이력서·강의확인서·원천징수 여부 확인'),
    (r'멘토비|멘토링',        '멘토비(2-3)',    '멘토링내역서·1일단가(대면30만/비대면15만)·월200만원 한도 확인'),
    (r'심사비|평가비|심사',   '심사평가비(2-2)','참석자명부·심사결과서·단가(시간당10만/1일50만) 확인'),
    (r'회의비|자문비|자문',   '회의비/자문비(2-4)', '회의록·단가(대면15만/비대면5만) 확인'),
    (r'단순인건비|일용직',    '단순인건비(2-5)', '활동기록부·서울형생활임금 단가 확인'),
    (r'용역비|용역',          '프로그램용역비(2-6)', '일괄용역 여부·검수조서 확인'),
    (r'단기임차',             '단기임차료(2-7)', '임차 목적·견적서 확인'),
    (r'행사비|행사',          '행사비(2-8)',    '견적서·행사사진 확인'),
    (r'식비|다과비|다과',     '식비/다과비(2-9)', '참석자명단·1인단가(식비8천/다과4천) 확인'),
    (r'창업지원금|창업활동비', '창업지원금(3-1)', '지출증빙·팀당연간3천만원 한도 확인'),
    (r'시상금|상금',          '창업시상금(3-2)', '1팀당3백만원·연간1천만원 한도 확인'),
    (r'수도요금|전기요금|가스요금|인터넷|공과금', '공간운영비(5-2)', '공과금영수증 확인'),
    (r'시설수선|수리|보수공사', '공간운영비(시설수선비)(5-2)', '임차시설 여부·인테리어 아님 확인'),
    (r'소모품|사무용품|문구',  '소모성물품(5-3)', '공간상주인원×5만원 한도 확인'),
    (r'홍보비|홍보물|브로셔|팸플릿', '홍보비(5-7)', '배포계획서(책자형)·견적서 확인'),
    (r'여비|출장비|교통비',   '여비(5-4)',      '시내/시외 구분·시외여비 사전승인 확인'),
    (r'특근|야근|초과근무',   '특근매식비(5-5)', '특근명령대장·평일점심 아님 확인'),
    (r'물품임차|임차비',      '물품임차비(5-8)', '임대차계약서·세부실행계획 승인 확인'),
    (r'시설비|시설공사|공사',  '시설비(6-1)',   '대응자금 집행인지·세부실행계획 승인 확인'),
    (r'물품구입|물품취득|장비구입', '물품취득비(6-2)', '세부실행계획 승인·견적서 확인'),
    (r'보직수당|겸직수당',    '사업단장수당(4-1)', '월100만원 한도·이중수령 여부 확인'),
    (r'교육훈련비|교육비',    '교육훈련비(4-3)', '사업관련성·연200만원 한도 확인'),
    (r'회계감사|감사비',      '회계감사비(5-6)', '500만원 한도 확인'),
]

# ───────────────────────────────────────────────
# 즉시 확인 필요 특이사항 감지
# ───────────────────────────────────────────────
ALERT_KEYWORDS = [
    (r'인테리어',        '⚠️ 인테리어 비용 집행 불가 [제19조]'),
    (r'원상복구',        '⚠️ 원상복구 비용 사업예산 집행 불가 [제19조⑦]'),
    (r'보증금|임차보증금', '⚠️ 임차보증금 보조금 집행 불가 [5-1 공간임차료 조건]'),
    (r'해외|항공|비행기', '⚠️ 해외출장/항공료 시비 투입 불가 [붙임4]'),
    (r'CES|해외전시',    '⚠️ 해외전시 시비 투입 불가 [붙임4]'),
    (r'자격증|시험응시', '⚠️ 자격증 응시 수수료 불인정 [4-3]'),
]

# ───────────────────────────────────────────────
# 금액 문자열 → 정수
# ───────────────────────────────────────────────
def parse_amount(s):
    if not s:
        return 0
    return int(str(s).replace(',', '').replace('원', '').strip() or '0')

# ───────────────────────────────────────────────
# 단일 건 판정
# ───────────────────────────────────────────────
def judge(item):
    rn       = int(item['순번'])
    atit     = item['보조세목(통계목)']
    purpose  = item['집행목적 (용도)'] or ''
    method   = item['집행방식'] or ''
    vendor   = item['거래처명'] or ''
    date     = item['집행실행일자'] or ''
    amount   = parse_amount(item['지방비 집행금액'])
    self_amt = parse_amount(item['자부담 집행금액'])
    contract = item.get('계약정보등록여부', 'N')
    asset    = item.get('중요재산등록여부', 'N')

    # 비목 결정 (보조세목 우선, 목적 키워드 보조)
    item_type = ATIT_TYPE.get(atit, atit)
    issues    = []
    ok        = []
    evidence  = []

    # ── 즉시 알림 키워드 ──
    for pattern, msg in ALERT_KEYWORDS:
        if re.search(pattern, purpose, re.IGNORECASE):
            issues.append(msg)

    # ── 목적 키워드로 비목 힌트 추출 ──
    matched_hints = []
    for pattern, hint, check in PURPOSE_KEYWORDS:
        if re.search(pattern, purpose, re.IGNORECASE):
            matched_hints.append((hint, check))

    # 첫 번째 매칭으로 비목 정밀화
    if matched_hints:
        # 보조세목과 다른 비목이 감지되면 비목 업데이트
        item_type = matched_hints[0][0]
        for _, check in matched_hints:
            if check not in issues:
                issues.append(check)

    # ── 비목별 추가 체크 ──

    # 공간운영비: 임차시설 수선비 확인
    if '공간운영비' in item_type or atit == '공공운영비':
        if re.search(r'수리|수선|보수공사', purpose):
            issues.append('임차시설 여부 확인 필요 (임차시설은 수선비 집행 불가 [제15조⑧])')
        else:
            ok.append('공과금/공공요금 성격의 공간운영비')
        if method == '기타':
            issues.append('집행방식 "기타" — 공과금 납부내역서/계좌이체확인 필요')
        elif method == '전자세금계산서':
            ok.append('전자세금계산서 방식 집행')
            evidence.append('전자세금계산서 시스템 연동 확인')

    # 여비: 시외여비 사전승인 (2025.7 신설)
    if atit == '국내여비':
        if re.search(r'시외|지방|출장', purpose):
            issues.append('시외여비 — 서울시 사전승인 문서 필수 (2025.7 신설) [5-4]')
        issues.append('활동결과보고서·지급내역서(서명)·계좌이체확인 확인')

    # 보수/전담인력: 대학 정규직 여부
    if atit in ('보수', '기간제근로자등보수'):
        issues.append('기간제 여부 확인 (정규 전담인력 지급 불가) [4-2]')
        issues.append('근로계약서·급여지급기준 (최초 1회) 확인')
        issues.append('시비 15% 이내 확인 [4-2]')

    # 포상금: 금액 한도
    if atit == '포상금':
        if amount > 3_000_000:
            issues.append(f'⚠️ 1팀당 3백만원 초과 ({amount:,}원) [3-2]')
        else:
            ok.append(f'1팀당 3백만원 이내 ({amount:,}원)')
        issues.append('창업경진대회 결과 근거·추진계획서·수령확인서 확인')

    # 시험연구비: 창업 인재 육성 교과/비교과 여부
    if atit == '시험연구비':
        issues.append('창업 인재 육성 교과·비교과 프로그램 해당 여부 확인 [2-10]')
        issues.append('프로그램기획서·강의참석자 서명부 확인')

    # 사무관리비: 세부 내용에 따라 다양
    if atit == '사무관리비':
        if not matched_hints:
            issues.append('사무관리비 세부 항목 확인 필요 (소모품/홍보비/행사비 등)')

    # 계약정보등록여부 확인
    if contract == 'N' and amount >= 20_000_000:
        issues.append(f'⚠️ 2천만원 이상({amount:,}원) 계약정보 미등록 — 나라장터 이용 여부 확인 [제17조]')

    # 중요재산등록 여부
    if asset == 'Y':
        ok.append('중요재산 등록 완료')
    elif asset == 'N' and re.search(r'물품|장비|기기|컴퓨터|PC', purpose):
        if amount >= 500_000:
            issues.append(f'단가 50만원 이상 물품 중요재산 미등록 확인 필요 [제19조]')

    # 100만원 이상: 비교견적서 의무
    if amount >= 1_000_000 and method not in ('전자세금계산서',):
        if not re.search(r'공과금|수도요금|전기요금|가스요금|인터넷비|보험료|인건비|급여|여비', purpose):
            issues.append('100만원 이상 — 견적서 및 비교견적서 첨부 의무 [붙임6]')

    # ── 상태 결정 ──
    if issues:
        status = '확인'
    else:
        # 특이사항 없음 → 추가 확인 기본 적용
        if method == '전자세금계산서':
            status = 'SKIP'
            ok.append('전자세금계산서 방식 — 시스템 내장 증빙')
        else:
            status = '확인'
            issues.append('증빙서류 현장 확인 필요')

    # 집행방식 기록
    evidence.append(f'집행방식: {method}')
    if contract == 'Y':
        evidence.append('계약정보 등록됨')

    return {
        'rowNum':   rn,
        'type':     item_type,
        'purpose':  purpose[:80],
        'amount':   amount,
        'vendor':   vendor,
        'date':     date,
        'status':   status,
        'issues':   issues,
        'ok':       ok,
        'evidence': evidence,
    }

# ───────────────────────────────────────────────
# main
# ───────────────────────────────────────────────
def main():
    data = json.loads(DATA_PATH.read_text(encoding='utf-8'))
    print(f'총 {len(data)}건 판정 시작...')

    results = [judge(item) for item in data]

    # 통계
    counter = {'적정': 0, '확인': 0, 'SKIP': 0}
    for r in results:
        counter[r['status']] = counter.get(r['status'], 0) + 1

    OUTPUT.write_text(json.dumps(results, ensure_ascii=False, indent=2), encoding='utf-8')
    kb = OUTPUT.stat().st_size // 1024
    print(f'저장: {OUTPUT} ({kb}KB)')
    print(f'적정: {counter["적정"]}건, 확인: {counter["확인"]}건, SKIP: {counter["SKIP"]}건')

    # 확인 필요 항목 샘플 출력
    alerts = [r for r in results if any('⚠️' in i for i in r['issues'])]
    if alerts:
        print(f'\n⚠️ 즉시 확인 항목 ({len(alerts)}건):')
        for r in alerts[:10]:
            print(f'  [{r["rowNum"]}] {r["purpose"][:50]} → {[i for i in r["issues"] if "⚠️" in i]}')

    # 비목별 통계
    type_map = {}
    for r in results:
        t = r['type']
        type_map[t] = type_map.get(t, 0) + 1
    print('\n비목별:')
    for k, v in sorted(type_map.items(), key=lambda x: -x[1]):
        print(f'  {k}: {v}건')

if __name__ == '__main__':
    main()
