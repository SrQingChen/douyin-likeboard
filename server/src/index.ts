// ─── core 入口：装配各层 + 启动（docs §1）──────────────────────────
import Fastify from 'fastify';
import websocket from '@fastify/websocket';
import fastifyStatic from '@fastify/static';
import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { DB_PATH, TOKEN_PATH, DATA_DIR, loadConfig, getConfig, patchConfig, AVATAR_DIR, PROFILE_DIR } from './config.js';
import { Store } from './store.js';
import { Engine } from './engine.js';
import { Hub } from './hub.js';
import { registerAgent, agentCtl } from './agent.js';
import { registerApi } from './api.js';
import { CaptureCtl } from './capture-ctl.js';
import { portFree, detectBrowser, projectRootFrom } from './env-check.js';
import { APP_VERSION, setBrowserInfo } from './version.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = projectRootFrom(HERE);

// ── 防呆：单实例锁（重复双击 bat / 重复起进程 → 明确语义退出）──
if (!(await portFree(getConfigPort()))) {
  console.log(`[防呆] 端口 ${getConfigPort()} 已被占用：小助手可能已在运行（请打开 http://127.0.0.1:${getConfigPort()}/ ）`);
  console.log('[防呆] 本进程退出。如确认无实例在跑，请检查端口占用或修改 data/config.json 的 port。');
  process.exit(2);
}
function getConfigPort(): number {
  try { return JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'config.json'), 'utf-8')).port ?? 17730; }
  catch { return 17730; }
}

// 浏览器检测（splash/控制台展示 + capture fallback 注入）
setBrowserInfo(detectBrowser(ROOT));

const store = new Store(DB_PATH);
const hub = new Hub();
const engine = new Engine(store, {
  onToast: (t) => hub.toast(t.kind, t.data),
  onLog: (m) => hub.log(m),
  onChat: (c) => hub.broadcast({ t: 'chat', data: c }),
});

// token（/agent 鉴权，重启轮换）
fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(AVATAR_DIR, { recursive: true });
const token = crypto.randomBytes(16).toString('hex');
fs.writeFileSync(TOKEN_PATH, token, 'utf-8');

const app = Fastify({ logger: false, bodyLimit: 32 * 1024 * 1024 });
await app.register(websocket);
const UI_DIST = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'ui', 'dist');
if (fs.existsSync(UI_DIST)) {
  await app.register(fastifyStatic, { root: UI_DIST, prefix: '/' });
}

registerAgent(app, engine, hub, token, {
  getResumeUrl: () => getConfig().lastRoomUrl, // 捕获一旦被拉起就恢复上次房间；autostart 只决定 core 启动时是否拉起
});

// /ws：UI/榜单快照通道（此前遗漏注册，导致前端无快照——DOM 验收发现）
app.get('/ws', { websocket: true }, (socket: import('ws').WebSocket) => {
  hub.add(socket);
  socket.send(JSON.stringify({ t: 'hello', role: 'client', at: Date.now() }));
});
registerApi(app, engine, store, hub, {
  onShutdown: () => void shutdown(),
  onStopCapture: () => captureCtl?.stop(),
  // 捕获可能因 autostartCapture=false 尚未创建：进入房间/点“重启捕获”时必须按需拉起，
  // 否则 captureCtl?.start() 是空操作，UI 显示已排队但永远不会连上。
  onStartCapture: () => { ensureCapture(); },
});

// 榜单路由（/board → board.html，vite 多页构建产物）
app.get('/board', async (_req, reply) => {
  try { return reply.sendFile('board.html'); } catch { return reply.code(404).send('board.html 未构建'); }
});
// /api/avatar/:secUid 与静态托管共存时顺序注意：API 注册在前（fastify 路由优先级已保证）

let captureCtl: CaptureCtl | null = null;
function ensureCapture() {
  if (!captureCtl) {
    captureCtl = new CaptureCtl(hub, {
      CORE_WS_URL: `ws://127.0.0.1:${getConfig().port}/agent`,
      AGENT_TOKEN: token,
      CHROME_PROFILE_DIR: PROFILE_DIR,
    }, s => { if (s === 'failed') engine.setCaptureState('failed'); });
  }
  captureCtl.start();
}

