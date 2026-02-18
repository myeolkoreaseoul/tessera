/**
 * 보탬e 집행내역 추출 - 단순 Y버킷 방식
 * WebSocket 기반 cl-* 프레임워크 대응
 *
 * 사용법:
 *   node extract-botem.js              # 전체 수집
 *   node extract-botem.js --debug      # 현재 페이지 구조만 출력
 */
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const OUTPUT = path.join(__dirname, 'projects/캠퍼스타운-고려대/data.json');
const DEBUG = process.argv.includes('--debug');

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// 현재 보이는 페이지의 그리드 행들을 Y버킷으로 추출
async function extractRows(page) {
  return page.evaluate(() => {
    // 1) 모든 leaf div 수집 (visible)
    const leafs = [...document.querySelectorAll('div')].filter(d => {
      if (d.childElementCount > 0) return false;
      const t = d.innerText && d.innerText.trim();
      if (!t) return false;
      const r = d.getBoundingClientRect();
      return r.width > 0 && r.height > 0 && r.x >= 0;
    });

    // 2) 날짜 셀(YYYY-MM-DD)로 그리드 Y 범위 결정
    const dateCells = leafs.filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d.innerText.trim()));
    if (dateCells.length === 0) return { error: '날짜 셀 없음', rows: [] };

    // 날짜들의 X 위치 확인 → 그리드 날짜 컬럼 X
    const xGroups = {};
    dateCells.forEach(d => {
      const x = Math.round(d.getBoundingClientRect().x / 10) * 10;
      xGroups[x] = (xGroups[x] || 0) + 1;
    });
    const dateColX = parseInt(Object.entries(xGroups).sort((a,b) => b[1]-a[1])[0][0]);

    // 그리드 날짜 컬럼에 있는 셀만 행 앵커로
    const anchors = dateCells
      .filter(d => Math.abs(Math.round(d.getBoundingClientRect().x) - dateColX) < 30)
      .map(d => ({
        y: d.getBoundingClientRect().y,
        h: d.getBoundingClientRect().height,
        date: d.innerText.trim(),
      }))
      .sort((a, b) => a.y - b.y);

    if (anchors.length === 0) return { error: '그리드 앵커 없음', rows: [] };

    const rowH = anchors.length > 1
      ? Math.round(anchors[1].y - anchors[0].y)
      : anchors[0].h * 1.2;

    const gridMinY = anchors[0].y - 2;
    const gridMaxY = anchors[anchors.length - 1].y + rowH;

    // 3) 그리드 영역의 모든 leaf div 수집
    const gridLeafs = leafs.filter(d => {
      const r = d.getBoundingClientRect();
      return r.y >= gridMinY && r.y <= gridMaxY;
    });

    // 4) 각 앵커 Y에서 같은 행의 셀 수집 (Y ± rowH/2)
    const rows = [];
    for (const anchor of anchors) {
      const rowCells = gridLeafs
        .filter(d => {
          const r = d.getBoundingClientRect();
          return Math.abs(r.y - anchor.y) < rowH * 0.6;
        })
        .sort((a, b) => a.getBoundingClientRect().x - b.getBoundingClientRect().x)
        .map(d => d.innerText.trim());

      rows.push({ y: Math.round(anchor.y), cells: rowCells });
    }

    return { dateColX, rowH: Math.round(rowH), anchors: anchors.length, rows };
  });
}

// 다음 페이지 버튼 클릭
async function clickNext(page) {
  return page.evaluate(() => {
    const candidates = [...document.querySelectorAll('div,a,span')].filter(el => {
      if (el.childElementCount > 0) return false;
      const t = el.innerText && el.innerText.trim();
      const r = el.getBoundingClientRect();
      const cls = el.className || '';
      return r.width > 0 && (
        t === '>' ||
        cls.includes('cl-next') ||
        cls.includes('next-page')
      );
    });

    // 페이지네이션 '>' 버튼 (가장 오른쪽 아래)
    if (candidates.length > 0) {
      candidates.sort((a, b) => b.getBoundingClientRect().y - a.getBoundingClientRect().y);
      const btn = candidates[0];
      const r = btn.getBoundingClientRect();
      // disabled 체크
      if (btn.classList.contains('cl-disabled') || btn.classList.contains('disabled')) {
        return false;
      }
      btn.click();
      return true;
    }
    return false;
  });
}

