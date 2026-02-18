export interface ExecutionRecord {
    id: string;
    rowNumber: number;
    executionDate: string;
    writeDate: string;
    settlementType: string;
    budgetCategory: string;
    subCategory: string;
    vendorName: string;
    supplyAmount: number;
    vat: number;
    cancelAmount: number;
    totalAmount: number;
    attachmentCount: number;
    attachmentLinks: string[];
    reviewStatus: string;
    reviewDate: string;
    remarks: string;
    existingOpinion: string;
}
export interface Attachment {
    id: string;
    executionId: string;
    originalName: string;
    localPath: string;
    fileType: 'pdf' | 'image' | 'hwp' | 'excel' | 'other';
    fileSize: number;
    extractedText: string;
    ocrResult: string;
    analysisResult: DocumentAnalysis | null;
}
export interface DocumentAnalysis {
    documentType: string;
    date: string;
    amount: number;
    vendor: string;
    summary: string;
    flags: string[];
}
export interface Guideline {
    projectType: string;
    sourceFile: string;
    extractedAt: string;
    rules: BudgetCategoryRules;
    restrictions: string[];
    evidenceRules: EvidenceRules;
    rawText?: string;
}
export interface BudgetCategoryRules {
    [category: string]: CategoryRule;
}
export interface CategoryRule {
    required: string[];
    limit: AmountLimit | null;
    notes: string;
}
export interface AmountLimit {
    daily?: number;
    monthly?: number;
    perCase?: number;
    total?: number;
    accommodation?: number;
}
export interface EvidenceRules {
    validTypes: string[];
    exceptions: string[];
}
export type Judgment = 'appropriate' | 'inappropriate' | 'needsReview';
export interface InspectionResult {
    executionId: string;
    judgment: Judgment;
    confidence: number;
    issues: InspectionIssue[];
    opinion: string;
    reasoning: string;
    appliedRules: string[];
}
export interface InspectionIssue {
    code: string;
    category: string;
    description: string;
    severity: 'high' | 'medium' | 'low';
}
export interface Session {
    id: string;
    startTime: Date;
    endTime?: Date;
    projectCode: string;
    projectName: string;
    guidelinePath: string;
    guidelineAnalyzed: boolean;
    totalRecords: number;
    processedRecords: number;
    appropriateCount: number;
    inappropriateCount: number;
    needsReviewCount: number;
    resultExcelPath: string;
    logPath: string;
    status: 'running' | 'completed' | 'error' | 'cancelled';
    errorMessage?: string;
}
export interface Config {
    cdpUrl: string;
    downloadDir: string;
    resultDir: string;
    logDir: string;
    geminiApiKey: string;
    llmModel: string;
    pageLoadTimeout: number;
    downloadTimeout: number;
    confidenceThreshold: number;
}
export interface CliOptions {
    guideline: string;
    output?: string;
    verbose?: boolean;
    yes?: boolean;
    dryRun?: boolean;
}
//# sourceMappingURL=index.d.ts.map