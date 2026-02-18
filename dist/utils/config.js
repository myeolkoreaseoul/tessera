"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.defaultConfig = void 0;
exports.getConfig = getConfig;
const path_1 = __importDefault(require("path"));
const ROOT_DIR = path_1.default.resolve(__dirname, '../../');
exports.defaultConfig = {
    // Chrome CDP
    cdpUrl: 'http://localhost:9444',
    // 경로
    downloadDir: path_1.default.join(ROOT_DIR, 'downloads'),
    resultDir: path_1.default.join(ROOT_DIR, 'results'),
    logDir: path_1.default.join(ROOT_DIR, 'logs'),
    // API
    geminiApiKey: process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || '',
    llmModel: 'gemini-2.0-flash', // 빠르고 저렴
    // 타임아웃
    pageLoadTimeout: 60000, // 60초
    downloadTimeout: 120000, // 120초
    // 판단 기준
    confidenceThreshold: 80, // 80% 미만이면 "확인필요"
};
function getConfig(overrides) {
    return {
        ...exports.defaultConfig,
        ...overrides,
    };
}
//# sourceMappingURL=config.js.map