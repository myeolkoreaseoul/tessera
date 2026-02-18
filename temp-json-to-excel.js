const ExcelJS = require('exceljs');
const fs = require('fs');
const path = require('path');

const resultFiles = fs.readdirSync('/mnt/c/projects/e-naradomum-rpa')
  .filter(f => f.endsWith('-results.json'));

console.log(`${resultFiles.length}개 결과 파일 발견\n`);

(async () => {
  for (const file of resultFiles) {
    const name = file.replace('-results.json', '');
    const jsonPath = path.join('/mnt/c/projects/e-naradomum-rpa', file);
    const results = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));

    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('검토결과');

    // 헤더
    ws.columns = [
      { header: '행번호', key: 'rowNum', width: 8 },
      { header: '분류', key: 'type', width: 12 },
      { header: '집행용도', key: 'purpose', width: 35 },
      { header: '금액', key: 'amount', width: 15 },
      { header: '거래처', key: 'vendor', width: 25 },
      { header: '판정', key: 'status', width: 10 },
      { header: '보완요청 사유', key: 'issues', width: 60 },
      { header: '적정 근거', key: 'ok', width: 40 },
    ];

    // 헤더 스타일
    ws.getRow(1).font = { bold: true };
    ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD9E1F2' } };

    for (const r of results) {
      const row = ws.addRow({
        rowNum: r.rowNum,
        type: r.type || '',
        purpose: r.purpose || '',
        amount: r.amount,
        vendor: r.vendor || '',
        status: r.status === '적정' ? '적정(검토완료)' : '확인(보완요청)',
        issues: (r.issues || []).join('; '),
        ok: (r.ok || []).join('; '),
      });

      // 확인 건 빨간 배경
      if (r.status !== '적정') {
        row.getCell('status').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFCE4EC' } };
      } else {
        row.getCell('status').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8F5E9' } };
      }
    }

    // 요약 시트
    const summary = wb.addWorksheet('요약');
    const total = results.length;
    const ok = results.filter(r => r.status === '적정').length;
    const check = total - ok;
    summary.addRow(['기관명', name]);
    summary.addRow(['총 건수', total]);
    summary.addRow(['적정(검토완료)', ok]);
    summary.addRow(['확인(보완요청)', check]);
    summary.addRow([]);
    summary.addRow(['보완요청 사유 요약']);
    summary.getRow(1).font = { bold: true };
    summary.getRow(6).font = { bold: true };

    // 이슈별 집계
    const issueMap = {};
    for (const r of results) {
      for (const iss of (r.issues || [])) {
        if (!issueMap[iss]) issueMap[iss] = [];
        issueMap[iss].push(`R${r.rowNum}`);
      }
    }
    for (const [issue, rows] of Object.entries(issueMap)) {
      summary.addRow([`${issue}`, `${rows.length}건`, rows.join(', ')]);
    }

    summary.getColumn(1).width = 50;
    summary.getColumn(2).width = 10;
    summary.getColumn(3).width = 50;

    const outPath = path.join('/mnt/c/projects/e-naradomum-rpa/results', `${name}_검토결과.xlsx`);
    await wb.xlsx.writeFile(outPath);
    console.log(`  ${name}: ${total}건 (적정${ok}/확인${check}) → ${path.basename(outPath)}`);
  }

  console.log('\n전체 완료');
})();
