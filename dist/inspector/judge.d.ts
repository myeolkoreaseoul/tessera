import { Config, ExecutionRecord, Attachment, Guideline, InspectionResult } from '../types';
/**
 * 집행건 점검 판단기 (규칙 기반, Gemini API 불필요)
 *
 * 보수적 판단 원칙: 확실한 경우에만 적정/부적정, 나머지는 확인필요
 */
export declare class InspectionJudge {
    private config;
    private guideline;
    constructor(config: Config, guideline: Guideline);
    judge(record: ExecutionRecord, attachments: Attachment[]): Promise<InspectionResult>;
    private checkAllRules;
    private findCategoryRule;
    private generateOpinion;
    private generateReasoning;
    judgeAll(records: ExecutionRecord[], attachmentMap: Map<string, Attachment[]>): Promise<InspectionResult[]>;
}
//# sourceMappingURL=judge.d.ts.map