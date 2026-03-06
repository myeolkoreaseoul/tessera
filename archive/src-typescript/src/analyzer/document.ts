import fs from 'fs';
import path from 'path';
import pdfParse from 'pdf-parse';
import { logger } from '../utils/logger';
import { Config, Attachment, DocumentAnalysis } from '../types';

/**
 * 문서 분석기 (패턴 매칭 기반, Gemini API 불필요)
 *
 * PDF 텍스트 추출 → 파일명/내용 기반 문서 유형 판별
 */
export class DocumentAnalyzer {
  private config: Config;

  constructor(config: Config) {
    this.config = config;
  }

  async analyzeAttachment(attachment: Attachment): Promise<Attachment> {
    logger.debug(`문서 분석: ${attachment.originalName}`);

    try {
      if (attachment.fileType === 'pdf') {
        return await this.analyzePdf(attachment);
      } else if (attachment.fileType === 'image') {
        attachment.extractedText = '[이미지 파일 - 수동 확인 필요]';
        attachment.analysisResult = this.guessFromFilename(attachment.originalName);
        return attachment;
      } else if (attachment.fileType === 'hwp') {
        attachment.extractedText = '[HWP 파일 - 수동 확인 필요]';
        attachment.analysisResult = this.guessFromFilename(attachment.originalName);
        return attachment;
      } else if (attachment.fileType === 'excel') {
        attachment.extractedText = '[엑셀 파일 - 수동 확인 필요]';
        attachment.analysisResult = this.guessFromFilename(attachment.originalName);
        return attachment;
      }
    } catch (error) {
      logger.warn(`문서 분석 실패: ${attachment.originalName}`, error);
    }

    return attachment;
  }

  private async analyzePdf(attachment: Attachment): Promise<Attachment> {
    const dataBuffer = fs.readFileSync(attachment.localPath);
    const pdfData = await pdfParse(dataBuffer);

    attachment.extractedText = pdfData.text;

    if (pdfData.text.trim().length > 20) {
      attachment.analysisResult = this.analyzeText(
        pdfData.text,
        attachment.originalName
      );
    } else {
      attachment.extractedText = '[스캔 PDF - 텍스트 없음]';
      attachment.analysisResult = this.guessFromFilename(attachment.originalName);
    }

    return attachment;
  }

  /**
   * 텍스트 + 파일명 기반 문서 분석 (패턴 매칭)
   */
  private analyzeText(text: string, filename: string): DocumentAnalysis {
    const docType = this.detectDocumentType(text, filename);
    const amount = this.extractAmount(text);
    const date = this.extractDate(text);
    const vendor = this.extractVendor(text);
    const flags = this.detectFlags(text, filename, docType);

    return {
      documentType: docType,
      date,
      amount,
      vendor,
      summary: this.generateSummary(text, docType),
      flags,
    };
  }

  /**
   * 파일명만으로 문서 유형 추정
   */
  private guessFromFilename(filename: string): DocumentAnalysis {
    return {
      documentType: this.detectDocumentType('', filename),
      date: '',
      amount: 0,
      vendor: '',
      summary: `파일: ${filename}`,
      flags: ['텍스트추출불가'],
    };
  }

