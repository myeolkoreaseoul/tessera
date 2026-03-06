// ============================================
// e나라도움 RPA 타입 정의
// ============================================

// --------------------------------------------
// 집행건 (ExecutionRecord)
// --------------------------------------------
export interface ExecutionRecord {
  // 기본 정보
  id: string;
  rowNumber: number;

  // 날짜
  executionDate: string;      // 집행처리일자
  writeDate: string;          // 작성일자

  // 분류
  settlementType: string;     // 정산구분 (보조금직접/기타 등)
  budgetCategory: string;     // 집행비목
  subCategory: string;        // 세목명

  // 거래 정보
  vendorName: string;         // 거래처명
  supplyAmount: number;       // 공급가액 (A)
  vat: number;                // 부가세 (B)
  cancelAmount: number;       // 집행취소 (C)
  totalAmount: number;        // 집행금액 (A+B-C)

  // 첨부파일
  attachmentCount: number;
  attachmentLinks: string[];

  // 현재 상태
  reviewStatus: string;       // 검토진행상태
  reviewDate: string;         // 검토일자

  // 기타
  remarks: string;            // 집행특이
  existingOpinion: string;    // 기존 의제의견
}

// --------------------------------------------
// 첨부파일 (Attachment)
// --------------------------------------------
export interface Attachment {
  id: string;
  executionId: string;

  // 파일 정보
  originalName: string;
  localPath: string;
  fileType: 'pdf' | 'image' | 'hwp' | 'excel' | 'other';
  fileSize: number;

  // 분석 결과
  extractedText: string;
  ocrResult: string;
  analysisResult: DocumentAnalysis | null;
}

export interface DocumentAnalysis {
  documentType: string;       // 영수증/계약서/출장보고서 등
  date: string;               // 문서상 날짜
  amount: number;             // 문서상 금액
  vendor: string;             // 문서상 거래처
  summary: string;            // 내용 요약
  flags: string[];            // 주의사항 플래그
}

// --------------------------------------------
// 지침 규정 (Guideline)
// --------------------------------------------
export interface Guideline {
  projectType: string;        // 사업 유형
  sourceFile: string;         // 원본 PDF 경로
  extractedAt: string;        // 추출 일시

  rules: BudgetCategoryRules;
  restrictions: string[];     // 제한/금지 사항
  evidenceRules: EvidenceRules;
  rawText?: string;           // 원본 텍스트 (디버깅용)
}

export interface BudgetCategoryRules {
  [category: string]: CategoryRule;
}

export interface CategoryRule {
  required: string[];         // 필수 증빙 목록
  limit: AmountLimit | null;  // 금액 한도
  notes: string;              // 비고/주의사항
}

export interface AmountLimit {
  daily?: number;             // 일일 한도
  monthly?: number;           // 월 한도
  perCase?: number;           // 건당 한도
  total?: number;             // 총 한도
  accommodation?: number;     // 숙박비 한도
}

export interface EvidenceRules {
  validTypes: string[];       // 적격 증빙 종류
  exceptions: string[];       // 예외 허용 케이스
}

// --------------------------------------------
// 점검 결과 (InspectionResult)
// --------------------------------------------
export type Judgment = 'appropriate' | 'inappropriate' | 'needsReview';

export interface InspectionResult {
  executionId: string;

  // 판단
  judgment: Judgment;
  confidence: number;         // 0-100

  // 이슈 (부적정/확인필요 시)
  issues: InspectionIssue[];

  // 점검의견
  opinion: string;

  // 근거
  reasoning: string;
  appliedRules: string[];
}

export interface InspectionIssue {
  code: string;
  category: string;
  description: string;
  severity: 'high' | 'medium' | 'low';
}

// --------------------------------------------
// 세션 (Session)
// --------------------------------------------
export interface Session {
  id: string;
  startTime: Date;
  endTime?: Date;

  // 사업 정보
  projectCode: string;
  projectName: string;

  // 지침 정보
  guidelinePath: string;
  guidelineAnalyzed: boolean;

  // 처리 현황
  totalRecords: number;
  processedRecords: number;

  // 결과
  appropriateCount: number;
  inappropriateCount: number;
  needsReviewCount: number;

  // 파일
  resultExcelPath: string;
  logPath: string;

  // 상태
  status: 'running' | 'completed' | 'error' | 'cancelled';
  errorMessage?: string;
}

// --------------------------------------------
// 설정 (Config)
// --------------------------------------------
export interface Config {
  // Chrome CDP
  cdpUrl: string;             // 기본: http://localhost:9222

  // 경로
  downloadDir: string;
  resultDir: string;
  logDir: string;

  // API
  geminiApiKey: string;
  llmModel: string;           // gemini-2.0-flash 등

  // 타임아웃
  pageLoadTimeout: number;    // ms
  downloadTimeout: number;    // ms

  // 판단 기준
  confidenceThreshold: number; // 이 값 미만이면 "확인필요" (기본: 80)
}

// --------------------------------------------
// CLI 옵션
// --------------------------------------------
export interface CliOptions {
  guideline: string;          // 지침 PDF 경로
  output?: string;            // 결과 출력 경로
  verbose?: boolean;          // 상세 로그
  yes?: boolean;              // 모든 확인 프롬프트 자동 승인
  dryRun?: boolean;           // 테스트 모드 (실제 작업 안 함)
}
