import { Page, ElementHandle } from 'playwright';
import fs from 'fs';
import path from 'path';
import AdmZip from 'adm-zip';
import { logger } from '../utils/logger';
import { Config, ExecutionRecord, Attachment } from '../types';

// CDP dialog 에러 무시 (e나라도움 popupMask 충돌)
process.on('unhandledRejection', (err: any) => {
  if (err?.message?.includes('No dialog is showing')) return;
});

/**
 * 첨부파일 다운로더 (e나라도움 전용)
 *
 * IBSheet 가상 스크롤 테이블에서 [보기] 셀을 순차 클릭하여
 * 팝업 → CDP 다운로드 → ZIP 해제 플로우를 처리한다.
 */
export class AttachmentDownloader {
  private page: Page;
  private config: Config;
  private downloadDir: string;

  constructor(page: Page, config: Config, sessionId: string) {
    this.page = page;
    this.config = config;
    this.downloadDir = path.join(config.downloadDir, sessionId);

    if (!fs.existsSync(this.downloadDir)) {
      fs.mkdirSync(this.downloadDir, { recursive: true });
    }
  }

  /**
   * 개별 집행건별 첨부파일 다운로드
   *
   * IBSheet 가상 스크롤 특성상, 한 번에 ~10행만 렌더링된다.
   * 스크롤하면서 아직 처리하지 않은 [보기] 셀을 순차적으로 클릭한다.
   * 행 fingerprint(전체 셀 텍스트)로 중복 처리를 방지한다.
   */
  async downloadIndividualAttachments(
    records: ExecutionRecord[]
  ): Promise<Map<string, Attachment[]>> {
    logger.info(`개별 첨부파일 다운로드 시작 (${records.length}건)...`);

    const attachmentMap = new Map<string, Attachment[]>();

    // 스크롤 컨테이너 찾기
    const scrollContainer = await this.findScrollContainer();

    // 스크롤을 맨 위로 리셋
    if (scrollContainer) {
      await scrollContainer.evaluate(el => { (el as HTMLElement).scrollTop = 0; });
      await this.page.waitForTimeout(500);
    }

    let recordIndex = 0;
    const processedRowKeys = new Set<string>();
    let consecutiveNoProgress = 0;

    while (recordIndex < records.length && consecutiveNoProgress < 15) {
      await this.dismissPopups();

      // 현재 보이는 [보기] 셀 목록 + 행 fingerprint
      const cellInfos = await this.getVisibleViewCellInfos();

      let hadProgress = false;

      for (const cellInfo of cellInfos) {
        if (processedRowKeys.has(cellInfo.rowKey)) continue;
        if (recordIndex >= records.length) break;

        processedRowKeys.add(cellInfo.rowKey);
        const record = records[recordIndex];

        logger.progress(recordIndex + 1, records.length, `${record.id} 처리 중`);

        try {
          // 셀을 다시 쿼리 (stale handle 방지)
          const freshCells = await this.page.$$('td.IBTextUnderline.HideCol0atchmnflTmp');
          const cell = freshCells[cellInfo.domIndex];
          if (!cell) {
            attachmentMap.set(record.id, []);
            recordIndex++;
            hadProgress = true;
            continue;
          }

          const attachments = await this.openPopupAndDownload(cell, record.id);
          attachmentMap.set(record.id, attachments);
        } catch (error) {
          logger.warn(`${record.id} 첨부파일 다운로드 실패`, error);
          attachmentMap.set(record.id, []);
        }

        recordIndex++;
        hadProgress = true;
      }

      // 스크롤 다운 (5행씩)
      if (scrollContainer) {
        await scrollContainer.evaluate((el: Element) => {
          const step = 30 * 5;
          (el as HTMLElement).scrollTop += step;
          el.dispatchEvent(new WheelEvent('wheel', {
            deltaY: step, deltaMode: 0, bubbles: true, cancelable: true,
          }));
          el.dispatchEvent(new Event('scroll', { bubbles: true }));
        });
        await this.page.waitForTimeout(400);
      }

      consecutiveNoProgress = hadProgress ? 0 : consecutiveNoProgress + 1;
    }

    // 미처리 레코드는 빈 배열
    for (const record of records) {
      if (!attachmentMap.has(record.id)) {
        attachmentMap.set(record.id, []);
      }
    }

    const totalFiles = Array.from(attachmentMap.values())
      .reduce((s, a) => s + a.length, 0);
    logger.success(`${recordIndex}건 처리, ${totalFiles}개 파일 다운로드`);

    return attachmentMap;
  }

