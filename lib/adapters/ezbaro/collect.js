/**
 * 통합이지바로 집행내역 추출 어댑터
 * - cpr/cl-grid 구조 탐색
 * - 페이지네이션 순회로 전체 건 수집
 * - 첨부파일 다운로드 파라미터 캡처/직접 fetch
 * - 검토진행상태/의견 입력 영역 셀렉터 추출
 */
const fs = require('fs');
const path = require('path');
const nav = require('./navigate');
const { sleep } = require('../../utils');

function toWindowsPath(localPath) {
  if (!localPath) return '';
  if (/^[A-Za-z]:\\/.test(localPath)) return localPath;
  const mnt = localPath.match(/^\/mnt\/([a-z])\/(.*)$/i);
  if (mnt) return `${mnt[1].toUpperCase()}:\\${mnt[2].replace(/\//g, '\\')}`;
  return localPath.replace(/\//g, '\\');
}

function parseAmount(v) {
  if (typeof v === 'number') return v;
  if (!v) return 0;
  return parseInt(String(v).replace(/[^0-9-]/g, ''), 10) || 0;
}

async function detectGridLibrary(page) {
  return page.evaluate(() => {
    const out = {
      hasCpr: !!window.cpr,
      hasGridClass: !!(window.cpr && window.cpr.controls && window.cpr.controls.Grid),
      hasIBSheet: !!window.IBSheet,
      hasAgGrid: !!window.agGrid,
      clGridCount: document.querySelectorAll('.cl-grid').length,
      rowDomCount: document.querySelectorAll('[class*="cl-grid-row"]').length,
    };

    if (out.hasCpr && out.hasGridClass) out.library = 'cpr.controls.Grid (cl-grid)';
    else if (out.hasIBSheet) out.library = 'IBSheet';
    else if (out.hasAgGrid) out.library = 'ag-Grid';
    else out.library = 'unknown';

    return out;
  });
}

async function analyzeEzbaroDom(page) {
  return page.evaluate(() => {
    const isVisible = el => {
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    };
    const gridGlobals = Object.keys(window).filter(k => {
      if (!/grid/i.test(k)) return false;
      const v = window[k];
      return v && typeof v === 'object' && (
        typeof v.getDataRows === 'function' ||
        typeof v.getRowValue === 'function' ||
        typeof v.focus === 'function'
      );
    });

    const reviewLabel = [...document.querySelectorAll('.cl-text')].find(el => {
      const t = (el.innerText || '').trim();
      return isVisible(el) && t === '검토진행상태';
    });
    const opinionLabel = [...document.querySelectorAll('.cl-text')].find(el => {
      const t = (el.innerText || '').trim();
      return isVisible(el) && t.includes('검토의견');
    });
    const completeBtn = [...document.querySelectorAll('button, div, span, a')]
      .find(el => isVisible(el) && (el.innerText || '').trim() === '점검완료');
    const requestBtn = [...document.querySelectorAll('button, div, span, a')]
      .find(el => isVisible(el) && (el.innerText || '').trim() === '보완요청');
    const saveBtn = [...document.querySelectorAll('button, div, span, a')]
      .find(el => isVisible(el) && (el.innerText || '').trim() === '저장');

    const pageIndexer = document.querySelector('.cl-pageindexer');
    const pageCount = pageIndexer
      ? pageIndexer.querySelectorAll('.cl-pageindexer-index').length
      : 0;

    return {
      url: location.href,
      gridLibrary: window.cpr?.controls?.Grid ? 'cpr.controls.Grid (cl-grid)' :
        (window.IBSheet ? 'IBSheet' : (window.agGrid ? 'ag-Grid' : 'unknown')),
      gridGlobals,
      listGridSelector: '.cl-grid',
      listRowSelector: '[class*="cl-grid-row"]',
      attachmentLinkSelector: '.cl-text[style*="cursor"]',
      reviewStatusLabelSelector: reviewLabel?.id ? `#${reviewLabel.id}` : '.cl-text:has-text("검토진행상태")',
      opinionLabelSelector: opinionLabel?.id ? `#${opinionLabel.id}` : '.cl-text:has-text("검토의견")',
      completeButtonSelector: completeBtn?.id ? `#${completeBtn.id}` : null,
      requestButtonSelector: requestBtn?.id ? `#${requestBtn.id}` : null,
      saveButtonSelector: saveBtn?.id ? `#${saveBtn.id}` : null,
      pagination: {
        widget: pageIndexer ? 'cl-pageindexer' : 'unknown',
        visiblePageIndexCount: pageCount,
      },
    };
  });
}

async function readVisibleRows(page) {
  return page.evaluate(() => {
    const gridRows = [...document.querySelectorAll('[class*="cl-grid-row"]')].filter(el => {
      const r = el.getBoundingClientRect();
      return r.width > 300 && r.height > 10 && r.y > 80;
    });

    const headers = [...document.querySelectorAll('[class*="cl-grid-header"] .cl-text, [class*="cl-grid-column"] .cl-text')]
      .map(el => (el.innerText || '').trim())
      .filter(Boolean);

    const rows = [];
    for (const row of gridRows) {
      const cells = [...row.querySelectorAll('.cl-text')]
        .map(el => (el.innerText || '').trim())
        .filter(Boolean);
      if (!cells.length) continue;

      const seqText = cells.find(t => /^\d+$/.test(t) && Number(t) > 0 && Number(t) < 100000);
      const status = cells.find(t => ['미검토', '작성중', '검토완료', '보완요청', '점검완료'].includes(t)) || '';

      rows.push({
        seq: seqText ? Number(seqText) : null,
        status,
        cells,
      });
    }

    return {
      headers,
      rows,
      selectedTab: (document.querySelector('.cl-tabfolder-item.cl-selected')?.innerText || '').trim(),
    };
  });
}

async function goFirstPage(page) {
  const clicked = await page.evaluate(() => {
    const btn = document.querySelector('.cl-pageindexer-first:not(.cl-disabled)');
    if (!btn || btn.getBoundingClientRect().width === 0) return false;
    btn.click();
    return true;
  }).catch(() => false);

  if (clicked) {
    await sleep(700);
    await nav.dismissModalsEzbaro(page);
  }

  return clicked;
}

async function clickPageIndex(page, idx) {
  const clicked = await page.evaluate((i) => {
    const area = [...document.querySelectorAll('.cl-pageindexer-index-area')]
      .find(el => el.getBoundingClientRect().width > 0);
    if (!area) return false;

    const pages = [...area.querySelectorAll('.cl-pageindexer-index')]
      .filter(el => el.getBoundingClientRect().width > 0);

    if (i < 0 || i >= pages.length) return false;
    pages[i].click();
    return true;
  }, idx).catch(() => false);

  if (clicked) {
    await sleep(700);
    await nav.dismissModalsEzbaro(page);
  }

  return clicked;
}

async function clickNextPageGroup(page) {
  const clicked = await page.evaluate(() => {
    const btn = document.querySelector('.cl-pageindexer-next:not(.cl-disabled)');
    if (!btn || btn.getBoundingClientRect().width === 0) return false;
    btn.click();
    return true;
  }).catch(() => false);

  if (clicked) {
    await sleep(700);
    await nav.dismissModalsEzbaro(page);
  }

  return clicked;
}

async function extractAllRows(page, opts = {}) {
  const maxGroups = Number(opts.maxGroups || 999);
  const maxPages = Number(opts.maxPages || 9999);

  await nav.ensureExecutionListTab(page);
  await nav.queryIfNeeded(page);
  await goFirstPage(page);

  const bySeq = new Map();
  const pages = [];

  let pageCounter = 0;

  for (let group = 0; group < maxGroups; group++) {
    const pageCount = await page.evaluate(() => {
      const area = [...document.querySelectorAll('.cl-pageindexer-index-area')]
        .find(el => el.getBoundingClientRect().width > 0);
      return area ? area.querySelectorAll('.cl-pageindexer-index').length : 0;
    }).catch(() => 0);

    if (!pageCount) break;

    for (let i = 0; i < pageCount; i++) {
      if (pageCounter >= maxPages) break;

      if (!(group === 0 && i === 0)) {
        const clicked = await clickPageIndex(page, i);
        if (!clicked) continue;
      }

      const data = await readVisibleRows(page);
      const seqs = [];
      for (const r of data.rows) {
        if (r.seq !== null) {
          seqs.push(r.seq);
          if (!bySeq.has(r.seq)) bySeq.set(r.seq, r);
        }
      }

      pages.push({
        pageNo: pageCounter + 1,
        rowCount: data.rows.length,
        seqs,
      });

      pageCounter += 1;
    }

    if (pageCounter >= maxPages) break;

    const hasNextGroup = await clickNextPageGroup(page);
    if (!hasNextGroup) break;
  }

  const rows = [...bySeq.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([, v]) => v);

  return { rows, pages, uniqueRowCount: rows.length };
}

async function getAttachmentLink(page, label = '기본서류') {
  return page.evaluate((labelText) => {
    const lbl = [...document.querySelectorAll('.cl-text')].find(el => {
      const t = (el.innerText || '').trim();
      const r = el.getBoundingClientRect();
      return t === labelText && r.width > 0 && r.y > 60;
    });

    if (!lbl) return null;

    const lr = lbl.getBoundingClientRect();
    const link = [...document.querySelectorAll('.cl-text')].find(el => {
      if (el === lbl) return false;
      const t = (el.innerText || '').trim();
      const r = el.getBoundingClientRect();
      const style = window.getComputedStyle(el);
      if (!t || r.width <= 0) return false;
      return r.x > lr.x + lr.width - 10 && Math.abs(r.y - lr.y) < 20 && style.cursor === 'pointer';
    });

    if (!link) return null;
    const r = link.getBoundingClientRect();
    return {
      label: labelText,
      name: (link.innerText || '').trim(),
      x: Math.round(r.x + r.width / 2),
      y: Math.round(r.y + r.height / 2),
    };
  }, label);
}

async function openAttachmentDialog(page, label = '기본서류') {
  const link = await getAttachmentLink(page, label);
  if (!link) return { ok: false, reason: `${label} 링크 없음` };

  await page.mouse.click(link.x, link.y);
  await sleep(800);

  const opened = await page.evaluate(() => {
    return [...document.querySelectorAll('.cl-dialog')].some(el => el.getBoundingClientRect().width > 100);
  }).catch(() => false);

  if (!opened) return { ok: false, reason: '첨부파일 다이얼로그 미표시', link };
  return { ok: true, link };
}

async function closeAttachmentDialog(page) {
  await page.evaluate(() => {
    const dlg = [...document.querySelectorAll('.cl-dialog')].find(el => el.getBoundingClientRect().width > 100);
    if (!dlg) return;

    const btn = [...dlg.querySelectorAll('*')].find(el => {
      const t = (el.innerText || '').trim();
      return (t === '닫기' || t === '취소') && el.getBoundingClientRect().width > 0 && el.childElementCount === 0;
    });
    if (btn) btn.click();
  }).catch(() => {});
  await sleep(300);
}

async function captureDownloadParams(page) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Network.enable');

  let found = null;
  const listener = params => {
    const req = params.request || {};
    if (!String(req.url || '').includes('/cm/fileDownload.do')) return;
    if (!req.postData) return;

    try {
      found = JSON.parse(req.postData);
    } catch {
      found = req.postData;
    }
  };

  cdp.on('Network.requestWillBeSent', listener);

  try {
    const pos = await page.evaluate(() => {
      const dlg = [...document.querySelectorAll('.cl-dialog')].find(el => el.getBoundingClientRect().width > 100);
      if (!dlg) return null;

      const btn = [...dlg.querySelectorAll('*')].find(el => {
        const t = (el.innerText || '').trim();
        return t === '다운로드' && el.getBoundingClientRect().width > 0 && el.childElementCount === 0;
      });

      if (!btn) return null;
      const r = btn.getBoundingClientRect();
      return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) };
    });

    if (!pos) return null;
    await page.mouse.click(pos.x, pos.y);
    await sleep(1000);
    return found;
  } finally {
    await cdp.detach().catch(() => {});
  }
}

