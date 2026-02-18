import { Config, ExecutionRecord, InspectionResult } from '../types';
export declare class ResultExporter {
    private config;
    private workbook;
    constructor(config: Config);
    /**
     * 결과 엑셀 생성
     */
    exportResults(records: ExecutionRecord[], results: InspectionResult[], projectName: string): Promise<string>;
    /**
     * 전체 목록 시트
     */
    private createAllSheet;
    /**
     * 부적정/확인필요 시트
     */
    private createIssueSheet;
    /**
     * 통계 시트
     */
    private createStatsSheet;
    /**
     * 판단 결과 텍스트 변환
     */
    private getJudgmentText;
    /**
     * 행 스타일 적용
     */
    private applyRowStyle;
}
//# sourceMappingURL=excel.d.ts.map