  /**
   * 문서 유형 판별
   */
  private detectDocumentType(text: string, filename: string): string {
    const combined = (text + ' ' + filename).toLowerCase();

    // 파일명 기반 우선
    const fnLower = filename.toLowerCase();
    if (fnLower.includes('지출결의')) return '지출결의서';
    if (fnLower.includes('입금의뢰')) return '입금의뢰서';
    if (fnLower.includes('급여') || fnLower.includes('인건비')) return '급여명세서';
    if (fnLower.includes('출장보고')) return '출장보고서';
    if (fnLower.includes('출장명령')) return '출장명령서';
    if (fnLower.includes('계약')) return '계약서';
    if (fnLower.includes('견적')) return '견적서';
    if (fnLower.includes('회의록')) return '회의록';
    if (fnLower.includes('인센티브')) return '인센티브지급서';
    if (fnLower.includes('소급')) return '소급분지급서';

    // 텍스트 기반
    if (combined.includes('세금계산서')) return '세금계산서';
    if (combined.includes('카드매출전표') || combined.includes('신용카드')) return '카드매출전표';
    if (combined.includes('현금영수증')) return '현금영수증';
    if (combined.includes('간이영수증')) return '간이영수증';
    if (combined.includes('거래명세')) return '거래명세서';
    if (combined.includes('지출결의')) return '지출결의서';
    if (combined.includes('입금의뢰')) return '입금의뢰서';
    if (combined.includes('급여명세') || combined.includes('급여대장')) return '급여명세서';
    if (combined.includes('출장보고')) return '출장보고서';
    if (combined.includes('출장명령')) return '출장명령서';
    if (combined.includes('계약서')) return '계약서';
    if (combined.includes('견적서')) return '견적서';
    if (combined.includes('회의록')) return '회의록';
    if (combined.includes('영수증')) return '영수증';
    if (combined.includes('청구서')) return '청구서';
    if (combined.includes('보험') && combined.includes('납부')) return '4대보험납부확인서';

    return '기타';
  }

  /**
   * 텍스트에서 금액 추출 (가장 큰 금액)
   */
  private extractAmount(text: string): number {
    const patterns = [
      /합\s*계[^\d]*?([\d,]+)\s*원/g,
      /총[^\d]*?([\d,]+)\s*원/g,
      /금\s*액[^\d]*?([\d,]+)/g,
      /([\d,]{4,})\s*원/g,
    ];

    let maxAmount = 0;
    for (const pattern of patterns) {
      let match;
      while ((match = pattern.exec(text)) !== null) {
        const amount = parseInt(match[1].replace(/,/g, ''), 10);
        if (amount > maxAmount && amount < 10000000000) {
          maxAmount = amount;
        }
      }
    }

    return maxAmount;
  }

  /**
   * 텍스트에서 날짜 추출
   */
  private extractDate(text: string): string {
    const patterns = [
      /(\d{4})[.\-/년]\s*(\d{1,2})[.\-/월]\s*(\d{1,2})/,
      /(\d{4})(\d{2})(\d{2})/,
    ];

    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (match) {
        const y = match[1];
        const m = match[2].padStart(2, '0');
        const d = match[3].padStart(2, '0');
        if (parseInt(y) >= 2020 && parseInt(y) <= 2030) {
          return `${y}-${m}-${d}`;
        }
      }
    }
    return '';
  }

  /**
   * 텍스트에서 거래처명 추출
   */
  private extractVendor(text: string): string {
    const patterns = [
      /공급\s*(?:자|받는\s*자)[^\n]*?(?:상\s*호|명칭)[^\n]*?[:\s]([^\n\r(]{2,20})/,
      /거래처[:\s]*([^\n\r]{2,20})/,
      /(?:주\)|㈜|주식회사)\s*([가-힣a-zA-Z]{2,15})/,
    ];

    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (match) return match[1].trim();
    }
    return '';
  }

  /**
   * 주의 플래그 탐지
   */
  private detectFlags(text: string, filename: string, docType: string): string[] {
    const flags: string[] = [];

    if (docType === '간이영수증') flags.push('간이영수증');
    if (docType === '기타') flags.push('문서유형불명');
    if (!text || text.length < 50) flags.push('텍스트부족');
    if (text.includes('상품권') || text.includes('쿠폰')) flags.push('상품권/쿠폰');

    return flags;
  }

  /**
   * 내용 요약 생성
   */
  private generateSummary(text: string, docType: string): string {
    const clean = text.replace(/\s+/g, ' ').trim();
    const snippet = clean.substring(0, 100);
    return `[${docType}] ${snippet}...`;
  }

  /**
   * 여러 첨부파일 일괄 분석
   */
  async analyzeAttachments(attachments: Attachment[]): Promise<Attachment[]> {
    logger.info(`${attachments.length}개 문서 분석 시작...`);

    const results: Attachment[] = [];
    for (let i = 0; i < attachments.length; i++) {
      logger.progress(i + 1, attachments.length, attachments[i].originalName);
      const analyzed = await this.analyzeAttachment(attachments[i]);
      results.push(analyzed);
    }

    return results;
  }
}
