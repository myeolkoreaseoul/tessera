import path from 'path';
import { Config } from '../types';

const ROOT_DIR = path.resolve(__dirname, '../../');

export const defaultConfig: Config = {
  // Chrome CDP
  cdpUrl: 'http://localhost:9444',

  // 경로
  downloadDir: path.join(ROOT_DIR, 'downloads'),
  resultDir: path.join(ROOT_DIR, 'results'),
  logDir: path.join(ROOT_DIR, 'logs'),

  // API
  geminiApiKey: process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || '',
  llmModel: 'gemini-2.0-flash',  // 빠르고 저렴

  // 타임아웃
  pageLoadTimeout: 60000,     // 60초
  downloadTimeout: 120000,    // 120초

  // 판단 기준
  confidenceThreshold: 80,    // 80% 미만이면 "확인필요"
};

export function getConfig(overrides?: Partial<Config>): Config {
  return {
    ...defaultConfig,
    ...overrides,
  };
}
