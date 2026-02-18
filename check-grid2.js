const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.connectOverCDP('http://localhost:9444');
  const context = browser.contexts()[0];
  const page = context.pages().find(p => p.url().includes('dd001'));
  if (!page) { console.log('dd001 페이지 없음'); return; }

  const info = await page.evaluate(() => {
    const grid = window.DD001002QGridObj;
    if (!grid) return { error: 'DD001002QGridObj is null' };

    const methods = Object.keys(grid).filter(k => typeof grid[k] === 'function').sort();
    const rowCount = typeof grid.getRowCount === 'function' ? grid.getRowCount() : 'N/A';

    // getDataRows 시도
    let dataRows = null;
    if (typeof grid.getDataRows === 'function') {
      try { dataRows = grid.getDataRows().length; } catch (e) { dataRows = 'error: ' + e.message; }
    }

    // getValue 시도 (row 0)
    let sampleValue = null;
    if (typeof grid.getValue === 'function') {
      try { sampleValue = grid.getValue(0, 'excutPurps') || grid.getValue(1, 'excutPurps'); } catch (e) { sampleValue = 'error: ' + e.message; }
    }

    // getRowData 시도
    let rowData = null;
    if (typeof grid.getRowData === 'function') {
      try { rowData = grid.getRowData(0); } catch (e) { rowData = 'error: ' + e.message; }
    }
    if (!rowData && typeof grid.getRowData === 'function') {
      try { rowData = grid.getRowData(1); } catch (e) { rowData = 'error: ' + e.message; }
    }

    // DD001002QGridData 확인
    let gridData = null;
    if (window.DD001002QGridData) {
      gridData = { length: Array.isArray(window.DD001002QGridData) ? window.DD001002QGridData.length : 'not array' };
      if (Array.isArray(window.DD001002QGridData) && window.DD001002QGridData.length > 0) {
        gridData.sampleKeys = Object.keys(window.DD001002QGridData[0]);
      }
    }

    return { rowCount, dataRows, sampleValue, rowData, gridData, methodCount: methods.length, methods: methods.slice(0, 50) };
  });
  console.log(JSON.stringify(info, null, 2));
})();
