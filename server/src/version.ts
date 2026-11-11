// ─── 版本与运行环境标记（水印/防呆共用）────────────────────────────
import type { BrowserDetectResult } from './env-check.js';

export const APP_VERSION = '0.2.0';
export const APP_AUTHOR = 'SrQingChen';
export const APP_LICENSE = 'GPL-3.0-or-later';
export const APP_NAME = '多功能点赞统计助手';

/** 由 index.ts 启动时填充（detectBrowser 结果） */
export let browserInfo: BrowserDetectResult = { kind: 'none', detail: '未检测', browsersPath: null };
export function setBrowserInfo(r: BrowserDetectResult) { browserInfo = r; }
