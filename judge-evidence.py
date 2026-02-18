#!/usr/bin/env python3
"""
증빙 기반 판정 스크립트
- evidence.json (보탬e 증빙 메타데이터) + data.json (원본 데이터)
- company-downloads/ 에서 PDF 텍스트 추출하여 내용 확인
- criteria-v3.md 규칙 적용
- results.json 생성 (register-review-botem.js 호환 형식)
"""
import json
import re
import os
from pathlib import Path

# PDF 읽기
try:
    from pypdf import PdfReader
    HAS_PDF = True
except ImportError:
    HAS_PDF = False
    print("WARNING: pypdf not installed, PDF text extraction disabled")

DIR = Path(__file__).parent / 'projects/캠퍼스타운-고려대'
DL_DIR = Path('/home/john/company-downloads')
DATA_FILE = DIR / 'data.json'
EVIDENCE_FILE = DIR / 'evidence.json'
OUTPUT_FILE = DIR / 'results.json'

# ── PDF 텍스트 추출 (캐시) ──
_pdf_cache = {}
def read_pdf_text(filename, max_pages=3):
    """PDF 파일의 텍스트 추출 (첫 3페이지)"""
    if filename in _pdf_cache:
        return _pdf_cache[filename]

    filepath = DL_DIR / filename
    if not filepath.exists():
        _pdf_cache[filename] = None
        return None

    try:
        reader = PdfReader(str(filepath))
        text = ''
        for i, page in enumerate(reader.pages[:max_pages]):
            text += page.extract_text() or ''
        _pdf_cache[filename] = text.strip()
        return _pdf_cache[filename]
    except Exception as e:
        _pdf_cache[filename] = f"[PDF 읽기 실패: {e}]"
        return _pdf_cache[filename]


def check_file_exists(filename):
    """company-downloads에 파일 존재 여부"""
    if not filename:
        return False
    return (DL_DIR / filename).exists()


# ── 비목 매핑 (judge.js 동일 로직) ──
def map_category(atit_nm, purpose):
    p = (purpose or '').lower()

    if atit_nm == '국내여비': return ('5-4', '여비')
    if atit_nm == '포상금': return ('3-2', '창업시상금')
    if atit_nm == '기간제근로자등보수': return ('4-2', '전담인력인건비')
    if atit_nm == '시험연구비': return ('2-10', '교육연구프로그램')

    if atit_nm == '보수':
        if any(k in p for k in ['사업단장', '보직', '겸직']):
            return ('4-1', '사업단장수당')
        return ('4-2', '전담인력인건비')

    if atit_nm == '공공운영비':
        if '임차' in p and '물품' not in p and '장비' not in p:
            return ('5-1', '공간임차료')
        if any(k in p for k in ['수선', '수리', '보수', '교체']):
            return ('5-2-수선', '공간운영비(시설수선비)')
        return ('5-2', '공간운영비')

    if atit_nm == '사무관리비':
        if any(k in p for k in ['강사', '강의']): return ('2-1', '강사비')
        if any(k in p for k in ['심사', '평가']): return ('2-2', '심사평가비')
        if '멘토' in p: return ('2-3', '멘토비')
        if any(k in p for k in ['회의', '자문']): return ('2-4', '회의비/자문비')
        if any(k in p for k in ['단순인건', '일용']): return ('2-5', '단순인건비')
        if '용역' in p: return ('2-6', '프로그램용역비')
        if '임차' in p: return ('2-7', '단기임차료')
        if any(k in p for k in ['행사', '현수막', '포스터', '설치', '해체']):
            return ('2-8', '행사비')
        if any(k in p for k in ['식비', '다과', '식사', '케이터링', '도시락']):
            return ('2-9', '식비/다과비')
        if any(k in p for k in ['특근', '야근', '매식']): return ('5-5', '특근매식비')
        if any(k in p for k in ['홍보', '팜플릿', '브로셔', '리플렛']):
            return ('5-7', '홍보비')
        if '회계감사' in p: return ('5-6', '회계감사비')
        if '교육훈련' in p: return ('4-3', '교육훈련비')
        if any(k in p for k in ['물품', '소모품', '사무용품', '토너', '복사']):
            return ('5-3', '소모성물품')
        if any(k in p for k in ['창업지원', '사업화', '시제품']):
            return ('3-1', '창업지원금')
        if any(k in p for k in ['우편', '운송', '택배']):
            return ('5-2', '공간운영비')
        # 프로그램 관련
        if any(k in p for k in ['프로그램', '교육', '연구']):
            return ('2-10', '교육연구프로그램')
        return ('ETC', '사무관리비(미분류)')

    return ('UNK', atit_nm or '(미분류)')


