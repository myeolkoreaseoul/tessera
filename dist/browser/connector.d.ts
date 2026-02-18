import { Page } from 'playwright';
import { Config } from '../types';
export declare class BrowserConnector {
    private browser;
    private context;
    private page;
    private config;
    constructor(config: Config);
    /**
     * WSL 환경에서 Windows 호스트 IP 가져오기
     */
    private getWindowsHostIp;
    /**
     * CDP를 통해 기존 Chrome 세션에 연결
     * 사용자가 Chrome을 --remote-debugging-port=9222로 실행해야 함
     */
    connect(): Promise<Page>;
    /**
     * e나라도움 페이지 찾기
     */
    private findENaraPage;
    /**
     * 현재 페이지가 집행내역조회 화면인지 확인
     */
    isExecutionListPage(): Promise<boolean>;
    /**
     * 사업 정보 추출
     */
    getProjectInfo(): Promise<{
        code: string;
        name: string;
    } | null>;
    /**
     * 연결 종료
     */
    disconnect(): Promise<void>;
    /**
     * 현재 페이지 반환
     */
    getPage(): Page | null;
}
//# sourceMappingURL=connector.d.ts.map