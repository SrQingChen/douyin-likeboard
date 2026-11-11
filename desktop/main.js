// ── 榜单透明桌面窗口（Electron 壳）────────────────────────────────
// frameless + transparent + 置顶；加载 core 的 /board 页面。
// 交互：顶部细条拖动窗口；📌置顶 / 🖱鼠标穿透 / ✕关闭；
//      鼠标穿透后用全局快捷键 Ctrl+Alt+B 解锁。
'use strict';
const { app, BrowserWindow, ipcMain, globalShortcut, shell } = require('electron');
const http = require('http');
const path = require('path');
const fs = require('fs');
const { spawn, spawnSync } = require('child_process');

const args = process.argv.slice(2);
const getArg = (k, d) => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : d; };
const W = Math.max(300, Number(getArg('width', 560)) || 560);
const H = Math.max(420, Number(getArg('height', 960)) || 960);
const BASE = getArg('url', 'http://127.0.0.1:17730');
const SELFTEST = args.includes('--selftest');
const SETUP = args.includes('--setup');
// OBS/直播伴侣兼容模式：普通不透明窗口 + 纯绿背景，由采集端 Chroma Key 抠掉。
// 透明 Electron 窗口在 Windows 上带 WS_EX_NOREDIRECTIONBITMAP（DirectComposition），
// OBS/直播伴侣的窗口枚举通常直接跳过，列表里看不到；该模式可被正常枚举/捕获。
const CHROMA = args.includes('--chroma');
const WINDOW_TITLE = CHROMA ? '多功能点赞统计助手（OBS兼容）' : '多功能点赞统计助手';
const VERSION = '0.2.0';
const AUTHOR = 'SrQingChen';
// 项目根：electron.exe desktop 启动时 appPath = desktop → 上级即根
const ROOT = path.dirname(app.getAppPath ? app.getAppPath() : __dirname);
if (SETUP) { try { process.chdir(ROOT); } catch {} }
if (CHROMA) {
  // 去掉 DirectComposition，窗口变成普通可捕获窗口（代价：不能用逐像素透明，
  // 所以用纯绿背景 + 采集端 Chroma Key）。
  app.commandLine.appendSwitch('disable-direct-composition');
}

// 榜单窗口保持单实例；--setup 启动器与 --chroma 兼容窗口必须能与已开窗口共存。
if (!SETUP && !CHROMA && !app.requestSingleInstanceLock()) { app.quit(); }
let win = null;
let through = false;

function probeCore(cb, timeoutMs = 1500) {
  const req = http.get(`${BASE}/api/status`, { timeout: timeoutMs }, res => {
    res.resume();
    cb(res.statusCode === 200);
  });
  req.on('error', () => cb(false));
  req.on('timeout', () => { req.destroy(); cb(false); });
}

function loadBoardWithRetry() {
  const q = CHROMA
    ? '?transparent=1&frameless=1&chroma=1&layout=vertical'
    : '?transparent=1&frameless=1';
  win.loadURL(`${BASE}/board${q}`)
    .then(() => { if (SELFTEST) setTimeout(runSelftest, 3000); })
    .catch(() => {
      // core 半路挂掉：回等待页并重试
      win.loadFile('loading.html').catch(() => {});
      const timer = setInterval(() => {
        probeCore(ok => {
          if (ok && win && !win.isDestroyed()) { clearInterval(timer); loadBoardWithRetry(); }
        });
      }, 3000);
    });
}

async function runSelftest() {
  try {
    const r = await win.webContents.executeJavaScript(
      "JSON.stringify({ eb: !!window.electronBoard, btns: document.querySelectorAll('.eb-btn').length, podium: document.querySelectorAll('.pedestal').length })", true);
    console.log('SELFTEST ' + r);
  } catch (e) { console.log('SELFTEST FAIL ' + e); }
  app.quit();
}

