import { Config, Attachment } from '../types';
/**
 * 문서 분석기 (패턴 매칭 기반, Gemini API 불필요)
 *
 * PDF 텍스트 추출 → 파일명/내용 기반 문서 유형 판별
 */
export declare class DocumentAnalyzer {
    private config;
    constructor(config: Config);
    analyzeAttachment(attachment: Attachment): Promise<Attachment>;
    private analyzePdf;
    /**
     * 텍스트 + 파일명 기반 문서 분석 (패턴 매칭)
     */
    private analyzeText;
    /**
     * 파일명만으로 문서 유형 추정
     */
    private guessFromFilename;
    /**
     * 문서 유형 판별
     */
    private detectDocumentType;
    /**
     * 텍스트에서 금액 추출 (가장 큰 금액)
     */
    private extractAmount;
    /**
     * 텍스트에서 날짜 추출
     */
    private extractDate;
    /**
     * 텍스트에서 거래처명 추출
     */
    private extractVendor;
    /**
     * 주의 플래그 탐지
     */
    private detectFlags;
    /**
     * 내용 요약 생성
     */
    private generateSummary;
    /**
     * 여러 첨부파일 일괄 분석
     */
    analyzeAttachments(attachments: Attachment[]): Promise<Attachment[]>;
}
//# sourceMappingURL=document.d.ts.map