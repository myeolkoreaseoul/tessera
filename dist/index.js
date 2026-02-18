#!/usr/bin/env node
"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const commander_1 = require("commander");
const chalk_1 = __importDefault(require("chalk"));
const ora_1 = __importDefault(require("ora"));
const fs_1 = __importDefault(require("fs"));
const logger_1 = require("./utils/logger");
const config_1 = require("./utils/config");
const connector_1 = require("./browser/connector");
const scraper_1 = require("./browser/scraper");
const guideline_1 = require("./analyzer/guideline");
const document_1 = require("./analyzer/document");
const attachment_1 = require("./downloader/attachment");
const judge_1 = require("./inspector/judge");
const excel_1 = require("./output/excel");
const VERSION = '1.1.0';
function generateSessionId() {
    return Math.random().toString(36).substring(2, 10);
}
// ============================================
// 메인 프로그램 (Gemini API 불필요, 규칙 기반)
// ============================================
async function main() {
    const program = new commander_1.Command();
    program
        .name('e-naradomum-rpa')
        .description('e나라도움 상시점검 RPA 자동화')
        .version(VERSION)
        .option('-o, --output <path>', '결과 출력 경로')
        .option('-v, --verbose', '상세 로그 출력')
        .parse(process.argv);
    const options = program.opts();
    // 배너 출력
    logger_1.logger.banner('e나라도움 상시점검 RPA');
    console.log(chalk_1.default.gray(`버전: ${VERSION} (규칙 기반 - API 불필요)`));
    console.log();
    // 설정 로드
    const config = (0, config_1.getConfig)({
        geminiApiKey: '',
        resultDir: options.output || './results',
    });
    // 세션 ID 생성
    const sessionId = generateSessionId();
    // 로거 초기화
    logger_1.logger.init(config.logDir, sessionId, options.verbose || false);
    // 결과 폴더 생성
    if (!fs_1.default.existsSync(config.resultDir)) {
        fs_1.default.mkdirSync(config.resultDir, { recursive: true });
    }
    let connector = null;
    try {
        // ========================================
        // Step 1: 지침 규정 로드 (하드코딩)
        // ========================================
        logger_1.logger.step(1, 6, '지침 규정 로드');
        const guidelineAnalyzer = new guideline_1.GuidelineAnalyzer(config);
        const guideline = await guidelineAnalyzer.analyze();
        console.log();
        // ========================================
        // Step 2: 브라우저 연결
        // ========================================
        logger_1.logger.step(2, 6, '브라우저 연결');
        connector = new connector_1.BrowserConnector(config);
        const spinner = (0, ora_1.default)('Chrome에 연결 중...').start();
        const page = await connector.connect();
        spinner.succeed('Chrome에 연결됨');
        // 페이지 확인
        const isExecutionPage = await connector.isExecutionListPage();
        if (!isExecutionPage) {
            logger_1.logger.warn('현재 페이지가 집행내역조회 화면이 아닐 수 있습니다. 계속 진행합니다.');
        }
        else {
            logger_1.logger.success('집행내역조회 페이지 확인됨');
        }
        // 사업 정보 추출
        const projectInfo = await connector.getProjectInfo();
        const projectName = projectInfo?.name || '성남의료원';
        if (projectInfo) {
            logger_1.logger.info(`사업: ${projectInfo.name}`);
        }
        console.log();
        // ========================================
        // Step 3: 집행내역 데이터 수집
        // ========================================
        logger_1.logger.step(3, 6, '집행내역 데이터 수집');
        const scraper = new scraper_1.ExecutionScraper(page);
        const records = await scraper.getExecutionList();
        if (records.length === 0) {
            logger_1.logger.warn('수집된 집행내역이 없습니다.');
            await connector.disconnect();
            process.exit(0);
        }
        logger_1.logger.success(`${records.length}건 수집 완료`);
        console.log();
        // ========================================
        // Step 4: 첨부파일 다운로드
        // ========================================
        logger_1.logger.step(4, 6, '첨부파일 다운로드');
        const downloader = new attachment_1.AttachmentDownloader(page, config, sessionId);
        const attachmentMap = await downloader.downloadIndividualAttachments(records);
        console.log();
        // ========================================
        // Step 5: 문서 분석 (패턴 매칭)
        // ========================================
        logger_1.logger.step(5, 6, '문서 분석');
        const documentAnalyzer = new document_1.DocumentAnalyzer(config);
        for (const [recordId, attachments] of attachmentMap) {
            if (attachments.length > 0) {
                const analyzed = await documentAnalyzer.analyzeAttachments(attachments);
                attachmentMap.set(recordId, analyzed);
            }
        }
        logger_1.logger.success('문서 분석 완료');
        console.log();
        // ========================================
        // Step 6: 규칙 기반 판단 + 엑셀 생성
        // ========================================
        logger_1.logger.step(6, 6, '판단 및 엑셀 생성');
        const judge = new judge_1.InspectionJudge(config, guideline);
        const results = await judge.judgeAll(records, attachmentMap);
        // 통계
        const appropriate = results.filter(r => r.judgment === 'appropriate').length;
        const inappropriate = results.filter(r => r.judgment === 'inappropriate').length;
        const needsReview = results.filter(r => r.judgment === 'needsReview').length;
        logger_1.logger.divider();
        logger_1.logger.info('판단 결과:');
        console.log(chalk_1.default.green(`  적정: ${appropriate}건`));
        console.log(chalk_1.default.red(`  부적정: ${inappropriate}건`));
        console.log(chalk_1.default.yellow(`  확인필요: ${needsReview}건`));
        logger_1.logger.divider();
        console.log();
        // 엑셀 생성
        const exporter = new excel_1.ResultExporter(config);
        const resultPath = await exporter.exportResults(records, results, projectName);
        console.log();
        logger_1.logger.divider();
        logger_1.logger.success('처리 완료!');
        logger_1.logger.info(`결과 파일: ${resultPath}`);
        logger_1.logger.divider();
        // 연결 해제
        await connector.disconnect();
    }
    catch (error) {
        logger_1.logger.error('실행 중 오류 발생', error);
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
//# sourceMappingURL=index.js.map