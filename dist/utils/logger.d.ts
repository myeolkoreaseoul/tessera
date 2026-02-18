export type LogLevel = 'debug' | 'info' | 'warn' | 'error';
declare class Logger {
    private logFile;
    private verbose;
    init(logDir: string, sessionId: string, verbose?: boolean): void;
    private formatMessage;
    private writeToFile;
    debug(message: string, data?: unknown): void;
    info(message: string, data?: unknown): void;
    success(message: string): void;
    warn(message: string, data?: unknown): void;
    error(message: string, error?: unknown): void;
    step(stepNumber: number, totalSteps: number, message: string): void;
    progress(current: number, total: number, message: string): void;
    divider(): void;
    banner(title: string): void;
}
export declare const logger: Logger;
export {};
//# sourceMappingURL=logger.d.ts.map