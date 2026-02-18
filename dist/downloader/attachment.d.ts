import { Page } from 'playwright';
import { Config, ExecutionRecord, Attachment } from '../types';
/**
 * 첨부파일 다운로더 (e나라도움 전용)
 *
 * IBSheet 가상 스크롤 테이블에서 [보기] 셀을 순차 클릭하여
 * 팝업 → CDP 다운로드 → ZIP 해제 플로우를 처리한다.
 */
export declare class AttachmentDownloader {
    private page;
    private config;
    private downloadDir;
    constructor(page: Page, config: Config, sessionId: string);
    /**
     * 개별 집행건별 첨부파일 다운로드
     *
     * IBSheet 가상 스크롤 특성상, 한 번에 ~10행만 렌더링된다.
     * 스크롤하면서 아직 처리하지 않은 [보기] 셀을 순차적으로 클릭한다.
     * 행 fingerprint(전체 셀 텍스트)로 중복 처리를 방지한다.
     */
    downloadIndividualAttachments(records: ExecutionRecord[]): Promise<Map<string, Attachment[]>>;
    /**
     * IBSheet 그리드의 스크롤 컨테이너 찾기
     */
    private findScrollContainer;
    /**
     * 현재 보이는 [보기] 셀들의 DOM 인덱스와 행 fingerprint 반환
     */
    private getVisibleViewCellInfos;
    /**
     * [보기] 셀 클릭 → 팝업 대기 → 파일 다운로드
     */
    private openPopupAndDownload;
    /**
     * 팝업에서 파일 다운로드 (CDP 다운로드 + f_downloadDB003002S 호출)
     */
    private downloadFilesFromPopup;
    /**
     * ZIP 압축 해제 후 Attachment 배열 반환
     */
    private extractZipAndGetAttachments;
    /**
     * 파일 타입 판별
     */
    private getFileType;
    getDownloadDir(): string;
    /**
     * popupMask 강제 제거
     */
    private dismissPopups;
}
//# sourceMappingURL=attachment.d.ts.map