async function fetchFileByParams(page, params) {
  if (!params) return { ok: false, reason: 'params 없음' };

  const result = await page.evaluate(async (payload) => {
    try {
      const response = await fetch('/cm/fileDownload.do', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json; charset=UTF-8',
          'X-Requested-With': 'XMLHttpRequest',
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        return { ok: false, reason: `HTTP ${response.status}` };
      }

      const blob = await response.blob();
      const base64 = await new Promise((resolve, reject) => {
        const fr = new FileReader();
        fr.onload = () => resolve(String(fr.result).split(',')[1]);
        fr.onerror = reject;
        fr.readAsDataURL(blob);
      });

      return { ok: true, size: blob.size, base64 };
    } catch (e) {
      return { ok: false, reason: e.message };
    }
  }, params);

  if (!result.ok) return result;

  return {
    ok: true,
    size: result.size,
    buffer: Buffer.from(result.base64, 'base64'),
  };
}

async function detectReviewControls(page) {
  return page.evaluate(() => {
    const out = {
      statusLabel: null,
      statusComboSelector: null,
      opinionTextareaSelector: null,
      requestButtonSelector: null,
      requestOptionSelector: '.cl-combobox-list.cl-popup .cl-text',
    };

    const layout = [...document.querySelectorAll('.cl-layout')].find(el => {
      const t = (el.innerText || '');
      return t.includes('검토진행상태') && t.includes('검증검토의견');
    });

    if (!layout) return out;

    const statusLabel = [...layout.querySelectorAll('.cl-text')]
      .find(el => (el.innerText || '').trim() === '검토진행상태');

    if (statusLabel) {
      out.statusLabel = {
        text: '검토진행상태',
        x: Math.round(statusLabel.getBoundingClientRect().x),
        y: Math.round(statusLabel.getBoundingClientRect().y),
      };
    }

    const combo = layout.querySelector('.cl-combobox:not(.cl-disabled)');
    if (combo) {
      if (combo.id) out.statusComboSelector = `#${combo.id}`;
      else out.statusComboSelector = '.cl-combobox:not(.cl-disabled)';
    }

    const ta = layout.querySelector('textarea.cl-text:not([disabled])') ||
      [...document.querySelectorAll('textarea.cl-text:not([disabled])')].find(el => el.getBoundingClientRect().width > 100);

    if (ta) {
      if (ta.id) out.opinionTextareaSelector = `#${ta.id}`;
      else out.opinionTextareaSelector = 'textarea.cl-text:not([disabled])';
    }

    const requestBtn = [...document.querySelectorAll('button, div, span, a')].find(el => {
      const t = (el.innerText || '').trim();
      const r = el.getBoundingClientRect();
      return t === '보완요청' && r.width > 0 && r.height > 0 && el.childElementCount === 0;
    });

    if (requestBtn) {
      if (requestBtn.id) out.requestButtonSelector = `#${requestBtn.id}`;
      else out.requestButtonSelector = null;
    }

    return out;
  });
}