function createWindow() {
  console.log(`[board] mode=${CHROMA ? 'chroma' : 'transparent'} title=${WINDOW_TITLE}`);
  win = new BrowserWindow({
    width: W, height: H,
    minWidth: 300, minHeight: 420,
    frame: false,
    // 透明窗口：逐像素透明（OBS 浏览器源/支持 WGC 的采集端可用）
    // 兼容窗口：普通不透明窗口 + 纯绿背景（OBS/直播伴侣窗口捕获 + Chroma Key）
    transparent: !CHROMA,
    backgroundColor: CHROMA ? '#00FF00' : '#00000000',
    hasShadow: false,
    alwaysOnTop: false,          // 默认不置顶（用户要求），📌按钮可开
    show: false,
    skipTaskbar: false,
    title: WINDOW_TITLE,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true, nodeIntegration: false,
    },
  });
  // 页面 title 不覆盖窗口 title，保证 OBS/直播伴侣列表里能按名称找到
  win.on('page-title-updated', (e) => {
    e.preventDefault();
    if (win && !win.isDestroyed()) win.setTitle(WINDOW_TITLE);
  });
  win.once('ready-to-show', () => { if (!SELFTEST) win.show(); });

  win.loadFile('loading.html');
  const startProbe = setInterval(() => {
    probeCore(ok => {
      if (ok) { clearInterval(startProbe); if (win && !win.isDestroyed()) loadBoardWithRetry(); }
    });
  }, 2000);

  win.on('closed', () => { win = null; });
}

function applyThrough(v) {
  through = v;
  if (win && !win.isDestroyed()) win.setIgnoreMouseEvents(v, { forward: true });
}

ipcMain.on('win-pin', (_e, v) => { if (win && !win.isDestroyed()) win.setAlwaysOnTop(!!v, 'screen-saver'); });
ipcMain.on('win-through', (_e, v) => { applyThrough(!!v); if (win && !win.isDestroyed()) win.webContents.send('through-changed', through); });
ipcMain.on('win-close', () => { if (win) win.close(); });

// ═══ 零部署 splash：--setup 部署进度窗（5 步，防呆语义集中在此）═══
const SETUP_STEPS = [
  { id: 'node', label: '运行环境（Node.js）' },
  { id: 'browser', label: '浏览器检测' },
  { id: 'data', label: '数据目录初始化' },
  { id: 'core', label: '核心服务启动' },
  { id: 'console', label: '打开控制台' },
];

