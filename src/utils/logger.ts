import fs from 'fs';
import path from 'path';
import chalk from 'chalk';
import dayjs from 'dayjs';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

interface LogEntry {
  timestamp: string;
  level: LogLevel;
  message: string;
  data?: unknown;
}

class Logger {
  private logFile: string | null = null;
  private verbose: boolean = false;

  init(logDir: string, sessionId: string, verbose: boolean = false) {
    this.verbose = verbose;

    if (!fs.existsSync(logDir)) {
      fs.mkdirSync(logDir, { recursive: true });
    }

    const timestamp = dayjs().format('YYYYMMDD_HHmmss');
    this.logFile = path.join(logDir, `${sessionId}_${timestamp}.log`);
  }

  private formatMessage(level: LogLevel, message: string): string {
    const timestamp = dayjs().format('YYYY-MM-DD HH:mm:ss');
    return `[${timestamp}] [${level.toUpperCase()}] ${message}`;
  }

  private writeToFile(entry: LogEntry) {
    if (this.logFile) {
      const line = JSON.stringify(entry) + '\n';
      fs.appendFileSync(this.logFile, line);
    }
  }

  debug(message: string, data?: unknown) {
    if (this.verbose) {
      console.log(chalk.gray(this.formatMessage('debug', message)));
      if (data) console.log(chalk.gray(JSON.stringify(data, null, 2)));
    }
    this.writeToFile({
      timestamp: dayjs().toISOString(),
      level: 'debug',
      message,
      data,
    });
  }

  info(message: string, data?: unknown) {
    console.log(chalk.blue('ℹ'), message);
    if (data && this.verbose) {
      console.log(chalk.gray(JSON.stringify(data, null, 2)));
    }
    this.writeToFile({
      timestamp: dayjs().toISOString(),
      level: 'info',
      message,
      data,
    });
  }

  success(message: string) {
    console.log(chalk.green('✓'), message);
    this.writeToFile({
      timestamp: dayjs().toISOString(),
      level: 'info',
      message: `[SUCCESS] ${message}`,
    });
  }

  warn(message: string, data?: unknown) {
    console.log(chalk.yellow('⚠'), chalk.yellow(message));
    if (data) console.log(chalk.yellow(JSON.stringify(data, null, 2)));
    this.writeToFile({
      timestamp: dayjs().toISOString(),
      level: 'warn',
      message,
      data,
    });
  }

  error(message: string, error?: unknown) {
    console.log(chalk.red('✗'), chalk.red(message));
    if (error) {
      if (error instanceof Error) {
        console.log(chalk.red(error.stack || error.message));
      } else {
        console.log(chalk.red(JSON.stringify(error, null, 2)));
      }
    }
    this.writeToFile({
      timestamp: dayjs().toISOString(),
      level: 'error',
      message,
      data: error instanceof Error ? { message: error.message, stack: error.stack } : error,
    });
  }

  step(stepNumber: number, totalSteps: number, message: string) {
    console.log(chalk.cyan(`[${stepNumber}/${totalSteps}]`), message);
    this.writeToFile({
      timestamp: dayjs().toISOString(),
      level: 'info',
      message: `[Step ${stepNumber}/${totalSteps}] ${message}`,
    });
  }

  progress(current: number, total: number, message: string) {
    const percent = Math.round((current / total) * 100);
    const bar = '█'.repeat(Math.floor(percent / 5)) + '░'.repeat(20 - Math.floor(percent / 5));
    process.stdout.write(`\r${chalk.cyan(bar)} ${percent}% (${current}/${total}) ${message}`);

    if (current === total) {
      console.log(); // 줄바꿈
    }
  }

  divider() {
    console.log(chalk.gray('─'.repeat(60)));
  }

  banner(title: string) {
    console.log();
    console.log(chalk.bold.cyan('╔' + '═'.repeat(58) + '╗'));
    console.log(chalk.bold.cyan('║') + chalk.bold.white(title.padStart(30 + title.length / 2).padEnd(58)) + chalk.bold.cyan('║'));
    console.log(chalk.bold.cyan('╚' + '═'.repeat(58) + '╝'));
    console.log();
  }
}

export const logger = new Logger();