# ── 공과금 판별 ──
UTILITY_KEYWORDS = ['수도', '전기', '가스', '인터넷', '전화', '통신', '난방', '도시가스']
def is_utility_bill(purpose):
    return any(kw in purpose for kw in UTILITY_KEYWORDS)


# ── 판정 로직 ──
def judge_item(data_item, evidence_item):
    """
    data_item: data.json의 항목
    evidence_item: evidence.json의 항목 (없으면 None)
    """
    purpose = data_item.get('집행목적 (용도)', '')
    atit_nm = data_item.get('보조세목(통계목)', '')
    method = data_item.get('집행방식', '')
    vendor = data_item.get('거래처명', '')
    sibi_amt = int(str(data_item.get('지방비 집행금액', '0')).replace(',', '') or '0')
    jabu_amt = int(str(data_item.get('자부담 집행금액', '0')).replace(',', '') or '0')
    total_amt = sibi_amt + jabu_amt
    date = data_item.get('집행실행일자', '')
    row_num = int(data_item.get('순번', 0))

    code, cat_name = map_category(atit_nm, purpose)

    issues = []
    ok_list = []
    evidence_notes = []

    # ── 증빙 정보 ──
    files = []
    has_file = False
    evid_type = ''
    evid_data = ''
    evid_doc = ''
    exe_method = method

    if evidence_item:
        files = evidence_item.get('files', [])
        has_file = len(files) > 0
        evid_type = evidence_item.get('evidenceType', '')
        evid_data = evidence_item.get('evidenceData', '')
        evid_doc = evidence_item.get('evidenceDoc', '')
        exe_method = evidence_item.get('exeMethod', method) or method

    # ── 파일 존재 확인 ──
    files_found = []
    files_missing = []
    pdf_texts = {}

    for f in files:
        if check_file_exists(f):
            files_found.append(f)
            # PDF 텍스트 추출 (공과금, 세금계산서 등 간단한 문서)
            if HAS_PDF and f.lower().endswith('.pdf'):
                text = read_pdf_text(f)
                if text and text != '':
                    pdf_texts[f] = text[:500]  # 첫 500자만
        else:
            files_missing.append(f)

    if files_found:
        evidence_notes.append(f"첨부파일 확인: {', '.join(files_found)}")
    if files_missing:
        evidence_notes.append(f"파일 미확인: {', '.join(files_missing)}")

    # 증빙유형 기록
    if evid_type:
        evidence_notes.append(f"증빙유형: {evid_type}")
    if evid_data:
        evidence_notes.append(f"증빙자료: {evid_data[:80]}")

    # ── 전자세금계산서 여부 ──
    is_etax = '전자세금계산서' in exe_method or '전자세금계산서' in evid_type
    if is_etax:
        evidence_notes.append('전자세금계산서 시스템 연동')

    # ── 공통 체크 ──
    if total_amt >= 1000000 and code not in ('4-1', '4-2'):
        issues.append(f'총액 {total_amt:,}원 ≥ 100만원: 비교견적서 확인')
    if total_amt > 20000000:
        issues.append(f'총액 {total_amt:,}원 > 2천만원: 나라장터 이용 확인')

    # ── 비목별 증빙 기반 판정 ──

    # === 공간운영비 (5-2): 공과금 ===
    if code == '5-2' and is_utility_bill(purpose):
        if has_file and files_found:
            # PDF가 있고 내용 확인 가능
            pdf_ok = False
            for f, text in pdf_texts.items():
                if text and not text.startswith('[PDF'):
                    # 공과금 관련 키워드 확인
                    if any(kw in text for kw in ['요금', '납부', '청구', '공급', '사용량', '금액', '전기', '수도', '가스', '인터넷']):
                        ok_list.append(f'공과금 영수증 내용 확인 ({f})')
                        pdf_ok = True
                    else:
                        ok_list.append(f'첨부파일 확인 ({f})')
                        pdf_ok = True  # 파일 존재 자체로 OK
            if not pdf_ok and files_found:
                ok_list.append(f'공과금 영수증 첨부 확인 ({files_found[0]})')
            ok_list.append('공과금/공공요금 항목')
        elif is_etax:
            ok_list.append('전자세금계산서 연동 확인')
        else:
            issues.append('공과금 영수증 미첨부 - 납부확인서 또는 영수증 제출 필요')

    # === 공간운영비 (5-2): 시설수선비 ===
    elif code == '5-2-수선':
        if has_file and files_found:
            evidence_notes.append(f'시설수선 증빙 첨부: {files_found[0]}')
        issues.append('임차시설/전담조직전용시설 여부 확인 (해당시 수선비 불가)')
        if '인테리어' in purpose:
            issues.append('인테리어 비용 집행 불가')
        if is_etax or (has_file and files_found):
            ok_list.append('수선 관련 영수증/세금계산서 확인')
        else:
            issues.append('수선 관련 영수증 미첨부')

    # === 공간운영비 (5-2): 기타 ===
    elif code == '5-2':
        if has_file and files_found:
            ok_list.append(f'운영비 증빙 첨부 확인 ({files_found[0]})')
        elif is_etax:
            ok_list.append('전자세금계산서 연동 확인')
        else:
            issues.append('운영비 증빙 미첨부')

    # === 보수/인건비 (4-1, 4-2) ===
    elif code in ('4-1', '4-2'):
        if has_file and files_found:
            # 급여명세서 PDF 확인
            for f, text in pdf_texts.items():
                if text and any(kw in text for kw in ['급여', '지급', '월급', '보수', '원천징수', '소득세', '공제']):
                    ok_list.append(f'급여 관련 증빙 확인 ({f})')
            if not ok_list:
                ok_list.append(f'첨부파일 확인 ({files_found[0]})')
            evidence_notes.append('급여 지급 증빙 확인')
        elif is_etax:
            ok_list.append('전자세금계산서 연동')
        else:
            issues.append('급여 지급 증빙 미첨부')

        if code == '4-1':
            if sibi_amt > 1000000:
                issues.append(f'월 100만원 한도 확인 ({sibi_amt:,}원)')
            issues.append('대학 내부규정 지급 근거 확인')
        elif code == '4-2':
            issues.append('대학 정규직 여부 확인 (정규직 불가)')

    # === 여비 (5-4) ===
    elif code == '5-4':
        if has_file and files_found:
            ok_list.append(f'여비 증빙 첨부 ({files_found[0]})')
        else:
            issues.append('활동결과보고서/지급내역서 미첨부')
        if any(kw in purpose for kw in ['시외', '출장', 'KTX', '기차']):
            issues.append('시외여비: 서울시 사전 승인 문서 확인 필요')

    # === 포상금/창업시상금 (3-2) ===
    elif code == '3-2':
        if has_file and files_found:
            ok_list.append(f'시상 관련 증빙 첨부 ({files_found[0]})')
        else:
            issues.append('추진계획서/결과보고서 미첨부')
        if sibi_amt > 3000000:
            issues.append(f'1팀당 300만원 한도 확인 ({sibi_amt:,}원)')
        issues.append('경진대회 선정결과 확인')

    # === 강사비 (2-1) ===
    elif code == '2-1':
        if has_file and files_found:
            ok_list.append(f'강사비 증빙 첨부 ({files_found[0]})')
        else:
            issues.append('강의확인서/강의증빙자료 미첨부')
        if sibi_amt > 125000:
            issues.append('기타소득 125,000원 초과: 원천징수영수증 확인')

    # === 심사평가비 (2-2) ===
    elif code == '2-2':
        if has_file and files_found:
            ok_list.append(f'심사평가 증빙 첨부 ({files_found[0]})')
        else:
            issues.append('참석자명부/심사평가결과서 미첨부')
        issues.append('전담조직 소속 여부 확인 (해당시 지급불가)')

    # === 멘토비 (2-3) ===
    elif code == '2-3':
        if has_file and files_found:
            ok_list.append(f'멘토링 증빙 첨부 ({files_found[0]})')
        else:
            issues.append('멘토링내역서 미첨부')
        if sibi_amt > 300000:
            issues.append(f'1일 대면 30만원 한도 확인 ({sibi_amt:,}원)')

    # === 회의비/자문비 (2-4) ===
    elif code == '2-4':
        if has_file and files_found:
            ok_list.append(f'회의/자문 증빙 첨부 ({files_found[0]})')
        else:
            issues.append('회의참석확인서/회의록 미첨부')
        issues.append('전담조직 소속 여부 확인')

    # === 단순인건비 (2-5) ===
    elif code == '2-5':
        if has_file and files_found:
            ok_list.append(f'활동기록 증빙 첨부 ({files_found[0]})')
        else:
            issues.append('활동기록부 미첨부')

    # === 프로그램용역비 (2-6) ===
    elif code == '2-6':
        if has_file and files_found:
            ok_list.append(f'용역 증빙 첨부 ({files_found[0]})')
        else:
            issues.append('프로그램기획서/견적서 미첨부')
        issues.append('일괄용역 불가 확인')

    # === 행사비 (2-8) ===
    elif code == '2-8':
        if has_file and files_found:
            ok_list.append(f'행사 증빙 첨부 ({files_found[0]})')
        else:
            issues.append('견적서/행사사진 미첨부')

    # === 식비/다과비 (2-9) ===
    elif code == '2-9':
        if has_file and files_found:
            ok_list.append(f'식비/다과비 증빙 첨부 ({files_found[0]})')
        else:
            issues.append('활동내역서/참석자명단 미첨부')
        issues.append('1인당 단가 확인 (식비 8천원/다과비 4천원)')

    # === 교육연구프로그램 (2-10) ===
    elif code == '2-10':
        if has_file and files_found:
            ok_list.append(f'프로그램 증빙 첨부 ({files_found[0]})')
        else:
            issues.append('프로그램기획서/참석자서명부 미첨부')
        issues.append('창업 인재육성 교과/비교과 프로그램 해당 여부 확인')

    # === 창업지원금 (3-1) ===
    elif code == '3-1':
        if has_file and files_found:
            ok_list.append(f'창업지원 증빙 첨부 ({files_found[0]})')
        else:
            issues.append('수령확인서/지출증빙 미첨부')
        issues.append('팀당 연 3천만원 한도, 인건비/자산취득비 해당 여부 확인')

    # === 소모성물품 (5-3) ===
    elif code == '5-3':
        if has_file and files_found:
            ok_list.append(f'물품구입 증빙 첨부 ({files_found[0]})')
        elif is_etax:
            ok_list.append('전자세금계산서 연동 확인')
        else:
            issues.append('구입영수증/내역서 미첨부')

    # === 홍보비 (5-7) ===
    elif code == '5-7':
        if has_file and files_found:
            ok_list.append(f'홍보비 증빙 첨부 ({files_found[0]})')
        else:
            issues.append('견적서/홍보물사진 미첨부')

    # === 물품임차비 (5-8) ===
    elif code == '5-8':
        if has_file and files_found:
            ok_list.append(f'물품임차 증빙 첨부 ({files_found[0]})')
        else:
            issues.append('임대차계약서/견적서 미첨부')

    # === 단기임차료 (2-7) ===
    elif code == '2-7':
        if has_file and files_found:
            ok_list.append(f'임차 증빙 첨부 ({files_found[0]})')
        else:
            issues.append('견적서/임차증빙 미첨부')

    # === 교육훈련비 (4-3) ===
    elif code == '4-3':
        if has_file and files_found:
            ok_list.append(f'교육훈련 증빙 첨부 ({files_found[0]})')
        else:
            issues.append('교육참가신청서/이수증 미첨부')

    # === 회계감사비 (5-6) ===
    elif code == '5-6':
        if has_file and files_found:
            ok_list.append(f'회계감사 증빙 첨부 ({files_found[0]})')
        else:
            issues.append('회계감사보고서 미첨부')

    # === 공간임차료 (5-1) ===
    elif code == '5-1':
        if sibi_amt > 0:
            issues.append(f'시비 {sibi_amt:,}원 투입: 공간임차료는 대응자금으로만 집행 가능')
        if has_file and files_found:
            ok_list.append(f'임차 증빙 첨부 ({files_found[0]})')

    # === 기타 ===
    else:
        if has_file and files_found:
            ok_list.append(f'증빙 첨부 확인 ({files_found[0]})')
        else:
            issues.append('증빙서류 미첨부 - 세부 확인 필요')

    # ── status 결정 ──
    # 적정: 증빙 파일 있고, critical issue 없음
    # 확인: 증빙 있지만 추가 확인 필요한 사항 있음 (보완요청으로 등록)
    # SKIP: 전자세금계산서 등 시스템 증빙으로 충분

    critical_issues = [i for i in issues if
        '집행 불가' in i or '한도 초과' in i or '시비' in i and '투입' in i]

    # 기본 로직
    status = '확인'  # default: 보완요청

    # 공과금 + 영수증 있음 → 적정
    if code == '5-2' and is_utility_bill(purpose):
        if (has_file and files_found) or is_etax:
            if not critical_issues:
                status = '적정'

    # 전자세금계산서 + 단순항목 → 적정
    if is_etax and code in ('5-2', '5-3', '5-7', '2-8') and not critical_issues:
        if len(issues) <= 1:
            status = '적정'

    # 인건비 계열: 증빙 있으면 적정
    if code in ('4-1', '4-2') and has_file and files_found:
        if not critical_issues:
            status = '적정'

    # 여비: 증빙 있고 시외 아니면 적정
    if code == '5-4' and has_file and files_found:
        if not any('시외' in i or '사전 승인' in i for i in issues):
            status = '적정'

    # 이미 검토완료인 건
    if data_item.get('검증검토 진행상태') == '검토완료':
        ok_list.append('보탬e 검토완료 상태')
        status = '적정'

    # ── opinion 생성 ──
    if status == '적정':
        opinion = generate_ok_opinion(code, cat_name, ok_list, files_found)
    else:
        opinion = generate_review_opinion(code, cat_name, issues, files_found, files_missing)

    return {
        'rowNum': row_num,
        'type': f'{cat_name}({code})',
        'purpose': purpose,
        'amount': total_amt,
        'vendor': vendor,
        'date': date,
        'status': status,
        'issues': issues,
        'ok': ok_list,
        'evidence': evidence_notes,
        'opinion': opinion,
        'files_found': files_found,
        'files_missing': files_missing,
    }