// 컬럼 헤더 이름 결정 (첫 페이지에서)
async function getHeaders(page) {
  return page.evaluate(() => {
    const leafs = [...document.querySelectorAll('div')].filter(d => {
      if (d.childElementCount > 0) return false;
      const r = d.getBoundingClientRect();
      return r.width > 0 && r.height > 0 && d.innerText && d.innerText.trim();
    });

    // 날짜 셀의 Y 찾기
    const firstDate = leafs.find(d => /^\d{4}-\d{2}-\d{2}$/.test(d.innerText.trim()));
    if (!firstDate) return null;

    const dataY = firstDate.getBoundingClientRect().y;
    const rowH = firstDate.getBoundingClientRect().height;

    // 헤더: dataY 위에 있는 행 (약 1~2 rowH 위)
    const headerCandidates = leafs.filter(d => {
      const r = d.getBoundingClientRect();
      return r.y < dataY - 2 && r.y > dataY - rowH * 3 && d.innerText.trim().length < 30;
    }).sort((a, b) => a.getBoundingClientRect().x - b.getBoundingClientRect().x);

    // x 위치가 그리드 범위 내인 것만 (x > 300 기준)
    const dateColX = firstDate.getBoundingClientRect().x;
    const gridLeft = dateColX - 200; // 날짜 컬럼 왼쪽으로 약 200px

    return headerCandidates
      .filter(d => d.getBoundingClientRect().x >= gridLeft)
      .map(d => d.innerText.trim().replace(/\r?\n/g, ' '));
  });
}

async function main() {
  const browser = await chromium.connectOverCDP('http://localhost:9445', { timeout: 10000 })
    .catch(e => { console.error('CDP 연결 실패:', e.message); process.exit(1); });

  const context = browser.contexts()[0];
  const page = context.pages().find(p => p.url().includes('lss.do'));
  page.on('dialog', async d => { try { await d.accept(); } catch {} });

  // 현재 상태 확인
  const totalText = await page.evaluate(() => {
    const m = document.body.innerText.match(/총\s*(\d+)\s*건/);
    return m ? m[1] : '?';
  });
  console.log(`집행내역 ${totalText}건 확인`);

  // 헤더 추출
  const headers = await getHeaders(page);
  console.log('헤더:', headers);

  if (DEBUG) {
    const result = await extractRows(page);
    console.log('\n[DEBUG] 추출 결과:');
    console.log('dateColX:', result.dateColX, 'rowH:', result.rowH);
    console.log('앵커 수:', result.anchors);
    if (result.rows) {
      result.rows.slice(0, 3).forEach((row, i) => {
        console.log(`\n행[${i}] y=${row.y}:`, row.cells);
      });
    }
    await browser.close();
    return;
  }

  // 전체 수집
  const allRows = [];
  let pageNum = 1;

  while (true) {
    console.log(`[페이지 ${pageNum}] 추출 중...`);
    const result = await extractRows(page);

    if (result.error || !result.rows || result.rows.length === 0) {
      console.log('  → 종료:', result.error || '데이터 없음');
      break;
    }

    console.log(`  → ${result.rows.length}행`);

    for (const row of result.rows) {
      const cells = row.cells;
      const record = {};
      if (headers && headers.length > 0) {
        headers.forEach((h, i) => {
          if (cells[i] !== undefined) record[h] = cells[i];
        });
        record._raw = cells; // 원본도 보존
      } else {
        record._raw = cells;
        // 위치 기반 기본 매핑
        const COLS = ['순번', '집행실행일자', '집행방식', '집행목적', '검증검토', '보조세목', '지방비집행금액', '자부담집행금액', '불인정금액', '거래처명'];
        COLS.forEach((h, i) => { if (cells[i]) record[h] = cells[i]; });
      }
      allRows.push(record);
    }

    // 다음 페이지
    const hasNext = await clickNext(page);
    if (!hasNext) {
      console.log('마지막 페이지');
      break;
    }
    await sleep(1500);
    pageNum++;

    if (pageNum > 200) {
      console.log('200페이지 초과 강제 종료');
      break;
    }
  }

  console.log(`\n총 ${allRows.length}건 수집`);

  if (allRows.length > 0) {
    fs.mkdirSync(path.dirname(OUTPUT), { recursive: true });
    fs.writeFileSync(OUTPUT, JSON.stringify(allRows, null, 2), 'utf-8');
    const kb = Math.round(fs.statSync(OUTPUT).size / 1024);
    console.log(`저장: ${OUTPUT} (${kb}KB)`);
  }

  await browser.close();
}

main().catch(e => { console.error('ERROR:', e.message); process.exit(1); });
