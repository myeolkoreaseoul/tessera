"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ExecutionScraper = void 0;
const logger_1 = require("../utils/logger");
/**
 * e나라도움 집행내역 스크래퍼
 */
class ExecutionScraper {
    page;
    constructor(page) {
        this.page = page;
    }
    /**
     * 집행내역 목록 전체 가져오기 (스크롤하면서 모든 행 수집)
     */
    async getExecutionList() {
        logger_1.logger.info('집행내역 목록 수집 중...');
        const records = [];
        const seenIds = new Set();
        try {
            // 테이블이 로드될 때까지 대기
            await this.page.waitForSelector('#DD001002QGridObj', { timeout: 10000 });
            // 총 건수 확인
            const totalCount = await this.getTotalCount();
            logger_1.logger.info(`총 ${totalCount}건 발견`);
            // 스크롤 컨테이너 찾기 (IBSectionScroll 중 가장 큰 것)
            const scrollContainers = await this.page.$$('#DD001002QGridObj .IBSectionScroll');
            let scrollContainer = null;
            let maxScrollHeight = 0;
            for (const container of scrollContainers) {
                const scrollHeight = await container.evaluate((el) => el.scrollHeight);
                if (scrollHeight > maxScrollHeight) {
                    maxScrollHeight = scrollHeight;
                    scrollContainer = container;
                }
            }
            if (!scrollContainer) {
                // 폴백: IBBodyMid 시도
                scrollContainer = await this.page.$('#DD001002QGridObj .IBBodyMid');
                if (!scrollContainer) {
                    logger_1.logger.warn('스크롤 컨테이너를 찾을 수 없습니다. 기본 방식으로 시도...');
                    return this.getExecutionListBasic();
                }
            }
            // 스크롤을 맨 위로 리셋
            await scrollContainer.evaluate((el) => {
                el.scrollTop = 0;
            });
            await this.page.waitForTimeout(500);
            logger_1.logger.debug('스크롤 맨 위로 리셋');
            // 스크롤하면서 모든 행 수집
            let lastRecordCount = 0;
            let noNewRecordsCount = 0;
            const maxScrollAttempts = 100; // 무한 루프 방지 (더 많이 시도)
            // 스크롤 가능한 높이 확인
            const scrollHeight = await scrollContainer.evaluate((el) => el.scrollHeight);
            const clientHeight = await scrollContainer.evaluate((el) => el.clientHeight);
            // 가상 스크롤에서는 한 행 높이(약 30px) 기준으로 5행씩 스크롤
            const rowHeight = 30;
            const scrollStep = rowHeight * 5; // 약 5행씩 스크롤 (wheel 이벤트와 함께 사용)
            logger_1.logger.debug(`스크롤 높이: ${scrollHeight}, 클라이언트 높이: ${clientHeight}, 스크롤 단위: ${scrollStep}`);
            for (let attempt = 0; attempt < maxScrollAttempts; attempt++) {
                // 현재 보이는 행들 수집
                const newRecords = await this.collectVisibleRows(seenIds);
                records.push(...newRecords);
                // 진행률 표시 (totalCount가 0이면 수집 건수만 표시)
                if (totalCount > 0) {
                    logger_1.logger.progress(records.length, totalCount, `수집 중`);
                }
                else {
                    logger_1.logger.debug(`${records.length}건 수집됨`);
                }
                // 새로운 레코드가 없으면 카운트 증가
                if (records.length === lastRecordCount) {
                    noNewRecordsCount++;
                    if (noNewRecordsCount >= 10) {
                        // 10번 연속 새 레코드 없으면 종료 (작은 스크롤 단위 때문에 더 많이 시도)
                        break;
                    }
                }
                else {
                    noNewRecordsCount = 0;
                    lastRecordCount = records.length;
                }
                // 목표 건수에 도달했으면 종료
                if (totalCount > 0 && records.length >= totalCount) {
                    break;
                }
                // 스크롤 다운 (wheel 이벤트 사용)
                await scrollContainer.evaluate((el, step) => {
                    // scrollTop 변경
                    el.scrollTop += step;
                    // wheel 이벤트 발생시켜 가상 스크롤 트리거
                    const wheelEvent = new WheelEvent('wheel', {
                        deltaY: step,
                        deltaMode: 0,
                        bubbles: true,
                        cancelable: true
                    });
                    el.dispatchEvent(wheelEvent);
                    // scroll 이벤트도 발생
                    el.dispatchEvent(new Event('scroll', { bubbles: true }));
                }, scrollStep);
                // 스크롤 후 데이터 로드 대기 (가상 스크롤 렌더링 시간)
                await this.page.waitForTimeout(300);
            }
            logger_1.logger.success(`${records.length}건 수집 완료`);
        }
        catch (error) {
            logger_1.logger.error('집행내역 수집 실패', error);
        }
        return records;
    }
    /**
     * 총 건수 가져오기
     */
    async getTotalCount() {
        try {
            const count = await this.page.evaluate(() => {
                const text = document.body.innerText;
                // 여러 패턴 시도
                const patterns = [
                    /Total\s*[@:]\s*(\d+)\s*건/i,
                    /Total\s*:\s*(\d+)/i,
                    /총\s*(\d+)\s*건/,
                    /(\d+)\s*건\s*조회/,
                ];
                for (const pattern of patterns) {
                    const match = text.match(pattern);
                    if (match)
                        return parseInt(match[1]);
                }
                return 0;
            });
            return count;
        }
        catch {
            return 0;
        }
    }
    /**
     * 현재 보이는 행들 수집
     */
    async collectVisibleRows(seenIds) {
        const newRecords = [];
        // IBBodyMid 내의 행들 수집 (좌우 패널 모두 확인)
        const rowData = await this.page.evaluate(() => {
            // 모든 IBBodyMid 요소 가져오기 (좌측 고정 + 우측 스크롤 패널)
            const bodies = document.querySelectorAll('#DD001002QGridObj .IBBodyMid');
            if (bodies.length === 0)
                return [];
            // 각 패널의 행 수 확인 (가장 많은 행을 가진 패널 기준)
            let maxRows = 0;
            bodies.forEach(body => {
                const rows = body.querySelectorAll('tr');
                if (rows.length > maxRows)
                    maxRows = rows.length;
            });
            const results = [];
            // 각 행에 대해 모든 패널의 셀을 합침
            for (let rowIdx = 0; rowIdx < maxRows; rowIdx++) {
                let allCells = [];
                bodies.forEach(body => {
                    const rows = body.querySelectorAll('tr');
                    const row = rows[rowIdx];
                    if (row) {
                        const cells = row.querySelectorAll('td');
                        const cellTexts = Array.from(cells).map(c => c.textContent?.trim() || '');
                        allCells = allCells.concat(cellTexts);
                    }
                });
                if (allCells.length < 5)
                    continue; // 데이터 행이 아님
                // 날짜 형식이 있는지 확인 (데이터 행 판별)
                const hasDate = allCells.some(t => /^\d{4}-\d{2}-\d{2}$/.test(t));
                if (!hasDate)
                    continue;
                // 고유 ID 생성 (처음 15개 셀 - 충분히 고유하면서 안정적)
                const uniqueKey = allCells.slice(0, 15).join('|');
                results.push({
                    rowIndex: rowIdx,
                    cells: allCells,
                    uniqueKey
                });
            }
            return results;
        });
        for (const data of rowData) {
            if (seenIds.has(data.uniqueKey))
                continue;
            seenIds.add(data.uniqueKey);
            const record = this.parseRowData(data.cells, seenIds.size);
            if (record) {
                newRecords.push(record);
            }
        }
        return newRecords;
    }
    /**
     * 셀 데이터로 ExecutionRecord 생성
     */
    parseRowData(cells, rowNumber) {
        try {
            if (cells.length < 10)
                return null;
            // 날짜 찾기
            let executionDate = '';
            let writeDate = '';
            for (const cell of cells) {
                if (/^\d{4}-\d{2}-\d{2}$/.test(cell)) {
                    if (!executionDate)
                        executionDate = cell;
                    else if (!writeDate)
                        writeDate = cell;
                }
            }
            // e나라도움 테이블 구조에 맞게 파싱
            // 실제 인덱스는 테이블 구조에 따라 조정 필요
            const record = {
                id: `row-${rowNumber}`,
                rowNumber,
                executionDate: executionDate || cells[2] || '',
                writeDate: writeDate || cells[3] || '',
                settlementType: cells[5] || '',
                budgetCategory: cells[8] || '',
                subCategory: cells[9] || '',
                vendorName: cells[11] || '',
                supplyAmount: 0,
                vat: 0,
                cancelAmount: 0,
                totalAmount: this.parseAmount(cells),
                attachmentCount: 0,
                attachmentLinks: [],
                reviewStatus: '',
                reviewDate: '',
                remarks: '',
                existingOpinion: '',
            };
            return record;
        }
        catch {
            return null;
        }
    }
    /**
     * 금액 파싱 (숫자 형식 찾기)
     */
    parseAmount(cells) {
        for (const cell of cells) {
            // 금액 형식 (콤마 포함 숫자)
            if (/^[\d,]+$/.test(cell) && cell.length > 3) {
                return parseInt(cell.replace(/,/g, '')) || 0;
            }
        }
        return 0;
    }
    /**
     * 기본 방식으로 집행내역 수집 (폴백)
     */
    async getExecutionListBasic() {
        const records = [];
        const rows = await this.page.$$('table tbody tr');
        for (let i = 0; i < rows.length; i++) {
            try {
                const record = await this.parseTableRow(rows[i], i + 1);
                if (record) {
                    records.push(record);
                }
            }
            catch (error) {
                logger_1.logger.warn(`행 ${i + 1} 파싱 실패`, error);
            }
        }
        return records;
    }
    /**
     * 테이블 행 파싱
     */
    async parseTableRow(row, rowNumber) {
        try {
            const cells = await row.$$('td');
            if (cells.length < 10) {
                return null; // 데이터 행이 아님
            }
            // 셀 텍스트 추출
            const getText = async (cell) => {
                return (await cell.textContent())?.trim() || '';
            };
            const getNumber = async (cell) => {
                const text = await getText(cell);
                return parseInt(text.replace(/[^0-9-]/g, '')) || 0;
            };
            // 첨부파일 링크 추출
            const attachmentLinks = [];
            const links = await row.$$('a[href*="download"], a:has-text("보기")');
            for (const link of links) {
                const href = await link.getAttribute('href');
                if (href) {
                    attachmentLinks.push(href);
                }
            }
            // 첨부파일 건수 (보기 링크 옆 숫자)
            const attachmentCountText = await row.$eval('td:has(a:has-text("보기"))', (el) => {
                const nextSibling = el.nextElementSibling;
                return nextSibling?.textContent || '0';
            }).catch(() => '0');
            const attachmentCount = parseInt(attachmentCountText.replace(/[^0-9]/g, '')) || 0;
            // e나라도움 테이블 구조에 맞게 인덱스 조정 필요
            // 실제 DOM 구조에 따라 수정 필요
            const record = {
                id: `row-${rowNumber}`,
                rowNumber,
                // 날짜 (인덱스는 실제 테이블에 맞게 조정 필요)
                executionDate: await getText(cells[1]), // 집행처리일자
                writeDate: await getText(cells[2]), // 작성일자
                // 분류
                settlementType: await getText(cells[3]), // 정산구분
                budgetCategory: await getText(cells[5]), // 집행비목
                subCategory: await getText(cells[6]), // 세목명
                // 거래 정보
                vendorName: await getText(cells[9]), // 거래처명
                supplyAmount: 0, // 공급가액 (오른쪽 스크롤)
                vat: 0, // 부가세
                cancelAmount: 0, // 집행취소
                totalAmount: 0, // 집행금액
                // 첨부파일
                attachmentCount,
                attachmentLinks,
                // 상태
                reviewStatus: '', // 검토진행상태
                reviewDate: '', // 검토일자
                // 기타
                remarks: '',
                existingOpinion: '',
            };
            return record;
        }
        catch (error) {
            logger_1.logger.debug(`행 파싱 오류: ${error}`);
            return null;
        }
    }
    /**
     * 엑셀 다운로드 버튼 클릭
     */
    async downloadExcel() {
        logger_1.logger.info('엑셀 다운로드 시도...');
        try {
            // 다운로드 이벤트 대기 설정
            const downloadPromise = this.page.waitForEvent('download', { timeout: 30000 });
            // 엑셀 버튼 클릭
            const excelButton = await this.page.$('button:has-text("엑셀"), a:has-text("엑셀"), input[value*="엑셀"]');
            if (!excelButton) {
                logger_1.logger.warn('엑셀 다운로드 버튼을 찾을 수 없습니다.');
                return null;
            }
            await excelButton.click();
            // 다운로드 완료 대기
            const download = await downloadPromise;
            const suggestedFilename = download.suggestedFilename();
            // 파일 저장
            const savePath = `./downloads/${suggestedFilename}`;
            await download.saveAs(savePath);
            logger_1.logger.success(`엑셀 다운로드 완료: ${suggestedFilename}`);
            return savePath;
        }
        catch (error) {
            logger_1.logger.error('엑셀 다운로드 실패', error);
            return null;
        }
    }
    /**
     * 페이지네이션 확인 및 처리
     */
    async hasNextPage() {
        try {
            const nextButton = await this.page.$('a:has-text("다음"), button:has-text("다음"), .pagination .next:not(.disabled)');
            return nextButton !== null;
        }
        catch {
            return false;
        }
    }
    async goToNextPage() {
        try {
            const nextButton = await this.page.$('a:has-text("다음"), button:has-text("다음"), .pagination .next:not(.disabled)');
            if (nextButton) {
                await nextButton.click();
                await this.page.waitForLoadState('networkidle', { timeout: 10000 });
                return true;
            }
            return false;
        }
        catch {
            return false;
        }
    }
    /**
     * 스크롤하여 추가 컬럼 데이터 가져오기
     */
    async scrollToRightColumns() {
        try {
            // 테이블 컨테이너 찾기
            const tableContainer = await this.page.$('.table-container, [style*="overflow"]');
            if (tableContainer) {
                // 오른쪽으로 스크롤
                await tableContainer.evaluate((el) => {
                    el.scrollLeft = el.scrollWidth;
                });
                await this.page.waitForTimeout(500); // 스크롤 후 잠시 대기
            }
        }
        catch (error) {
            logger_1.logger.debug('테이블 스크롤 실패', error);
        }
    }
}
exports.ExecutionScraper = ExecutionScraper;
//# sourceMappingURL=scraper.js.map