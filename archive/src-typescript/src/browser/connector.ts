import { chromium, Browser, BrowserContext, Page } from 'playwright';
import fs from 'fs';
import { logger } from '../utils/logger';
import { Config } from '../types';

export class BrowserConnector {
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;
  private page: Page | null = null;
  private config: Config;

  constructor(config: Config) {
    this.config = config;
  }

  /**
   * WSL 환경에서 Windows 호스트 IP 가져오기
   */
  private getWindowsHostIp(): string | null {
    try {
      const resolv = fs.readFileSync('/etc/resolv.conf', 'utf-8');
      const match = resolv.match(/nameserver\s+(\d+\.\d+\.\d+\.\d+)/);
      return match ? match[1] : null;
    } catch {
      return null;
    }
  }

  /**
   * CDP를 통해 기존 Chrome 세션에 연결
   * 사용자가 Chrome을 --remote-debugging-port=9222로 실행해야 함
   */
  async connect(): Promise<Page> {
    logger.info('Chrome 브라우저에 연결 시도 중...');

    // 시도할 CDP URL 목록 (localhost 먼저, 그다음 Windows 호스트 IP)
    const cdpUrls: string[] = [this.config.cdpUrl];
    const windowsHostIp = this.getWindowsHostIp();
    if (windowsHostIp) {
      const port = new URL(this.config.cdpUrl).port || '9444';
      cdpUrls.push(`http://${windowsHostIp}:${port}`);
    }

    let lastError: Error | null = null;

    for (const cdpUrl of cdpUrls) {
      logger.debug(`CDP URL 시도: ${cdpUrl}`);
      try {
        // CDP로 연결
        this.browser = await chromium.connectOverCDP(cdpUrl, { timeout: 5000 });
        logger.success(`Chrome에 연결됨 (${cdpUrl})`);

        // 기존 컨텍스트 가져오기
        const contexts = this.browser.contexts();
        if (contexts.length === 0) {
          throw new Error('열린 브라우저 컨텍스트가 없습니다.');
        }
        this.context = contexts[0];
        logger.debug(`컨텍스트 수: ${contexts.length}`);

        // 페이지 목록 확인
        const pages = this.context.pages();
        if (pages.length === 0) {
          throw new Error('열린 탭이 없습니다.');
        }

        logger.info(`열린 탭 수: ${pages.length}`);

        // e나라도움 페이지 찾기
        this.page = await this.findENaraPage(pages);

        if (!this.page) {
          // e나라도움 페이지를 못 찾으면 첫 번째 페이지 사용
          logger.warn('e나라도움 페이지를 찾지 못했습니다. 현재 활성 탭을 사용합니다.');
          this.page = pages[0];
        }

        const currentUrl = this.page.url();
        const title = await this.page.title();
        logger.info(`현재 페이지: ${title}`);
        logger.debug(`URL: ${currentUrl}`);

        return this.page;

      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        logger.debug(`${cdpUrl} 연결 실패: ${lastError.message}`);
        continue;
      }
    }

    // 모든 URL에서 실패
    logger.error('Chrome에 연결할 수 없습니다.');
    logger.info('');
    logger.info('Chrome을 디버그 모드로 실행해주세요:');
    logger.info('');
    logger.info('  Windows CMD 또는 PowerShell:');
    logger.info('  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe" --remote-debugging-port=9444 --remote-allow-origins=* --user-data-dir=C:\\temp\\chrome-debug');
    logger.info('');
    logger.info('  주의: 기본 프로필 사용 시 디버그 포트가 안 열릴 수 있으므로 --user-data-dir 필수');
    logger.info('');
    throw lastError || new Error('Chrome 연결 실패');
  }

  /**
   * e나라도움 페이지 찾기
   */
  private async findENaraPage(pages: Page[]): Promise<Page | null> {
    for (const page of pages) {
      const url = page.url();
      // e나라도움 URL 패턴
      if (url.includes('gosims.go.kr') || url.includes('e-naradomum') || url.includes('naradomum')) {
        logger.success('e나라도움 페이지 발견');
        return page;
      }
    }
    return null;
  }

  /**
   * 현재 페이지가 집행내역조회 화면인지 확인
   */
  async isExecutionListPage(): Promise<boolean> {
    if (!this.page) return false;

    try {
      // 여러 가지 방법으로 확인
      const url = this.page.url();

      // URL에 특정 패턴이 있는지
      if (url.includes('EXEBOSCRN') || url.includes('집행') || url.includes('execution')) {
        return true;
      }

      // 페이지 제목 확인
      const title = await this.page.title();
      if (title.includes('집행내역') || title.includes('사업별집행')) {
        return true;
      }

      // 특정 요소가 있는지 확인
      const hasExecutionTable = await this.page.$('text=집행내역') !== null;
      const hasSearchButton = await this.page.$('text=검색') !== null;

      return hasExecutionTable && hasSearchButton;

    } catch (error) {
      logger.warn('페이지 확인 중 오류', error);
      return false;
    }
  }

  /**
   * 사업 정보 추출
   */
  async getProjectInfo(): Promise<{ code: string; name: string } | null> {
    if (!this.page) return null;

    try {
      // 사업선택 필드에서 정보 추출 시도
      // 실제 DOM 구조에 따라 셀렉터 조정 필요
      const projectText = await this.page.$eval(
        'input[name*="project"], select[name*="project"], [class*="project"]',
        (el) => (el as HTMLInputElement).value || el.textContent || ''
      ).catch(() => '');

      if (projectText) {
        // "B00B01240003815 2025년 공공보건의료..." 형태 파싱
        const match = projectText.match(/([A-Z0-9]+)\s+(.+)/);
        if (match) {
          return {
            code: match[1],
            name: match[2].trim(),
          };
        }
      }

      return null;

    } catch (error) {
      logger.warn('사업 정보 추출 실패', error);
      return null;
    }
  }

  /**
   * 연결 종료
   */
  async disconnect() {
    if (this.browser) {
      // CDP 연결만 끊고, 브라우저는 닫지 않음
      await this.browser.close();
      logger.info('브라우저 연결 해제됨');
    }
  }

  /**
   * 현재 페이지 반환
   */
  getPage(): Page | null {
    return this.page;
  }
}
