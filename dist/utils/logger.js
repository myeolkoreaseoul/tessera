"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.logger = void 0;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const chalk_1 = __importDefault(require("chalk"));
const dayjs_1 = __importDefault(require("dayjs"));
class Logger {
    logFile = null;
    verbose = false;
    init(logDir, sessionId, verbose = false) {
        this.verbose = verbose;
        if (!fs_1.default.existsSync(logDir)) {
            fs_1.default.mkdirSync(logDir, { recursive: true });
        }
        const timestamp = (0, dayjs_1.default)().format('YYYYMMDD_HHmmss');
        this.logFile = path_1.default.join(logDir, `${sessionId}_${timestamp}.log`);
    }
    formatMessage(level, message) {
        const timestamp = (0, dayjs_1.default)().format('YYYY-MM-DD HH:mm:ss');
        return `[${timestamp}] [${level.toUpperCase()}] ${message}`;
    }
    writeToFile(entry) {
        if (this.logFile) {
            const line = JSON.stringify(entry) + '\n';
            fs_1.default.appendFileSync(this.logFile, line);
        }
    }
    debug(message, data) {
        if (this.verbose) {
            console.log(chalk_1.default.gray(this.formatMessage('debug', message)));
            if (data)
                console.log(chalk_1.default.gray(JSON.stringify(data, null, 2)));
        }
        this.writeToFile({
            timestamp: (0, dayjs_1.default)().toISOString(),
            level: 'debug',
            message,
            data,
        });
    }
    info(message, data) {
        console.log(chalk_1.default.blue('ℹ'), message);
        if (data && this.verbose) {
            console.log(chalk_1.default.gray(JSON.stringify(data, null, 2)));
        }
        this.writeToFile({
            timestamp: (0, dayjs_1.default)().toISOString(),
            level: 'info',
            message,
            data,
        });
    }
    success(message) {
        console.log(chalk_1.default.green('✓'), message);
        this.writeToFile({
            timestamp: (0, dayjs_1.default)().toISOString(),
            level: 'info',
            message: `[SUCCESS] ${message}`,
        });
    }
    warn(message, data) {
        console.log(chalk_1.default.yellow('⚠'), chalk_1.default.yellow(message));
        if (data)
            console.log(chalk_1.default.yellow(JSON.stringify(data, null, 2)));
        this.writeToFile({
            timestamp: (0, dayjs_1.default)().toISOString(),
            level: 'warn',
            message,
            data,
        });
    }
    error(message, error) {
        console.log(chalk_1.default.red('✗'), chalk_1.default.red(message));
        if (error) {
            if (error instanceof Error) {
                console.log(chalk_1.default.red(error.stack || error.message));
            }
            else {
                console.log(chalk_1.default.red(JSON.stringify(error, null, 2)));
            }
        }
        this.writeToFile({
            timestamp: (0, dayjs_1.default)().toISOString(),
            level: 'error',
            message,
            data: error instanceof Error ? { message: error.message, stack: error.stack } : error,
        });
    }
    step(stepNumber, totalSteps, message) {
        console.log(chalk_1.default.cyan(`[${stepNumber}/${totalSteps}]`), message);
        this.writeToFile({
            timestamp: (0, dayjs_1.default)().toISOString(),
            level: 'info',
            message: `[Step ${stepNumber}/${totalSteps}] ${message}`,
        });
    }
    progress(current, total, message) {
        const percent = Math.round((current / total) * 100);
        const bar = '█'.repeat(Math.floor(percent / 5)) + '░'.repeat(20 - Math.floor(percent / 5));
        process.stdout.write(`\r${chalk_1.default.cyan(bar)} ${percent}% (${current}/${total}) ${message}`);
        if (current === total) {
            console.log(); // 줄바꿈
        }
    }
    divider() {
        console.log(chalk_1.default.gray('─'.repeat(60)));
    }
    banner(title) {
        console.log();
        console.log(chalk_1.default.bold.cyan('╔' + '═'.repeat(58) + '╗'));
        console.log(chalk_1.default.bold.cyan('║') + chalk_1.default.bold.white(title.padStart(30 + title.length / 2).padEnd(58)) + chalk_1.default.bold.cyan('║'));
        console.log(chalk_1.default.bold.cyan('╚' + '═'.repeat(58) + '╝'));
        console.log();
    }
}
exports.logger = new Logger();
//# sourceMappingURL=logger.js.map