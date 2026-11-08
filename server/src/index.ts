// ─── core 入口：装配各层 + 启动（docs §1）──────────────────────────
import Fastify from 'fastify';
import websocket from '@fastify/websocket';
import fastifyStatic from '@fastify/static';
import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
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
  onLog: (m) => { console.log(m); hub.log(m); },
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
  getResumeUrl: () => getConfig().autostartCapture ? getConfig().lastRoomUrl : null,
});

// /ws：UI/榜单快照通道（此前遗漏注册，导致前端无快照——DOM 验收发现）
app.get('/ws', { websocket: true }, (socket: import('ws').WebSocket) => {
  hub.add(socket);
  socket.send(JSON.stringify({ t: 'hello', role: 'client', at: Date.now() }));
});
registerApi(app, engine, store, hub, {
  onShutdown: () => void shutdown(),
  onStopCapture: () => captureCtl?.stop(),
  onStartCapture: () => { captureCtl?.start(); },
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
setInterval(() => {
  engine.agg.tick(Date.now(), getConfig().cappedThreshold);
  const rows = engine.snapshot(Date.now());
  const cfg = getConfig();
  const podium = rows.filter(r => r.rank <= 3);
  const list = rows.filter(r => r.rank > 3);
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
    podium, list,
    stats: {
      likers: (() => { let n = 0; for (const u of engine.agg.users.values()) if (u.sessionLikes > 0) n++; return n; })(),
      global: store.statsSummary() as any,
    },
    records: engine.records(),
  });
}, 1000);

engine.startTimers();

let shuttingDown = false;
async function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log('优雅关闭：结算 → 停捕获 → 关服务');
  try { engine.shutdown(); } catch (e) { console.error('engine shutdown', e); }
  captureCtl?.stop();
  await agentCtl.shutdown();
  try { store.close(); } catch {}
  setTimeout(() => process.exit(0), 800);
  await app.close().catch(() => {});
  process.exit(0);
}
process.on('SIGINT', () => void shutdown());
process.on('SIGTERM', () => void shutdown());

const cfg0 = loadConfig();
await app.listen({ port: cfg0.port, host: '127.0.0.1' });
console.log(`core 已启动：http://127.0.0.1:${cfg0.port}（控制台）/ board（榜单）`);
hub.log(`core 已启动，端口 ${cfg0.port}`);
if (cfg0.autostartCapture) ensureCapture();
