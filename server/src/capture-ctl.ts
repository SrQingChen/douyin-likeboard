// ─── 捕获进程监护：spawn + 崩溃自动重启（docs §5 core 守护）────────
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Hub } from './hub.js';
import { browserInfo } from './version.js';
import { getConfig } from './config.js';

const here = path.dirname(fileURLToPath(import.meta.url)); // .../server/src
const CAPTURE_ENTRY = path.resolve(here, 'capture', 'main.ts');
const ROOT = path.resolve(here, '..', '..');

/** 组装 capture 环境防呆变量：内置 Chromium 目录存在 → 注入 PLAYWRIGHT_BROWSERS_PATH */
function captureEnv(): Record<string, string> {
  const env: Record<string, string> = {
    CAPTURE_TABS: String(getConfig().captureTabs),
    // Chrome 缺失 → capture 走内置 Chromium（防呆：空白机也能跑，日志会提示）
    CAPTURE_FORCE_CHANNEL: browserInfo.kind === 'chrome' ? '' : (browserInfo.kind === 'bundled-chromium' ? 'bundled' : ''),
  };
  if (browserInfo.browsersPath) env.PLAYWRIGHT_BROWSERS_PATH = browserInfo.browsersPath;
  return env;
}

export class CaptureCtl {
  child: ChildProcess | null = null;
  private stopping = false;
  private restarts: number[] = [];
  private onState: (s: string) => void;

  constructor(private hub: Hub, private env: Record<string, string>, onState: (s: string) => void) {
    this.onState = onState;
  }

  start() {
    if (this.child) return;
    this.stopping = false;
    this.hub.log(`启动捕获进程…（浏览器：${browserInfo.detail}）`);
    const child = spawn(process.execPath, ['--import', 'tsx', CAPTURE_ENTRY], {
      cwd: path.resolve(here, '..'),
      env: { ...process.env, ...captureEnv(), ...this.env },
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    this.child = child;
    const pipe = (d: Buffer, tag: string) => {
      for (const line of d.toString('utf-8').split('\n')) {
        const s = line.trimEnd();
        if (s) this.hub.log(`[capture${tag}] ${s}`);
      }
    };
    child.stdout?.on('data', d => pipe(d, ''));
    child.stderr?.on('data', d => pipe(d, ':err'));
    child.on('exit', (code, sig) => {
      this.child = null;
      if (this.stopping) return;
      // 重启窗口限流：10 分钟内最多 5 次
      const now = Date.now();
      this.restarts = this.restarts.filter(t => now - t < 600_000);
      if (this.restarts.length >= 5) {
        this.hub.log('捕获进程重启次数超限（10min/5 次），进入 failed 状态，请人工排查');
        this.onState('failed');
        return;
      }
      this.restarts.push(now);
      const wait = Math.min(30_000, 3000 * this.restarts.length);
      this.hub.log(`捕获进程退出（code=${code} sig=${sig}），${Math.round(wait / 1000)}s 后自动重启`);
      this.onState('restarting');
      setTimeout(() => { if (!this.stopping) this.start(); }, wait);
    });
  }

  stop() {
    this.stopping = true;
    const pid = this.child?.pid;
    if (pid) {
      // Windows 上只 kill 父 node 会留下 Chrome/tsx 子进程；按进程树结束，避免下次启动 profile 被占用
      if (process.platform === 'win32') {
        try { spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { timeout: 12_000 }); } catch {}
      } else {
        try { this.child?.kill(); } catch {}
      }
    }
    this.child = null;
  }
}
