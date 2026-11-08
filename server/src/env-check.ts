// ─── 环境防呆：单实例锁 + 浏览器检测（setup splash 与 core 共用）──

import net from 'node:net';
import fs from 'node:fs';
import path from 'node:path';

/** 端口可绑定 = 无其他实例。防呆：二次启动/重复双击时给出明确语义而非诡异的 EADDRINUSE */
export function portFree(port: number, timeoutMs = 800): Promise<boolean> {
  return new Promise(resolve => {
    const srv = net.createServer();
    const done = (ok: boolean) => { try { srv.close(() => resolve(ok)); } catch { resolve(ok); } };
    srv.once('error', () => done(false));
    srv.listen({ port, host: '127.0.0.1' }, () => done(true));
    setTimeout(() => done(false), timeoutMs);
  });
}

export interface BrowserDetectResult {
  kind: 'chrome' | 'bundled-chromium' | 'none';
  detail: string;         // 人类可读描述（splash/控制台展示）
  browsersPath: string | null;  // 内置浏览器目录（存在时注入 PLAYWRIGHT_BROWSERS_PATH）
}

const CHROME_CANDIDATES = [
  String.raw`C:\Program Files\Google\Chrome\Application\chrome.exe`,
  String.raw`C:\Program Files (x86)\Google\Chrome\Application\chrome.exe`,
  String.raw`%LOCALAPPDATA%\Google\Chrome\Application\chrome.exe`,
];

/** 检测系统 Chrome 与内置 Chromium。纯被动探测，不产生任何写操作。 */
export function detectBrowser(projectRoot: string): BrowserDetectResult {
  // 系统 Chrome
  for (const raw of CHROME_CANDIDATES) {
    const p = raw.replace('%LOCALAPPDATA%', process.env.LOCALAPPDATA ?? '');
    try { if (fs.existsSync(p)) return { kind: 'chrome', detail: '系统 Chrome', browsersPath: null }; } catch {}
  }
  // 内置 Chromium（便携包 browsers/ 目录）
  const bp = path.join(projectRoot, 'browsers');
  try {
    if (fs.existsSync(bp) && fs.readdirSync(bp).some(d => d.startsWith('chromium-'))) {
      return { kind: 'bundled-chromium', detail: '内置 Chromium（便携包）', browsersPath: bp };
    }
  } catch {}
  return { kind: 'none', detail: '未检测到可用浏览器', browsersPath: null };
}

/** 当前项目根（<root>/server/src → <root>） */
export function projectRootFrom(here: string): string {
  return path.resolve(here, '..', '..');
}
