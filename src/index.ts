#!/usr/bin/env node

import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import fs from 'fs';

import { logger } from './utils/logger';
import { getConfig } from './utils/config';
import { BrowserConnector } from './browser/connector';
import { ExecutionScraper } from './browser/scraper';
import { GuidelineAnalyzer } from './analyzer/guideline';
import { DocumentAnalyzer } from './analyzer/document';
import { AttachmentDownloader } from './downloader/attachment';
import { InspectionJudge } from './inspector/judge';
import { ResultExporter } from './output/excel';

const VERSION = '1.1.0';

function generateSessionId(): string {
  return Math.random().toString(36).substring(2, 10);
}

// ============================================
// 메인 프로그램 (Gemini API 불필요, 규칙 기반)
// ============================================

async function main() {
  const program = new Command();

  program
    .name('e-naradomum-rpa')
    .description('e나라도움 상시점검 RPA 자동화')
    .version(VERSION)
    .option('-o, --output <path>', '결과 출력 경로')
    .option('-v, --verbose', '상세 로그 출력')
    .parse(process.argv);

  const options = program.opts();

  // 배너 출력
  logger.banner('e나라도움 상시점검 RPA');
  console.log(chalk.gray(`버전: ${VERSION} (규칙 기반 - API 불필요)`));
  console.log();

  // 설정 로드
  const config = getConfig({
    geminiApiKey: '',
    resultDir: options.output || './results',
  });

  // 세션 ID 생성
  const sessionId = generateSessionId();

  // 로거 초기화
  logger.init(config.logDir, sessionId, options.verbose || false);

  // 결과 폴더 생성
  if (!fs.existsSync(config.resultDir)) {
    fs.mkdirSync(config.resultDir, { recursive: true });
  }

  let connector: BrowserConnector | null = null;

  try {
    // ========================================
    // Step 1: 지침 규정 로드 (하드코딩)
    // ========================================
    logger.step(1, 6, '지침 규정 로드');
    const guidelineAnalyzer = new GuidelineAnalyzer(config);
    const guideline = await guidelineAnalyzer.analyze();
    console.log();

    // ========================================
    // Step 2: 브라우저 연결
    // ========================================
    logger.step(2, 6, '브라우저 연결');
    connector = new BrowserConnector(config);

    const spinner = ora('Chrome에 연결 중...').start();
    const page = await connector.connect();
    spinner.succeed('Chrome에 연결됨');

    // 페이지 확인
    const isExecutionPage = await connector.isExecutionListPage();
    if (!isExecutionPage) {
      logger.warn('현재 페이지가 집행내역조회 화면이 아닐 수 있습니다. 계속 진행합니다.');
    } else {
      logger.success('집행내역조회 페이지 확인됨');
    }

    // 사업 정보 추출
    const projectInfo = await connector.getProjectInfo();
    const projectName = projectInfo?.name || '성남의료원';

    if (projectInfo) {
      logger.info(`사업: ${projectInfo.name}`);
    }
    console.log();

    // ========================================
    // Step 3: 집행내역 데이터 수집
    // ========================================
    logger.step(3, 6, '집행내역 데이터 수집');

    const scraper = new ExecutionScraper(page);
    const records = await scraper.getExecutionList();

    if (records.length === 0) {
      logger.warn('수집된 집행내역이 없습니다.');
      await connector.disconnect();
      process.exit(0);
    }

    logger.success(`${records.length}건 수집 완료`);
    console.log();

    // ========================================
    // Step 4: 첨부파일 다운로드
    // ========================================
    logger.step(4, 6, '첨부파일 다운로드');

    const downloader = new AttachmentDownloader(page, config, sessionId);
    const attachmentMap = await downloader.downloadIndividualAttachments(records);
    console.log();

    // ========================================
    // Step 5: 문서 분석 (패턴 매칭)
    // ========================================
    logger.step(5, 6, '문서 분석');

    const documentAnalyzer = new DocumentAnalyzer(config);

    for (const [recordId, attachments] of attachmentMap) {
      if (attachments.length > 0) {
        const analyzed = await documentAnalyzer.analyzeAttachments(attachments);
        attachmentMap.set(recordId, analyzed);
      }
    }

    logger.success('문서 분석 완료');
    console.log();

    // ========================================
    // Step 6: 규칙 기반 판단 + 엑셀 생성
    // ========================================
    logger.step(6, 6, '판단 및 엑셀 생성');

    const judge = new InspectionJudge(config, guideline);
    const results = await judge.judgeAll(records, attachmentMap);

    // 통계
    const appropriate = results.filter(r => r.judgment === 'appropriate').length;
    const inappropriate = results.filter(r => r.judgment === 'inappropriate').length;
    const needsReview = results.filter(r => r.judgment === 'needsReview').length;

    logger.divider();
    logger.info('판단 결과:');
    console.log(chalk.green(`  적정: ${appropriate}건`));
    console.log(chalk.red(`  부적정: ${inappropriate}건`));
    console.log(chalk.yellow(`  확인필요: ${needsReview}건`));
    logger.divider();
    console.log();

    // 엑셀 생성
    const exporter = new ResultExporter(config);
    const resultPath = await exporter.exportResults(records, results, projectName);

    console.log();
    logger.divider();
    logger.success('처리 완료!');
    logger.info(`결과 파일: ${resultPath}`);
    logger.divider();

    // 연결 해제
    await connector.disconnect();

  } catch (error) {
    logger.error('실행 중 오류 발생', error);

    if (connector) {
      await connector.disconnect();
    }

    process.exit(1);
  }
}

// 실행
main().catch((error) => {
  console.error('Unexpected error:', error);
  process.exit(1);
});
