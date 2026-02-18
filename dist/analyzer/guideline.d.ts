import { Config, Guideline } from '../types';
/**
 * 2025년 책임의료기관 통합 사업 안내 기반 하드코딩 규정
 * Gemini API 의존 없이 즉시 반환
 */
export declare class GuidelineAnalyzer {
    private config;
    constructor(config: Config);
    analyze(_pdfPath?: string): Promise<Guideline>;
    private printRules;
}
//# sourceMappingURL=guideline.d.ts.map