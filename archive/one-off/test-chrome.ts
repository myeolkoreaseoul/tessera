#!/usr/bin/env npx ts-node

import { chromium } from 'playwright';
import fs from 'fs';

async function getWindowsHostIp(): Promise<string | null> {
  try {
    const resolv = fs.readFileSync('/etc/resolv.conf', 'utf-8');
    const match = resolv.match(/nameserver\s+(\d+\.\d+\.\d+\.\d+)/);
    return match ? match[1] : null;
  } catch {
    return null;
  }
}

async function testChromeConnection() {
  console.log('Chrome 디버그 모드 연결 테스트\n');

  const windowsIp = await getWindowsHostIp();
  console.log(`Windows 호스트 IP: ${windowsIp || '감지 실패'}\n`);

  const urls = [
    'http://localhost:9222',
    'http://127.0.0.1:9222',
  ];

  if (windowsIp) {
    urls.push(`http://${windowsIp}:9222`);
  }

  for (const url of urls) {
    console.log(`시도: ${url}`);
    try {
      const browser = await chromium.connectOverCDP(url, { timeout: 3000 });
      const contexts = browser.contexts();
      const pages = contexts[0]?.pages() || [];

      console.log(`  ✅ 연결 성공!`);
      console.log(`  열린 탭: ${pages.length}개`);

      for (const page of pages.slice(0, 3)) {
        console.log(`    - ${await page.title()}`);
      }

      await browser.close();
      console.log('\n테스트 완료: Chrome 디버그 모드 정상 작동');
      return;
    } catch (error) {
      console.log(`  ❌ 실패: ${error instanceof Error ? error.message : error}`);
    }
  }

  console.log('\n========================================');
  console.log('Chrome에 연결할 수 없습니다.');
  console.log('');
  console.log('해결 방법:');
  console.log('');
  console.log('1. 작업관리자에서 모든 Chrome 프로세스 종료');
  console.log('');
  console.log('2. Windows에서 CMD를 열고 실행:');
  console.log('   "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe" --remote-debugging-port=9222');
  console.log('');
  console.log('3. Chrome이 열리면 이 테스트를 다시 실행');
  console.log('========================================');
}

testChromeConnection().catch(console.error);