async function downloadCurrentDialogFiles(page, windowsDownloadPath) {
  const cdp = await page.context().newCDPSession(page);
  try {
    await cdp.send('Page.setDownloadBehavior', {
      behavior: 'allow',
      downloadPath: windowsDownloadPath,
    });
    const clicked = await page.evaluate(() => {
      const dlg = [...document.querySelectorAll('.cl-dialog')].find(el => el.getBoundingClientRect().width > 100);
      if (!dlg) return false;
      const downloadBtn = [...dlg.querySelectorAll('*')].find(el => {
        const t = (el.innerText || '').trim();
        const r = el.getBoundingClientRect();
        return t === '다운로드' && r.width > 0 && r.height > 0 && el.childElementCount === 0;
      });
      if (!downloadBtn) return false;
      downloadBtn.click();
      return true;
    });
    if (!clicked) return { ok: false, reason: '다운로드 버튼 없음' };
    await sleep(1500);
    return { ok: true };
  } finally {
    await cdp.detach().catch(() => {});
  }
}

async function extractEzbaro(opts = {}) {
  const output = opts.output || null;
  const { browser, page, summary, connection } = await nav.goToExecutionList(opts);

  try {
    const grid = await detectGridLibrary(page);
    const dom = await analyzeEzbaroDom(page).catch(() => null);
    const rows = await extractAllRows(page, opts);

    const result = {
      extractedAt: new Date().toISOString(),
      connection,
      summary,
      grid,
      dom,
      totalRows: rows.uniqueRowCount,
      pages: rows.pages,
      rows: rows.rows,
    };

    if (opts.downloadPath) {
      const winPath = toWindowsPath(opts.downloadPath);
      result.download = { windowsPath: winPath };
      const opened = await openAttachmentDialog(page, opts.fileLabel || '기본서류');
      if (opened.ok) {
        const dl = await downloadCurrentDialogFiles(page, winPath);
        result.download.result = dl;
        await closeAttachmentDialog(page);
      } else {
        result.download.result = opened;
      }
    }

    if (output) {
      fs.mkdirSync(path.dirname(output), { recursive: true });
      fs.writeFileSync(output, JSON.stringify(result, null, 2), 'utf-8');
    }

    return result;
  } finally {
    if (opts.keepOpen !== true) {
      await browser.close().catch(() => {});
    }
  }
}