# ── 의견 생성 ──
def generate_ok_opinion(code, cat_name, ok_list, files_found):
    """적정 건의 의견 텍스트"""
    parts = []
    if files_found:
        parts.append(f'증빙 확인: {files_found[0][:40]}')

    if '5-2' in code and any('공과금' in o for o in ok_list):
        parts.append('공과금 영수증 확인 완료')
    elif '4-' in code:
        parts.append('급여/인건비 지급 증빙 확인')
    elif '전자세금계산서' in ' '.join(ok_list):
        parts.append('전자세금계산서 연동 확인')
    else:
        parts.append('증빙서류 확인 완료')

    return ' / '.join(parts)[:145]


# ── 보완요청 의견 (비목별 표준 텍스트) ──
OPINION_TEMPLATE = {
    '2-1': '보완요청: ① 이력서(최초1회) ② 강의확인서(서명) ③ 강의증빙(교안/사진/출석부) ④ 계좌이체확인증 ⑤ 원천징수영수증(125,000원 초과시)',
    '2-2': '보완요청: ① 참석자명부(서명) ② 심사평가결과서 ③ 이력서(최초1회) ④ 계좌이체확인증 ⑤ 단가확인(시간당10만, 1일50만)',
    '2-3': '보완요청: ① 멘토링내역서(서명) ② 이력서(최초1회) ③ 계좌이체확인증 ④ 대면30만/비대면15만, 월200만 한도 확인',
    '2-4': '보완요청: ① 회의참석확인서(서명) ② 회의록 ③ 이력서(최초1회) ④ 계좌이체확인증 ⑤ 단가확인(대면15/20만, 비대면5/7만)',
    '2-5': '보완요청: ① 활동기록부(서명) ② 지급내역서 ③ 계좌이체확인증 ④ 근무시간(8h/일, 60h/월) ⑤ 서울형 생활임금 단가',
    '2-6': '보완요청: ① 프로그램기획서 ② 견적서(비교견적서) ③ 사업자등록증 ④ 검수조서 ⑤ 카드영수증/계좌이체확인증',
    '2-7': '보완요청: ① 행사개요(임차목적/일시) ② 견적서(비교견적서) ③ 카드영수증/계좌이체확인증',
    '2-8': '보완요청: ① 견적서(비교견적서) ② 행사사진 ③ 카드영수증/계좌이체확인증',
    '2-9': '보완요청: ① 활동내역서/회의록 ② 참석자명단(서명) ③ 카드영수증 ④ 1인단가(식비8천/다과4천)',
    '2-10': '보완요청: ① 프로그램기획서 ② 참석자서명부 ③ 카드영수증 ④ 창업인재육성 프로그램 해당여부',
    '3-1': '보완요청: ① 수령확인서(서명) ② 지출증빙서류 ③ 창업활동기록부 ④ 계좌이체확인증 ⑤ 팀당 연3천만원 한도',
    '3-2': '보완요청: ① 추진계획서(시상계획) ② 결과보고서 ③ 수령확인서(서명) ④ 계좌이체확인증 ⑤ 경진대회 선정결과',
    '4-1': '보완요청: ① 지급내역서 ② 계좌이체확인증 ③ 대학내부규정 지급근거(최초1회) ④ 월100만원 한도',
    '4-2': '보완요청: ① 근로계약서/이력서(최초1회) ② 급여지급기준(최초1회) ③ 지급내역서 ④ 계좌이체확인증 ⑤ 원천징수영수증',
    '4-3': '보완요청: ① 교육참가신청서(서명) ② 교육이수증 ③ 계좌이체확인증 ④ 사업관련성 확인',
    '5-1': '보완요청: ① 임대차계약서 ② 주변시세현황 ③ 계좌이체확인증 ④ 대응자금 집행 확인',
    '5-2': '보완요청: ① 공과금 영수증(납부확인서) ② 카드영수증/세금계산서/계좌이체확인증',
    '5-2-수선': '보완요청: ① 카드영수증/세금계산서 ② 인테리어 아님 확인 ③ 임차시설 여부(해당시 불가) ④ 기본기능 유지보수 확인',
    '5-3': '보완요청: ① 구입영수증/내역서 ② 카드영수증/계좌이체확인증 ③ 공간상주인원x월5만원 한도',
    '5-4': '보완요청: ① 활동결과보고서 ② 지급내역서(서명) ③ 계좌이체확인증 ④ 시내여비 단가(4h미만1만/4h이상2만)',
    '5-5': '보완요청: ① 특근명령대장 ② 카드영수증 ③ 1인12,000원 이내 ④ 평일점심 아님 확인',
    '5-6': '보완요청: ① 회계감사보고서 ② 500만원 한도 확인',
    '5-7': '보완요청: ① 견적서(비교견적서) ② 홍보물 설치사진 ③ 인쇄물3부 ④ 카드영수증/세금계산서',
    '5-8': '보완요청: ① 임대차계약서 ② 견적서(비교견적서) ③ 카드영수증/세금계산서 ④ 시비6천만원 한도',
}