  /**
   * IBSheet 그리드의 스크롤 컨테이너 찾기
   */
  private async findScrollContainer(): Promise<ElementHandle | null> {
    const containers = await this.page.$$('#DD001002QGridObj .IBSectionScroll');
    let best: ElementHandle | null = null;
    let maxH = 0;
    for (const c of containers) {
      const h = await c.evaluate(el => (el as HTMLElement).scrollHeight);
      if (h > maxH) { maxH = h; best = c; }
    }
    return best || await this.page.$('#DD001002QGridObj .IBBodyMid');
  }

  /**
   * 현재 보이는 [보기] 셀들의 DOM 인덱스와 행 fingerprint 반환
   */
  private async getVisibleViewCellInfos(): Promise<{ domIndex: number; rowKey: string }[]> {
    return this.page.evaluate(() => {
      const cells = Array.from(
        document.querySelectorAll('td.IBTextUnderline.HideCol0atchmnflTmp')
      );
      return cells.map((cell, idx) => {
        const tr = cell.closest('tr');
        if (!tr) return { domIndex: idx, rowKey: `orphan-${idx}-${Date.now()}` };

        const rowIdx = Array.from(tr.parentElement?.children || []).indexOf(tr);

        // 모든 IBBodyMid 패널에서 같은 행 인덱스의 셀 텍스트를 합쳐 fingerprint 생성
        const allBodies = document.querySelectorAll('#DD001002QGridObj .IBBodyMid');
        const rowTexts: string[] = [];
        allBodies.forEach(body => {
          const rows = body.querySelectorAll('tr');
          const matchRow = rows[rowIdx];
          if (matchRow) {
            Array.from(matchRow.querySelectorAll('td')).forEach(c => {
              rowTexts.push(c.textContent?.trim() || '');
            });
          }
        });

        return { domIndex: idx, rowKey: rowTexts.join('|') };
      });
    });
  }

  /**
   * [보기] 셀 클릭 → 팝업 대기 → 파일 다운로드
   */
  private async openPopupAndDownload(
    cell: ElementHandle,
    executionId: string
  ): Promise<Attachment[]> {
    const attachments: Attachment[] = [];

    try {
      await this.dismissPopups();

      const context = this.page.context();
      const popupPromise = context.waitForEvent('page', { timeout: 10000 });

      // 일반 클릭 (force 사용 X - IBSheet 이벤트 시스템 필수)
      await cell.click({ timeout: 5000 });

      const popup = await popupPromise.catch(() => null);
      if (!popup) {
        logger.debug(`${executionId} 팝업 안 열림`);
        await this.dismissPopups();
        return attachments;
      }

      // about:blank → 실제 URL 대기
      if (popup.url() === 'about:blank') {
        await popup.waitForURL(/gosims/, { timeout: 15000 }).catch(() => {});
      }
      await popup.waitForLoadState('domcontentloaded');
      await popup.waitForTimeout(1000);

      logger.debug(`${executionId} 팝업 열림`);

      const files = await this.downloadFilesFromPopup(popup, executionId);
      attachments.push(...files);

      await popup.close().catch(() => {});
    } catch (error) {
      logger.debug(`${executionId} 처리 오류`, error);
      await this.dismissPopups();
    }

    return attachments;
  }