function detectChrome() {
  const cands = [
    String.raw`C:\Program Files\Google\Chrome\Application\chrome.exe`,
    String.raw`C:\Program Files (x86)\Google\Chrome\Application\chrome.exe`,
    path.join(process.env.LOCALAPPDATA || '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
  ];
  for (const p of cands) { try { if (fs.existsSync(p)) return true; } catch {} }
  return false;
}

function detectBundled() {
  try { return fs.existsSync(path.join(ROOT, 'browsers')) &&
    fs.readdirSync(path.join(ROOT, 'browsers')).some(d => d.startsWith('chromium-')); } catch { return false; }
}

function nodeRuntime() {
  const portable = path.join(ROOT, 'runtime', 'node.exe');
  if (fs.existsSync(portable)) {
    let v = '';
    try { v = spawnSync(portable, ['--version'], { timeout: 5000 }).stdout?.toString().trim() ?? ''; } catch {}
    return { exe: portable, detail: `${v || 'Node.js'}（便携版）` };
  }
  const sys = spawnSync('node', ['--version'], { timeout: 5000, shell: true });
  if (sys.status === 0) return { exe: 'node', detail: `${sys.stdout?.toString().trim() || 'Node.js'}（系统）` };
  return null;
}

function runSetup() {
  const win = new BrowserWindow({
    width: 460, height: 340, frame: false, resizable: false,
    backgroundColor: '#0a0f1f', show: false,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false },
  });
  win.once('ready-to-show', () => win.show());
  win.loadFile('setup.html');
  win.webContents.on('did-finish-load', () => {
    win.webContents.executeJavaScript(`document.getElementById('ver') && (document.getElementById('ver').textContent = 'v${VERSION}')`).catch(() => {});
  });
  const step = (id, status, detail) => win.webContents.send('setup-step', { id, status, detail });
  const sleep = ms => new Promise(r => setTimeout(r, ms));

  (async () => {
    for (const s of SETUP_STEPS) step(s.id, 'run');

    // 1) node
    const rt = nodeRuntime();
    if (!rt) { step('node', 'fail', '未找到 Node.js（便携包应含 runtime/node.exe）'); return; }
    step('node', 'ok', rt.detail);
    await sleep(120);

    // 2) browser（防呆：空白机无 Chrome → 内置 Chromium 兜底）
    let browsersPath = null;
    let bDetail;
    if (detectChrome()) bDetail = '系统 Chrome（最佳数据完整度）';
    else if (detectBundled()) { bDetail = '内置 Chromium（未检测到 Chrome，自动兜底）'; browsersPath = path.join(ROOT, 'browsers'); }
    else bDetail = '未检测到浏览器，尝试系统默认';
    step('browser', 'ok', bDetail);
    await sleep(120);

    // 3) data 初始化
    try {
      fs.mkdirSync(path.join(ROOT, 'data'), { recursive: true });
      fs.mkdirSync(path.join(ROOT, 'data', 'avatars'), { recursive: true });
      const cfgPath = path.join(ROOT, 'data', 'config.json');
      if (!fs.existsSync(cfgPath)) {
        fs.writeFileSync(cfgPath, JSON.stringify({ roundMinutes: 30, rankBasis: 'round', boardCount: 50, autostartCapture: true, lastRoomUrl: null, cappedThreshold: 2800, checkpointSec: 30, surgeThreshold: 300, captureTabs: 2 }, null, 2));
      }
      step('data', 'ok', 'data/ 就绪（登录态与配置随包保留）');
    } catch (e) { step('data', 'fail', String(e).slice(0, 80)); return; }
    await sleep(120);

    // 4) core（防呆：已在跑 → 不重复启动；端口占用 → 明确语义）
    let running = await new Promise(r => probeCore(r, 1200));
    if (!running) {
      const serverDir = path.join(ROOT, 'server');
      const logPath = path.join(ROOT, 'data', 'core.log');
      // 日志轮转（长跑防膨胀）：>20MB 滚动保留 1 代
      try {
        if (fs.existsSync(logPath) && fs.statSync(logPath).size > 20 * 1024 * 1024) {
          const old = logPath + '.1';
          try { fs.rmSync(old, { force: true }); } catch {}
          fs.renameSync(logPath, old);
          win.webContents.send('setup-step', { id: 'core', status: 'run', detail: '上一轮日志已归档 core.log.1' });
        }
      } catch {}
      const fd = fs.openSync(logPath, 'a');
      const env = { ...process.env, PLAYWRIGHT_BROWSERS_PATH: browsersPath || process.env.PLAYWRIGHT_BROWSERS_PATH || '' };
      if (!browsersPath) delete env.PLAYWRIGHT_BROWSERS_PATH;
      const child = spawn(rt.exe, ['--import', 'tsx', 'src/index.ts'], {
        cwd: serverDir, env, detached: true, stdio: ['ignore', fd, fd], windowsHide: true,
      });
      child.unref();
      fs.closeSync(fd);
      const t0 = Date.now();
      let started = false;
      while (Date.now() - t0 < 60000) {
        await sleep(1200);
        running = await new Promise(r => probeCore(r, 1000));
        if (running) { started = true; break; }
        try { if (child.exitCode !== null) break; } catch {}
      }
      if (!started) { step('core', 'fail', '启动超时——查看 data/core.log 排错'); return; }
      step('core', 'ok', `核心已启动 http://127.0.0.1:17730`);
    } else {
      step('core', 'ok', '检测到小助手已在运行，直接复用');
    }
    await sleep(120);

    // 5) 打开控制台 → 收工（--no-open 仅用于自动化测试，不改变正常启动）
    if (!args.includes('--no-open')) await shell.openExternal(`${BASE}/`);
    step('console', 'ok', args.includes('--no-open') ? '控制台已就绪（测试模式未打开浏览器）' : '控制台已在浏览器打开');
    await sleep(1400);
    app.quit();
  })();
}

if (SETUP) {
  app.whenReady().then(runSetup);
  app.on('window-all-closed', () => app.quit());
} else {
  app.whenReady().then(() => {
    createWindow();
    globalShortcut.register('Control+Alt+B', () => {
      applyThrough(false);
      if (win && !win.isDestroyed()) win.webContents.send('through-changed', false);
      if (win && !win.isDestroyed()) win.show();
    });
  });
  app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.show(); win.focus(); } });
  app.on('window-all-closed', () => app.quit());
  app.on('will-quit', () => globalShortcut.unregisterAll());
}
