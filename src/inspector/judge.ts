import { logger } from '../utils/logger';
import {
  Config,
  ExecutionRecord,
  Attachment,
  Guideline,
  InspectionResult,
  InspectionIssue,
} from '../types';

/**
 * 집행건 점검 판단기 (규칙 기반, Gemini API 불필요)
 *
 * 보수적 판단 원칙: 확실한 경우에만 적정/부적정, 나머지는 확인필요
 */
export class InspectionJudge {
  private config: Config;
  private guideline: Guideline;

  constructor(config: Config, guideline: Guideline) {
    this.config = config;
    this.guideline = guideline;
  }

  async judge(
    record: ExecutionRecord,
    attachments: Attachment[]
  ): Promise<InspectionResult> {
    const issues = this.checkAllRules(record, attachments);

    const hasHigh = issues.some(i => i.severity === 'high');
    const hasMedium = issues.some(i => i.severity === 'medium');

    let judgment: 'appropriate' | 'inappropriate' | 'needsReview';
    let confidence: number;

    if (hasHigh) {
      // 증빙 미첨부 등 명백한 문제
      judgment = 'inappropriate';
      confidence = 90;
    } else if (hasMedium || issues.length > 0) {
      // 경미한 이슈 또는 불확실
      judgment = 'needsReview';
      confidence = 60;
    } else if (attachments.length > 0) {
      // 첨부파일 있고 이슈 없으면 → 확인필요 (보수적)
      // 증빙 내용-집행내역 일치 여부는 수동 확인 필요
      judgment = 'needsReview';
      confidence = 70;
    } else {
      judgment = 'needsReview';
      confidence = 50;
    }

    return {
      executionId: record.id,
      judgment,
      confidence,
      issues,
      opinion: this.generateOpinion(record, attachments, issues, judgment),
      reasoning: this.generateReasoning(record, attachments, issues),
      appliedRules: ['기본 증빙 규정', '비목별 집행 기준'],
    };
  }

  private checkAllRules(
    record: ExecutionRecord,
    attachments: Attachment[]
  ): InspectionIssue[] {
    const issues: InspectionIssue[] = [];

    // 1. 첨부파일 없음
    if (attachments.length === 0) {
      issues.push({
        code: 'NO_ATTACHMENT',
        category: '증빙누락',
        description: '증빙서류 미첨부',
        severity: 'high',
      });
      return issues; // 더 이상 체크 불필요
    }

    // 2. 비목별 필수 증빙 확인
    const categoryRule = this.findCategoryRule(record.budgetCategory);
    if (categoryRule) {
      const attachedTypes = attachments
        .filter(a => a.analysisResult)
        .map(a => a.analysisResult!.documentType);

      for (const required of categoryRule.required) {
        const found = attachedTypes.some(t =>
          t.includes(required) || required.includes(t)
        );
        if (!found) {
          // 증빙 누락이지만, 파일명/텍스트로 판별 못한 경우도 있으므로 medium
          issues.push({
            code: 'MISSING_REQUIRED',
            category: '필수증빙확인',
            description: `${required} 확인 필요`,
            severity: 'medium',
          });
        }
      }

      // 3. 건당 금액 한도
      if (categoryRule.limit?.perCase && record.totalAmount > categoryRule.limit.perCase) {
        issues.push({
          code: 'OVER_LIMIT',
          category: '한도초과',
          description: `건당 한도 ${categoryRule.limit.perCase.toLocaleString()}원 초과 (집행: ${record.totalAmount.toLocaleString()}원)`,
          severity: 'high',
        });
      }
    }

    // 4. 제한 항목 키워드 확인
    const combinedText = attachments
      .map(a => a.extractedText || '')
      .join(' ')
      .toLowerCase();

    if (combinedText.includes('상품권') || combinedText.includes('쿠폰')) {
      issues.push({
        code: 'GIFT_CARD',
        category: '제한항목',
        description: '상품권/쿠폰 관련 내용 발견',
        severity: 'high',
      });
    }

    // 5. 간이영수증 확인
    const hasSimpleReceipt = attachments.some(
      a => a.analysisResult?.documentType === '간이영수증'
    );
    if (hasSimpleReceipt && record.totalAmount > 30000) {
      issues.push({
        code: 'SIMPLE_RECEIPT',
        category: '부적격증빙',
        description: '3만원 초과 간이영수증 사용',
        severity: 'medium',
      });
    }

    // 6. 문서 유형 불명
    const unknownDocs = attachments.filter(
      a => a.analysisResult?.documentType === '기타'
    );
    if (unknownDocs.length > 0) {
      issues.push({
        code: 'UNKNOWN_DOC',
        category: '문서확인',
        description: `문서 유형 불명 ${unknownDocs.length}건`,
        severity: 'low',
      });
    }

    return issues;
  }

  private findCategoryRule(budgetCategory: string) {
    for (const [key, rule] of Object.entries(this.guideline.rules)) {
      if (budgetCategory.includes(key) || key.includes(budgetCategory)) {
        return rule;
      }
    }
    return null;
  }

  private generateOpinion(
    record: ExecutionRecord,
    attachments: Attachment[],
    issues: InspectionIssue[],
    judgment: string
  ): string {
    if (judgment === 'inappropriate') {
      const descs = issues.filter(i => i.severity === 'high').map(i => i.description);
      return descs.join(', ') + ' - 보완 요청';
    }

    if (judgment === 'needsReview') {
      if (issues.length > 0) {
        const descs = issues.map(i => i.description);
        return descs.join(', ') + ' - 확인 필요';
      }
      // 첨부파일 있지만 수동 검증 필요
      const docTypes = attachments
        .filter(a => a.analysisResult)
        .map(a => a.analysisResult!.documentType);
      return `증빙 ${attachments.length}건 (${docTypes.join(', ')}) - 내용 일치 여부 확인 필요`;
    }

    return '적정';
  }

  private generateReasoning(
    record: ExecutionRecord,
    attachments: Attachment[],
    issues: InspectionIssue[]
  ): string {
    const parts: string[] = [];

    parts.push(`비목: ${record.budgetCategory}`);
    parts.push(`금액: ${record.totalAmount.toLocaleString()}원`);
    parts.push(`첨부: ${attachments.length}건`);

    if (issues.length > 0) {
      parts.push(`이슈: ${issues.map(i => i.description).join('; ')}`);
    }

    const docTypes = attachments
      .filter(a => a.analysisResult)
      .map(a => `${a.originalName}(${a.analysisResult!.documentType})`);
    if (docTypes.length > 0) {
      parts.push(`문서: ${docTypes.join(', ')}`);
    }

    return parts.join(' | ');
  }

  async judgeAll(
    records: ExecutionRecord[],
    attachmentMap: Map<string, Attachment[]>
  ): Promise<InspectionResult[]> {
    logger.info(`${records.length}건 판단 시작...`);

    const results: InspectionResult[] = [];

    for (let i = 0; i < records.length; i++) {
      const record = records[i];
      const attachments = attachmentMap.get(record.id) || [];

      logger.progress(i + 1, records.length, `${record.budgetCategory}`);

      const result = await this.judge(record, attachments);
      results.push(result);
    }

    return results;
  }
}