def generate_review_opinion(code, cat_name, issues, files_found, files_missing):
    """보완요청 건의 의견 텍스트"""
    # 비목별 표준 의견 사용
    base = OPINION_TEMPLATE.get(code, '')
    if not base:
        # 키 부분 매칭
        for k, v in OPINION_TEMPLATE.items():
            if code.startswith(k):
                base = v
                break
    if not base:
        base = '보완요청: 증빙서류 보완 필요'

    return base[:145]


# ── 메인 ──
def main():
    data = json.loads(DATA_FILE.read_text(encoding='utf-8'))

    # evidence.json 로드
    try:
        evidence_list = json.loads(EVIDENCE_FILE.read_text(encoding='utf-8'))
    except:
        evidence_list = []

    # evidence를 purpose+amount 기준 인덱싱
    evidence_map = {}
    for ev in evidence_list:
        key = (ev.get('purpose', ''), ev.get('amount', ''))
        evidence_map[key] = ev

    print(f'데이터: {len(data)}건, 증빙: {len(evidence_list)}건')
    print(f'PDF 추출: {"사용" if HAS_PDF else "미사용"}')
    print(f'다운로드 폴더: {DL_DIR} ({len(list(DL_DIR.iterdir())) if DL_DIR.exists() else 0}개 파일)')
    print()

    results = []
    stats = {'적정': 0, '확인': 0, 'SKIP': 0}

    for item in data:
        purpose = item.get('집행목적 (용도)', '')
        amount_str = str(item.get('지방비 집행금액', '0')).replace(',', '')

        # evidence 매칭
        ev = evidence_map.get((purpose, amount_str))
        if not ev:
            # 부분 매칭
            for k, v in evidence_map.items():
                if k[0] == purpose:
                    ev = v
                    break

        result = judge_item(item, ev)
        results.append(result)
        stats[result['status']] = stats.get(result['status'], 0) + 1

    # 저장
    OUTPUT_FILE.write_text(json.dumps(results, ensure_ascii=False, indent=2), encoding='utf-8')

    print(f'판정 결과:')
    print(f'  적정: {stats.get("적정", 0)}건 (검토완료 등록)')
    print(f'  확인: {stats.get("확인", 0)}건 (보완요청 등록)')
    print(f'  SKIP: {stats.get("SKIP", 0)}건')
    print()

    # 비목별 통계
    cat_stats = {}
    for r in results:
        cat_stats[r['type']] = cat_stats.get(r['type'], 0) + 1
    print('비목별 분류:')
    for k, v in sorted(cat_stats.items(), key=lambda x: -x[1]):
        print(f'  {k}: {v}건')

    # 증빙 파일 통계
    with_files = sum(1 for r in results if r.get('files_found'))
    no_files = sum(1 for r in results if not r.get('files_found') and not r.get('files_missing'))
    print(f'\n증빙 파일:')
    print(f'  파일 확인됨: {with_files}건')
    print(f'  파일 없음: {no_files}건')

    kb = OUTPUT_FILE.stat().st_size // 1024
    print(f'\n저장: {OUTPUT_FILE} ({kb}KB)')


if __name__ == '__main__':
    main()