// 快照循环（1s）
let shuttingDown = false;
setInterval(() => {
  if (shuttingDown) return; // 关闭中：不要再去碰已关闭的 DB/引擎
  engine.agg.tick(Date.now(), getConfig().cappedThreshold);
  engine.tickSurge(Date.now());
  const rows = engine.snapshot(Date.now(), Math.max(100, getConfig().boardCount));
  const cfg = getConfig();
  // 按展示位切分（并列时 rank<=3 可能超过 3 人，用 rank 过滤会让多出来的人
  // 既不在领奖台也不在列表里而“消失”）
  const podium = rows.slice(0, 3);
  const list = rows.slice(3);
  hub.broadcast({
    t: 'board', at: Date.now(),
    room: {
      webRid: engine.agg.room.webRid, anchor: engine.agg.room.anchor,
      online: engine.agg.room.online, roomTotal: engine.agg.room.roomTotal < 0 ? 0 : engine.agg.room.roomTotal,
      sessionLikes: engine.agg.room.sessionLikes,
      ratePerMin: engine.agg.roomRatePerMin(), peakRate: engine.agg.room.peakRate,
      coverage: Number(engine.agg.coveragePct().toFixed(2)),
    },
    round: {
      idx: engine.roundIdx, startedAt: engine.roundStartedAt,
      endsAt: cfg.roundMinutes > 0 ? engine.roundStartedAt + cfg.roundMinutes * 60_000 : null,
      basis: cfg.rankBasis,
    },
    capture: engine.captureState,
    boardCount: cfg.boardCount,          // 榜单页默认展示条数（展开预览可用 ?max=100 覆盖）
    surgeThreshold: cfg.surgeThreshold,
    surge: engine.activeSurge(),
    podium, list,
    stats: {
      likers: (() => { let n = 0; for (const u of engine.agg.users.values()) if (u.sessionLikes > 0) n++; return n; })(),
      global: store.statsSummary() as any,
    },
    records: engine.records(),
  });
}, 1000);

engine.startTimers();

/** 关闭独立榜单窗口（透明/绿幕 Electron）；只按项目 desktop 路径匹配，绝不误杀其他 Electron 应用 */
function killBoardWindows() {
  const desktopDir = path.resolve(ROOT, 'desktop');
  try {
    // 注意：这里是 PowerShell 字符串 .Contains()，不是正则 —— 反斜杠不要二次转义，
    // 只需要把单引号写成 ''。之前用正则转义导致路径变成 E:\\... 永不匹配。
    const lit = desktopDir.replace(/'/g, "''");
    spawnSync('powershell', ['-NoProfile', '-Command',
      `Get-CimInstance Win32_Process -Filter "name='electron.exe'" | Where-Object { $_.CommandLine -and $_.CommandLine.Contains('${lit}') } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }`],
      { timeout: 12_000 });
  } catch {}
}
/** 兜底清理捕获 Chrome：只杀命令行含本 profile 的进程（captureCtl 进程树结束后仍残留时） */
function killCaptureChrome() {
  try {
    // 用 ASCII 特征匹配，避开中文路径在命令行里的编码差异
    spawnSync('powershell', ['-NoProfile', '-Command',
      `Get-CimInstance Win32_Process -Filter "name='chrome.exe'" | Where-Object { $_.CommandLine -and $_.CommandLine -match '--user-data-dir=.*chrome-profile' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }`],
      { timeout: 12_000 });
  } catch {}
}

async function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log('优雅关闭：结算 → 停捕获 → 关榜单窗口 → 关服务');
  try { engine.shutdown(); } catch (e) { console.error('engine shutdown', e); }
  captureCtl?.stop();
  killCaptureChrome();
  killBoardWindows();
  await agentCtl.shutdown();
  try { store.close(); } catch {}
  // 留一点时间让 /api/shutdown 的响应回到控制台，再退出
  await new Promise(r => setTimeout(r, 300));
  await app.close().catch(() => {});
  process.exit(0);
}
process.on('SIGINT', () => void shutdown());
process.on('SIGTERM', () => void shutdown());

// ── 长跑兜底：异常不致崩（记录后继续；守护链路另由 capture 看护）──
process.on('uncaughtException', e => {
  console.error('[异常兜底] uncaughtException:', e);
  hub.log(`⚠️ 异常兜底：${String(e).slice(0, 200)}`);
});
process.on('unhandledRejection', e => {
  console.error('[异常兜底] unhandledRejection:', e);
});

const cfg0 = loadConfig();
await app.listen({ port: cfg0.port, host: '127.0.0.1' });
console.log(`core 已启动：http://127.0.0.1:${cfg0.port}（控制台）/ board（榜单）`);
hub.log(`core 已启动，端口 ${cfg0.port}`);
if (cfg0.autostartCapture) ensureCapture();
