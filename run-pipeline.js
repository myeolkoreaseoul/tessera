/**
 * 통합 파이프라인 진입점
 *
 * 지휘관 서버(child_process.fork)와 CLI 모두에서 사용.
 * --system 인자로 시스템 분기.
 *
 * 사용법:
 *   node run-pipeline.js --system=enaradomum --inst=기관명 [기타 옵션...]
 *   node run-pipeline.js --system=ezbaro --project=사업명 --inst=기관명 [기타 옵션...]
 */

const { Reporter } = require('./lib/reporter');

// CLI 인자 파싱
const args = Object.fromEntries(
  process.argv.slice(2)
    .filter(a => a.startsWith('--'))
    .map(a => {
      const [k, ...v] = a.slice(2).split('=');
      return [k, v.length ? v.join('=') : true];
    })
);

const system = args.system;
if (!system) {
  console.log('사용법: node run-pipeline.js --system=<시스템명> [옵션...]');
  console.log('  --system   enaradomum | ezbaro | rcms | botame');
  console.log('  이하 옵션은 각 시스템 파이프라인에 전달됨');
  process.exit(1);
}

const reporter = new Reporter({ system });

async function run() {
  reporter.phaseChange(0, `${system} 파이프라인 시작`);

  switch (system) {
    case 'enaradomum': {
      // run-all.js의 main()을 호출
      const { main } = require('./run-all');
      await main();
      break;
    }
    case 'ezbaro': {
      try {
        const { main } = require('./run-ezbaro');
        await main();
      } catch (err) {
        if (err.code === 'MODULE_NOT_FOUND') {
          reporter.error('run-ezbaro.js가 아직 구현되지 않았습니다.', err.message, false);
          process.exitCode = 1;
          return;
        }
        throw err;
      }
      break;
    }
    case 'rcms': {
      try {
        const { main } = require('./run-rcms');
        await main();
      } catch (err) {
        if (err.code === 'MODULE_NOT_FOUND') {
          reporter.error('run-rcms.js가 아직 구현되지 않았습니다.', err.message, false);
          process.exitCode = 1;
          return;
        }
        throw err;
      }
      break;
    }
    case 'botame': {
      try {
        const { main } = require('./run-botame');
        await main();
      } catch (err) {
        if (err.code === 'MODULE_NOT_FOUND') {
          reporter.error('run-botame.js가 아직 구현되지 않았습니다.', err.message, false);
          process.exitCode = 1;
          return;
        }
        throw err;
      }
      break;
    }
    default:
      reporter.error(`알 수 없는 시스템: ${system}`, null, false);
      process.exitCode = 1;
      return;
  }

  reporter.done({ system });
}

run().catch(err => {
  reporter.error(err.message, err.stack, false);
  process.exitCode = 1;
});