  /**
   * 팝업에서 파일 다운로드 (CDP 다운로드 + f_downloadDB003002S 호출)
   */
  private async downloadFilesFromPopup(
    popup: Page,
    executionId: string
  ): Promise<Attachment[]> {
    const attachments: Attachment[] = [];
    const recordDir = path.join(this.downloadDir, executionId);
    fs.mkdirSync(recordDir, { recursive: true });

    // Windows 경로로 변환 (CDP 다운로드용)
    const winDownloadPath = recordDir
      .replace(/^\/mnt\/([a-z])\//, (_, drive) => `${drive.toUpperCase()}:\\`)
      .replace(/\//g, '\\');

    try {
      // CDP 다운로드 설정
      const cdpSession = await popup.context().newCDPSession(popup);
      await cdpSession.send('Page.setDownloadBehavior', {
        behavior: 'allow',
        downloadPath: winDownloadPath,
      });

      // CDP dialog 자동 수락
      cdpSession.on('Page.javascriptDialogOpening', async () => {
        try {
          await cdpSession.send('Page.handleJavaScriptDialog', { accept: true });
        } catch {}
      });
      await cdpSession.send('Page.enable');

      // 체크박스 전체 선택
      await popup.evaluate(() => {
        document.querySelectorAll('input[type="checkbox"]').forEach(cb => {
          (cb as HTMLInputElement).checked = true;
        });
      });

      const filesBefore = new Set(
        fs.existsSync(recordDir) ? fs.readdirSync(recordDir) : []
      );

      // 다운로드 함수 존재 확인
      const hasFn = await popup.evaluate(
        () => typeof (window as any).f_downloadDB003002S === 'function'
      ).catch(() => false);

      if (!hasFn) {
        logger.debug(`${executionId} 다운로드 함수 없음 (첨부파일 없는 건일 수 있음)`);
        await cdpSession.detach().catch(() => {});
        return attachments;
      }

      // f_downloadDB003002S 호출 + popupMask 자동 확인
      await popup.evaluate(() => {
        const observer = new MutationObserver(() => {
          const mask = document.querySelector('.popupMask.on') as HTMLElement;
          if (mask) {
            const btn = mask.querySelector('footer button') as HTMLElement;
            if (btn) setTimeout(() => btn.click(), 200);
          }
        });
        observer.observe(document.body, {
          subtree: true,
          attributes: true,
          attributeFilter: ['class'],
        });
        (window as any).f_downloadDB003002S();
      });

      // 다운로드 대기 (최대 20초)
      for (let i = 0; i < 20; i++) {
        await new Promise(r => setTimeout(r, 1000));
        try {
          const currentFiles = fs.readdirSync(recordDir);
          const newFiles = currentFiles.filter(
            f => !filesBefore.has(f) && !f.endsWith('.crdownload')
          );

          if (newFiles.length > 0) {
            logger.debug(`${executionId} 다운로드 완료: ${newFiles.join(', ')}`);

            for (const filename of newFiles) {
              const filePath = path.join(recordDir, filename);

              if (filename.toLowerCase().endsWith('.zip')) {
                const extracted = await this.extractZipAndGetAttachments(
                  filePath, recordDir, executionId
                );
                attachments.push(...extracted);
              } else {
                const stats = fs.statSync(filePath);
                attachments.push({
                  id: `${executionId}-${Date.now()}`,
                  executionId,
                  originalName: filename,
                  localPath: filePath,
                  fileType: this.getFileType(filename),
                  fileSize: stats.size,
                  extractedText: '',
                  ocrResult: '',
                  analysisResult: null,
                });
              }
            }
            break;
          }
        } catch {}
      }

      await cdpSession.detach().catch(() => {});
    } catch (error) {
      logger.debug('팝업 다운로드 처리 오류', error);
    }

    return attachments;
  }

  /**
   * ZIP 압축 해제 후 Attachment 배열 반환
   */
  private async extractZipAndGetAttachments(
    zipPath: string,
    extractDir: string,
    executionId: string
  ): Promise<Attachment[]> {
    const attachments: Attachment[] = [];

    try {
      const zip = new AdmZip(zipPath);
      zip.extractAllTo(extractDir, true);
      const entries = zip.getEntries();

      logger.debug(`${executionId} ZIP 해제: ${entries.length}개 파일`);

      for (const entry of entries) {
        if (entry.isDirectory) continue;
        const filePath = path.join(extractDir, entry.entryName);
        const stats = fs.statSync(filePath);

        attachments.push({
          id: `${executionId}-${Date.now()}-${entry.entryName}`,
          executionId,
          originalName: entry.entryName,
          localPath: filePath,
          fileType: this.getFileType(entry.entryName),
          fileSize: stats.size,
          extractedText: '',
          ocrResult: '',
          analysisResult: null,
        });
      }

      fs.unlinkSync(zipPath);
    } catch (error) {
      logger.debug('ZIP 해제 실패', error);
    }

    return attachments;
  }

  /**
   * 파일 타입 판별
   */
  private getFileType(filename: string): Attachment['fileType'] {
    const ext = path.extname(filename).toLowerCase();

    switch (ext) {
      case '.pdf':
        return 'pdf';
      case '.jpg':
      case '.jpeg':
      case '.png':
      case '.gif':
      case '.bmp':
      case '.tiff':
        return 'image';
      case '.hwp':
      case '.hwpx':
        return 'hwp';
      case '.xls':
      case '.xlsx':
      case '.csv':
        return 'excel';
      default:
        return 'other';
    }
  }

  getDownloadDir(): string {
    return this.downloadDir;
  }

  /**
   * popupMask 강제 제거
   */
  private async dismissPopups(): Promise<void> {
    try {
      await this.page.evaluate(() => {
        document.querySelectorAll('.popupMask.on').forEach(el => {
          const mask = el as HTMLElement;
          const btn = mask.querySelector('footer button, button') as HTMLElement;
          if (btn) btn.click();
          mask.classList.remove('on');
          mask.style.display = 'none';
        });
      });
    } catch {}
  }
}
