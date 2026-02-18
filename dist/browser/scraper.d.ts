import { Page } from 'playwright';
import { ExecutionRecord } from '../types';
/**
 * e나라도움 집행내역 스크래퍼
 */
export declare class ExecutionScraper {
    private page;
    constructor(page: Page);
    /**
     * 집행내역 목록 전체 가져오기 (스크롤하면서 모든 행 수집)
     */
    getExecutionList(): Promise<ExecutionRecord[]>;
    /**
     * 총 건수 가져오기
     */
    private getTotalCount;
    /**
     * 현재 보이는 행들 수집
     */
    private collectVisibleRows;
    /**
     * 셀 데이터로 ExecutionRecord 생성
     */
    private parseRowData;
    /**
     * 금액 파싱 (숫자 형식 찾기)
     */
    private parseAmount;
    /**
     * 기본 방식으로 집행내역 수집 (폴백)
     */
    private getExecutionListBasic;
    /**
     * 테이블 행 파싱
     */
    private parseTableRow;
    /**
     * 엑셀 다운로드 버튼 클릭
     */
    downloadExcel(): Promise<string | null>;
    /**
     * 페이지네이션 확인 및 처리
     */
    hasNextPage(): Promise<boolean>;
    goToNextPage(): Promise<boolean>;
    /**
     * 스크롤하여 추가 컬럼 데이터 가져오기
     */
    scrollToRightColumns(): Promise<void>;
}
//# sourceMappingURL=scraper.d.ts.map