module.exports = {
  parseAmount,
  detectGridLibrary,
  analyzeEzbaroDom,
  readVisibleRows,
  goFirstPage,
  clickPageIndex,
  clickNextPageGroup,
  extractAllRows,
  getAttachmentLink,
  openAttachmentDialog,
  closeAttachmentDialog,
  downloadCurrentDialogFiles,
  captureDownloadParams,
  fetchFileByParams,
  detectReviewControls,
  toWindowsPath,
  extractEzbaro,
};

if (require.main === module) {
  const getArg = (name, dflt = null) => {
    const p = `--${name}=`;
    const found = process.argv.find(a => a.startsWith(p));
    return found ? found.slice(p.length) : dflt;
  };

  const host = getArg('host', process.env.CDP_HOST || '100.87.3.123');
  const port = Number(getArg('port', process.env.CDP_PORT || '9446'));
  const output = getArg('output', path.join(process.cwd(), 'ezbaro-data.json'));
  const downloadPath = getArg('download-path', null);
  const fileLabel = getArg('file-label', '기본서류');

  extractEzbaro({ host, port, output, downloadPath, fileLabel })
    .then(r => {
      console.log('라이브러리:', r.grid.library);
      console.log('총 건수:', r.totalRows);
      console.log('저장:', output);
    })
    .catch(e => {
      console.error('ERROR:', e.message);
      process.exit(1);
    });
}
