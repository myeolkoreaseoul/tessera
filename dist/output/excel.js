"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ResultExporter = void 0;
const exceljs_1 = __importDefault(require("exceljs"));
const path_1 = __importDefault(require("path"));
const dayjs_1 = __importDefault(require("dayjs"));
const logger_1 = require("../utils/logger");
class ResultExporter {
    config;
    workbook;
    constructor(config) {
        this.config = config;
        this.workbook = new exceljs_1.default.Workbook();
        this.workbook.creator = 'e나라도움 RPA';
        this.workbook.created = new Date();
    }
    /**
     * 결과 엑셀 생성
     */
    async exportResults(records, results, projectName) {
        logger_1.logger.info('결과 엑셀 생성 중...');
        // 데이터 준비
        const rows = records.map((record, i) => ({
            record,
            result: results[i],
        }));
        // 시트 1: 전체 목록
        this.createAllSheet(rows);
        // 시트 2: 부적정/확인필요 건
        this.createIssueSheet(rows);
        // 시트 3: 통계
        this.createStatsSheet(rows);
        // 파일 저장
        const timestamp = (0, dayjs_1.default)().format('YYYYMMDD_HHmmss');
        const safeName = projectName.replace(/[<>:"/\\|?*]/g, '_').substring(0, 50);
        const filename = `${safeName}_${timestamp}_점검결과.xlsx`;
        const filepath = path_1.default.join(this.config.resultDir, filename);
        await this.workbook.xlsx.writeFile(filepath);
        logger_1.logger.success(`결과 파일 생성: ${filename}`);
        return filepath;
    }
    /**
     * 전체 목록 시트
     */
    createAllSheet(rows) {
        const sheet = this.workbook.addWorksheet('전체 목록');
        // 헤더
        const headers = [
            '순번', '집행처리일자', '작성일자', '정산구분',
            '집행비목', '세목명', '거래처명',
            '공급가액', '부가세', '집행금액',
            '첨부파일수', '판단', '점검의견', '판단근거',
            '원본상태', '원본검토일'
        ];
        const headerRow = sheet.addRow(headers);
        headerRow.font = { bold: true };
        headerRow.fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: 'FFE0E0E0' },
        };
        // 데이터 행
        for (const { record, result } of rows) {
            const row = sheet.addRow([
                record.rowNumber,
                record.executionDate,
                record.writeDate,
                record.settlementType,
                record.budgetCategory,
                record.subCategory,
                record.vendorName,
                record.supplyAmount,
                record.vat,
                record.totalAmount,
                record.attachmentCount,
                this.getJudgmentText(result.judgment),
                result.opinion,
                result.reasoning,
                record.reviewStatus,
                record.reviewDate,
            ]);
            // 조건부 서식
            this.applyRowStyle(row, result.judgment);
        }
        // 컬럼 너비 설정
        sheet.columns = [
            { width: 6 }, // 순번
            { width: 12 }, // 집행처리일자
            { width: 12 }, // 작성일자
            { width: 12 }, // 정산구분
            { width: 30 }, // 집행비목
            { width: 20 }, // 세목명
            { width: 25 }, // 거래처명
            { width: 15 }, // 공급가액
            { width: 12 }, // 부가세
            { width: 15 }, // 집행금액
            { width: 8 }, // 첨부파일수
            { width: 10 }, // 판단
            { width: 50 }, // 점검의견
            { width: 50 }, // 판단근거
            { width: 10 }, // 원본상태
            { width: 12 }, // 원본검토일
        ];
        // 필터 설정
        sheet.autoFilter = {
            from: { row: 1, column: 1 },
            to: { row: rows.length + 1, column: headers.length },
        };
    }
    /**
     * 부적정/확인필요 시트
     */
    createIssueSheet(rows) {
        const sheet = this.workbook.addWorksheet('부적정_확인필요');
        // 부적정/확인필요 건만 필터
        const issueRows = rows.filter(r => r.result.judgment === 'inappropriate' || r.result.judgment === 'needsReview');
        if (issueRows.length === 0) {
            sheet.addRow(['부적정 또는 확인필요 건이 없습니다.']);
            return;
        }
        // 헤더
        const headers = [
            '순번', '집행처리일자', '비목', '금액',
            '판단', '이슈코드', '이슈설명', '점검의견', '판단근거'
        ];
        const headerRow = sheet.addRow(headers);
        headerRow.font = { bold: true };
        headerRow.fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: 'FFE0E0E0' },
        };
        // 데이터 행
        for (const { record, result } of issueRows) {
            const issueCodes = result.issues.map(i => i.code).join(', ');
            const issueDescs = result.issues.map(i => i.description).join(', ');
            const row = sheet.addRow([
                record.rowNumber,
                record.executionDate,
                record.budgetCategory,
                record.totalAmount,
                this.getJudgmentText(result.judgment),
                issueCodes,
                issueDescs,
                result.opinion,
                result.reasoning,
            ]);
            this.applyRowStyle(row, result.judgment);
        }
        // 컬럼 너비 설정
        sheet.columns = [
            { width: 6 }, // 순번
            { width: 12 }, // 집행처리일자
            { width: 30 }, // 비목
            { width: 15 }, // 금액
            { width: 10 }, // 판단
            { width: 20 }, // 이슈코드
            { width: 40 }, // 이슈설명
            { width: 50 }, // 점검의견
            { width: 50 }, // 판단근거
        ];
    }
    /**
     * 통계 시트
     */
    createStatsSheet(rows) {
        const sheet = this.workbook.addWorksheet('통계');
        // 통계 계산
        const total = rows.length;
        const appropriate = rows.filter(r => r.result.judgment === 'appropriate').length;
        const inappropriate = rows.filter(r => r.result.judgment === 'inappropriate').length;
        const needsReview = rows.filter(r => r.result.judgment === 'needsReview').length;
        const totalAmount = rows.reduce((sum, r) => sum + r.record.totalAmount, 0);
        const appropriateAmount = rows
            .filter(r => r.result.judgment === 'appropriate')
            .reduce((sum, r) => sum + r.record.totalAmount, 0);
        const inappropriateAmount = rows
            .filter(r => r.result.judgment === 'inappropriate')
            .reduce((sum, r) => sum + r.record.totalAmount, 0);
        const needsReviewAmount = rows
            .filter(r => r.result.judgment === 'needsReview')
            .reduce((sum, r) => sum + r.record.totalAmount, 0);
        // 헤더
        const headers = ['구분', '건수', '금액', '비율'];
        const headerRow = sheet.addRow(headers);
        headerRow.font = { bold: true };
        headerRow.fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: 'FFE0E0E0' },
        };
        // 데이터
        sheet.addRow(['전체', total, totalAmount, '100%']);
        const appropriateRow = sheet.addRow([
            '적정',
            appropriate,
            appropriateAmount,
            `${((appropriate / total) * 100).toFixed(1)}%`
        ]);
        appropriateRow.fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: 'FFE8F5E9' }, // 연한 초록
        };
        const inappropriateRow = sheet.addRow([
            '부적정',
            inappropriate,
            inappropriateAmount,
            `${((inappropriate / total) * 100).toFixed(1)}%`
        ]);
        inappropriateRow.fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: 'FFFFEBEE' }, // 연한 빨강
        };
        const needsReviewRow = sheet.addRow([
            '확인필요',
            needsReview,
            needsReviewAmount,
            `${((needsReview / total) * 100).toFixed(1)}%`
        ]);
        needsReviewRow.fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: 'FFFFFDE7' }, // 연한 노랑
        };
        // 컬럼 너비 및 숫자 포맷
        sheet.columns = [
            { width: 15 },
            { width: 10 },
            { width: 20 },
            { width: 10 },
        ];
        // 금액 컬럼 숫자 포맷
        sheet.getColumn(3).numFmt = '#,##0';
    }
    /**
     * 판단 결과 텍스트 변환
     */
    getJudgmentText(judgment) {
        switch (judgment) {
            case 'appropriate':
                return '적정';
            case 'inappropriate':
                return '부적정';
            case 'needsReview':
                return '확인필요';
            default:
                return '알 수 없음';
        }
    }
    /**
     * 행 스타일 적용
     */
    applyRowStyle(row, judgment) {
        let bgColor;
        switch (judgment) {
            case 'inappropriate':
                bgColor = 'FFFFEBEE'; // 연한 빨강
                break;
            case 'needsReview':
                bgColor = 'FFFFFDE7'; // 연한 노랑
                break;
            default:
                return; // 적정은 기본 색상
        }
        row.eachCell(cell => {
            cell.fill = {
                type: 'pattern',
                pattern: 'solid',
                fgColor: { argb: bgColor },
            };
        });
    }
}
exports.ResultExporter = ResultExporter;
//# sourceMappingURL=excel.js.map