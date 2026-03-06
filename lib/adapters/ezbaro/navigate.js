/**
 * 통합이지바로 네비게이션 어댑터
 * - CDP 연결 (utils.connectBrowser 재사용)
 * - 집행내역 목록조회 탭 이동
 * - 세션 연장/팝업 정리
 */
const { sleep, connectBrowser } = require('../../utils');

let _keepAliveTimer = null;

async function connectEzbaroBrowser(opts = {}) {
  const host = opts.host || process.env.CDP_HOST || '100.87.3.123';
  const port = Number(opts.port || process.env.CDP_PORT || 9446);
  process.env.CDP_HOST = host;
  const { browser, context } = await connectBrowser(port);
  if (!context) throw new Error('CDP context를 찾지 못했습니다.');
  return { browser, context, host, port };
}

async function findEzbaroPage(context) {
  const pages = context.pages();
  for (const p of pages) {
    const u = p.url();
    if (!u) continue;
    if (/ezbaro|rcms|iris\.go\.kr|ernd|rnd/i.test(u)) return p;
  }
  for (const p of pages) {
    const u = p.url();
    if (u && !u.startsWith('chrome://') && u !== 'about:blank') return p;
  }
  return pages[0] || null;
}

async function dismissModalsEzbaro(page) {
  await page.evaluate(() => {
    const clickables = [...document.querySelectorAll('button, div, span, a')].filter(el => {
      const t = (el.innerText || '').trim();
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height) return false;
      if (el.childElementCount > 0) return false;
      return t === '확인' || t === '닫기' || t === '취소';
    });
    clickables.forEach(el => el.click());
  }).catch(() => {});
}

async function startKeepAliveEzbaro(page, intervalMs = 5 * 60 * 1000) {
  stopKeepAliveEzbaro();

  const extendOnce = async () => {
    await page.evaluate(() => {
      const candidates = [...document.querySelectorAll('img, button, div, span, a')].filter(el => {
        const r = el.getBoundingClientRect();
        if (!r.width || !r.height) return false;
        if (r.y > 120) return false;
        const txt = (el.innerText || '').trim();
        const cls = String(el.className || '');
        return /session|timer|refresh|remain|left/i.test(cls) ||
          /연장|유지|갱신/.test(txt) ||
          /^\d{2}:\d{2}$/.test(txt);
      });
      if (candidates.length > 0) {
        candidates[candidates.length - 1].click();
      }
    }).catch(() => {});
    await sleep(300);
    await dismissModalsEzbaro(page);
  };

  await extendOnce();
  _keepAliveTimer = setInterval(extendOnce, intervalMs);
  return _keepAliveTimer;
}

function stopKeepAliveEzbaro() {
  if (_keepAliveTimer) {
    clearInterval(_keepAliveTimer);
    _keepAliveTimer = null;
  }
}

async function clickTabByText(page, matcher) {
  return page.evaluate((needle) => {
    const tabs = [...document.querySelectorAll('.cl-tabfolder-item')].filter(el => {
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    });

    const tab = tabs.find(el => {
      const t = (el.innerText || '').trim();
      if (Array.isArray(needle)) return needle.every(k => t.includes(k));
      return t.includes(String(needle));
    });

    if (!tab) return false;
    tab.click();
    return true;
  }, matcher);
}

async function isOnExecutionList(page) {
  return page.evaluate(() => {
    const selected = document.querySelector('.cl-tabfolder-item.cl-selected');
    const t = (selected?.innerText || '').trim();
    if (t.includes('집행내역') && t.includes('목록')) return true;

    const rows = document.querySelectorAll('[class*="cl-grid-row"]');
    return rows.length > 0;
  }).catch(() => false);
}

async function ensureExecutionListTab(page) {
  if (await isOnExecutionList(page)) return true;

  const ok = await clickTabByText(page, ['집행내역', '목록']);
  if (!ok) return false;

  await sleep(1000);
  await dismissModalsEzbaro(page);

  for (let i = 0; i < 20; i++) {
    if (await isOnExecutionList(page)) return true;
    await sleep(300);
  }

  return false;
}

async function queryIfNeeded(page) {
  const hasRows = await page.evaluate(() => {
    const rows = document.querySelectorAll('[class*="cl-grid-row"]');
    return rows.length > 0;
  }).catch(() => false);
  if (hasRows) return true;

  const clicked = await page.evaluate(() => {
    const btn = [...document.querySelectorAll('button, div, span, a')].find(el => {
      const t = (el.innerText || '').trim();
      const r = el.getBoundingClientRect();
      return /조회|검색/.test(t) && r.width > 0 && r.height > 0;
    });
    if (!btn) return false;
    btn.click();
    return true;
  }).catch(() => false);

  if (!clicked) return false;

  await sleep(1500);
  await dismissModalsEzbaro(page);
  return true;
}

async function readListSummary(page) {
  return page.evaluate(() => {
    const textEl = [...document.querySelectorAll('.cl-text')].find(el => {
      const t = (el.innerText || '').trim();
      return /총\s*\d+\s*건/.test(t);
    });

    const total = textEl ? Number((textEl.innerText.match(/(\d+)/) || [0, 0])[1]) : null;
    const selectedTab = (document.querySelector('.cl-tabfolder-item.cl-selected')?.innerText || '').trim();

    return { total, selectedTab };
  }).catch(() => ({ total: null, selectedTab: '' }));
}

async function goToExecutionList(opts = {}) {
  const { browser, context, host, port } = await connectEzbaroBrowser(opts);
  const page = await findEzbaroPage(context);
  if (!page) throw new Error('이지바로 탭을 찾지 못했습니다.');

  page.on('dialog', async d => {
    try { await d.accept(); } catch {}
  });

  await dismissModalsEzbaro(page);
  const tabOk = await ensureExecutionListTab(page);
  if (!tabOk) throw new Error('집행내역 목록 탭 이동 실패');

  await queryIfNeeded(page);
  const summary = await readListSummary(page);

  return {
    browser,
    context,
    page,
    connection: { host, port },
    summary,
  };
}

module.exports = {
  connectEzbaroBrowser,
  findEzbaroPage,
  dismissModalsEzbaro,
  startKeepAliveEzbaro,
  stopKeepAliveEzbaro,
  clickTabByText,
  isOnExecutionList,
  ensureExecutionListTab,
  queryIfNeeded,
  readListSummary,
  goToExecutionList,
};

if (require.main === module) {
  const getArg = (name, dflt = null) => {
    const p = `--${name}=`;
    const found = process.argv.find(a => a.startsWith(p));
    return found ? found.slice(p.length) : dflt;
  };

  const host = getArg('host', process.env.CDP_HOST || '100.87.3.123');
  const port = Number(getArg('port', process.env.CDP_PORT || '9446'));

  goToExecutionList({ host, port })
    .then(({ summary, connection }) => {
      console.log('연결:', connection);
      console.log('선택 탭:', summary.selectedTab || '(unknown)');
      console.log('총 건수:', summary.total ?? '(unknown)');
    })
    .catch(e => {
      console.error('ERROR:', e.message);
      process.exit(1);
    });
}
