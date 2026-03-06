import { chromium } from 'playwright';

async function test() {
  const browser = await chromium.connectOverCDP('http://localhost:9444');
  const context = browser.contexts()[0];
  const popup = context.pages().find(p => p.url().includes('getDB003002SView'));

  if (!popup) { console.log('팝업 없음'); await browser.close(); return; }

  console.log('팝업 URL:', popup.url());
  await popup.waitForLoadState('domcontentloaded');

  const info = await popup.evaluate(() => {
    const links = Array.from(document.querySelectorAll('a')).map(a => ({
      text: a.textContent?.trim(),
      href: a.href,
      onclick: a.getAttribute('onclick')
    })).filter(l => l.text);

    const buttons = Array.from(document.querySelectorAll('button, input[type="button"]')).map(b => ({
      text: (b as HTMLElement).textContent?.trim() || (b as HTMLInputElement).value,
      id: b.id,
      onclick: b.getAttribute('onclick')
    }));

    const checkboxes = Array.from(document.querySelectorAll('input[type="checkbox"]')).map(cb => ({
      name: cb.getAttribute('name'),
      id: cb.id,
      value: (cb as HTMLInputElement).value
    }));

    const tables = document.querySelectorAll('table');
    const tableInfo = Array.from(tables).map(t => ({
      rows: t.rows.length,
      firstRowText: t.rows[0]?.innerText?.substring(0, 200)
    }));

    return {
      title: document.title,
      links: links.slice(0, 20),
      buttons,
      checkboxes,
      tableInfo,
      bodyText: document.body?.innerText?.substring(0, 1500)
    };
  });

  console.log('\n제목:', info.title);
  console.log('\n=== 링크 ===');
  for (const l of info.links) {
    console.log(`  [${l.text}] href=${l.href?.substring(0, 80)} onclick=${l.onclick?.substring(0, 80)}`);
  }
  console.log('\n=== 버튼 ===');
  for (const b of info.buttons) {
    console.log(`  [${b.text}] id=${b.id} onclick=${b.onclick?.substring(0, 80)}`);
  }
  console.log('\n=== 체크박스 ===', info.checkboxes.length, '개');
  for (const cb of info.checkboxes) {
    console.log(`  name=${cb.name} id=${cb.id} value=${cb.value}`);
  }
  console.log('\n=== 본문 ===');
  console.log(info.bodyText);

  await popup.screenshot({ path: 'C:/projects/e-naradomum-rpa/popup-screenshot.png' });
  console.log('\n스크린샷 저장됨');

  await browser.close();
}

test().catch(console.error);
