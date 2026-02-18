"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.GuidelineAnalyzer = void 0;
const logger_1 = require("../utils/logger");
/**
 * 2025년 책임의료기관 통합 사업 안내 기반 하드코딩 규정
 * Gemini API 의존 없이 즉시 반환
 */
class GuidelineAnalyzer {
    config;
    constructor(config) {
        this.config = config;
    }
    async analyze(_pdfPath) {
        logger_1.logger.info('지침 규정 로드 (2025년 책임의료기관 통합 사업 안내)');
        const guideline = {
            projectType: '책임의료기관 통합 사업 (공공보건의료 협력체계 구축)',
            sourceFile: _pdfPath || 'hardcoded',
            extractedAt: new Date().toISOString(),
            rules: {
                '인건비': {
                    required: ['급여명세서', '통장사본'],
                    limit: null,
                    notes: '전담인력 인건비만 가능. 타 인건비 중복지급 불가. 겸임 원칙적 불가.',
                },
                '일반수용비': {
                    required: ['세금계산서'],
                    limit: { perCase: 500000 },
                    notes: '취득단가 50만원 미만 물품만. 상품권/현금성 유가증권 불가.',
                },
                '안내홍보물': {
                    required: ['세금계산서'],
                    limit: { total: 50000000, perCase: 50000 },
                    notes: '총 50백만원 이하, 단가 5만원 이하.',
                },
                '자문수당': {
                    required: ['자문수당지급조서'],
                    limit: { total: 20000000 },
                    notes: '내부 인력 대상 총 20백만원 이하.',
                },
                '협력인센티브': {
                    required: ['지급조서'],
                    limit: { total: 50000000 },
                    notes: '내부 인력 대상 총 50백만원 이하.',
                },
                '유류비': {
                    required: ['주유영수증'],
                    limit: { total: 3000000 },
                    notes: '임차 차량 한정, 총 3백만원 이하.',
                },
                '교육훈련비': {
                    required: ['교육수료증'],
                    limit: { total: 3000000 },
                    notes: '전담인력 한정, 총 3백만원 이하.',
                },
                '복리후생비': {
                    required: ['4대보험납부확인서'],
                    limit: null,
                    notes: '4대 보험 등 기관부담금.',
                },
                '여비': {
                    required: ['출장명령서', '출장보고서'],
                    limit: null,
                    notes: '국내여비 기준.',
                },
                '업무추진비': {
                    required: ['카드영수증'],
                    limit: { perCase: 50000 },
                    notes: '보조금 총 5% 이하, 인당 최대 5만원.',
                },
                '연구용역비': {
                    required: ['계약서', '세금계산서'],
                    limit: { total: 60000000 },
                    notes: '위탁 용역비 총 60백만원 이하.',
                },
                '유형자산': {
                    required: ['세금계산서', '자산취득보고서'],
                    limit: null,
                    notes: '전담인력 한정, 한도 내 구매. 500만원 이상 중요재산 보고.',
                },
            },
            restrictions: [
                '상품권(쿠폰) 등 현금성 유가증권 구매 불가',
                '환자에게 직접 지급하는 물품 불가',
                '타 사업 인건비로 사용 불가',
                '전담 업무 관련 없는 지출 불가',
                '취득단가 50만원 초과 일반 물품은 자산취득비로 계상',
            ],
            evidenceRules: {
                validTypes: [
                    '세금계산서',
                    '신용카드매출전표',
                    '금전등록기영수증',
                    '온라인지급증빙서',
                    '계약서사본',
                    '통장사본',
                    '인건비수령증명서',
                ],
                exceptions: [
                    '인건비는 통장사본 또는 인건비 수령 증명서로 대체 가능',
                ],
            },
        };
        this.printRules(guideline);
        return guideline;
    }
    printRules(g) {
        logger_1.logger.divider();
        logger_1.logger.info(`사업 유형: ${g.projectType}`);
        logger_1.logger.info(`비목 규정: ${Object.keys(g.rules).length}개`);
        logger_1.logger.info(`제한 사항: ${g.restrictions.length}개`);
        logger_1.logger.divider();
    }
}
exports.GuidelineAnalyzer = GuidelineAnalyzer;
//# sourceMappingURL=guideline.js.map