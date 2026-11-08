// ─── REST /api/*：控制台后端 ───────────────────────────────────────
import type { FastifyInstance } from 'fastify';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { avatarPath } from './avatars.js';
import { agentCtl } from './agent.js';
import type { Engine } from './engine.js';
import type { Store } from './store.js';
import type { Hub } from './hub.js';
import { getConfig, patchConfig } from './config.js';
import { APP_VERSION, APP_AUTHOR, APP_LICENSE, browserInfo } from './version.js';

/** 容错房间 URL → 直播间 URL（支持 web_rid 裸数字 / 完整链接） */
export function normalizeRoomUrl(input: string): string | null {
  const s = input.trim();
  if (!s) return null;
  if (/^\d{6,13}$/.test(s)) return `https://live.douyin.com/${s}`;
  const m = s.match(/live\.douyin\.com\/(\d{6,13})/);
  if (m) return `https://live.douyin.com/${m[1]}`;
  return null;
}

export function registerApi(app: FastifyInstance, engine: Engine, store: Store, hub: Hub,
  opts: { onShutdown: () => void; onStopCapture: () => void; onStartCapture: () => void }) {
  const cfg = () => getConfig();
  const here = path.dirname(fileURLToPath(import.meta.url)); // server/src

  app.get('/api/status', async () => ({
    version: APP_VERSION,
    author: APP_AUTHOR,
    license: APP_LICENSE,
    browser: browserInfo,
    capture: engine.captureState,
    room: {
      webRid: engine.agg.room.webRid, anchor: engine.agg.room.anchor,
      online: engine.agg.room.online, roomTotal: engine.agg.room.roomTotal,
      sessionLikes: engine.agg.room.sessionLikes,
      ratePerMin: engine.agg.roomRatePerMin(), peakRate: engine.agg.room.peakRate,
      coverage: Number(engine.agg.coveragePct().toFixed(2)),
    },
    round: {
      idx: engine.roundIdx, startedAt: engine.roundStartedAt,
      endsAt: cfg().roundMinutes > 0 ? engine.roundStartedAt + cfg().roundMinutes * 60_000 : null,
    },
    session: { id: engine.sessionId, startedAt: engine.sessionStartedAt },
    stats: store.statsSummary(),
    config: cfg(),
    hubClients: hub.size,
    engineUsers: engine.agg.users.size,
  }));

  app.post('/api/watch', async (req, reply) => {
    const { url } = (req.body ?? {}) as { url?: string };
    const norm = normalizeRoomUrl(url ?? '');
    if (!norm) return reply.code(400).send({ ok: false, error: '无法识别房间（支持房间号或 live.douyin.com 链接）' });
    patchConfig({ lastRoomUrl: norm });
    if (agentCtl.senders.size === 0) {
      // 捕获未连接：拉起捕获进程，hello 后按 lastRoomUrl 自动进入（验证 P1-④：不能假成功）
      opts.onStartCapture();
      hub.log(`切换房间：${norm}（捕获进程启动中，接入后自动进入）`);
      return { ok: true, url: norm, queued: true };
    }
    agentCtl.watch(norm);
    hub.log(`切换房间：${norm}`);
    return { ok: true, url: norm };
  });

  app.post('/api/settle', async () => ({ ok: true, result: engine.manualSettle() }));
  app.post('/api/reload', async () => { agentCtl.reload(); return { ok: true }; });

  app.get('/api/config', async () => cfg());
  app.patch('/api/config', async (req) => patchConfig((req.body ?? {}) as any));

  app.get('/api/users', async (req) => {
    const q = req.query as any;
    return store.searchUsers(q.q ?? '', q.sort ?? 'total_likes',
      Math.min(100, Math.max(5, Number(q.limit ?? 30))), Math.max(0, Number(q.offset ?? 0)));
  });

  app.get('/api/user/:secUid', async (req, reply) => {
    const { secUid } = req.params as any;
    const row = store.getUser(secUid);
    if (!row) return reply.code(404).send({ error: 'not found' });
    const live = engine.agg.profileOf(secUid);
    return {
      user: row, nicknames: store.nickHistory(secUid),
      live: live ? { ...live, sessionLikes: engine.agg.users.get(secUid)?.sessionLikes ?? 0 } : null,
    };
  });

  app.get('/api/rounds', async (req) => {
    const q = req.query as any;
    return store.roundsHistory(Math.min(50, Math.max(5, Number(q.limit ?? 20))), Math.max(0, Number(q.offset ?? 0)));
  });
  app.get('/api/rounds/:id', async (req, reply) => {
    const d = store.roundDetail(Number((req.params as any).id));
    if (!d) return reply.code(404).send({ error: 'not found' });
    return d;
  });

  app.get('/api/export', async (_req, reply) => {
    reply.header('content-type', 'application/json; charset=utf-8');
    reply.header('content-disposition', `attachment; filename="likeboard-export-${new Date().toISOString().slice(0, 10)}.json"`);
    return store.exportAll();
  });

  app.get('/api/avatar/:secUid', async (req, reply) => {
    const secUid = String((req.params as any).secUid ?? '');
    const p = avatarPath(secUid);
    try {
      const buf = fs.readFileSync(p);
      reply.header('content-type', 'image/jpeg');
      reply.header('cache-control', 'public, max-age=300');
      return buf;
    } catch {
      // 未缓存/下载失败：返回确定性渐变占位 SVG（200，避免前端 404 噪音）
      let h = 0; for (const c of secUid) h = (h * 31 + c.charCodeAt(0)) % 360;
      reply.header('content-type', 'image/svg+xml');
      reply.header('cache-control', 'public, max-age=60');
      reply.send(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="hsl(${h},55%,38%)"/><stop offset="1" stop-color="hsl(${(h + 60) % 360},55%,26%)"/></linearGradient></defs><rect width="64" height="64" fill="url(#g)"/><text x="32" y="41" text-anchor="middle" font-size="28" fill="rgba(255,255,255,.85)" font-family="sans-serif">赞</text></svg>`);
    }
  });

  app.post('/api/capture/start', async () => { opts.onStartCapture(); return { ok: true }; });
  app.post('/api/capture/stop', async () => { opts.onStopCapture(); return { ok: true }; });

  // 一键打开桌面透明榜单窗口（Electron 壳；未安装则提示用 bat/浏览器）
  app.post('/api/board-window', async (_req, reply) => {
    const exe = path.resolve(here, '..', '..', 'desktop', 'node_modules', 'electron', 'dist', 'electron.exe');
    if (!fs.existsSync(exe)) {
      return reply.code(404).send({ ok: false, error: '桌面窗口未安装（desktop/node_modules/electron 缺失）——可用「打开榜单窗口.bat」或浏览器 /board' });
    }
    spawn(exe, [path.resolve(here, '..', '..', 'desktop')], { detached: true, stdio: 'ignore', windowsHide: false }).unref();
    return { ok: true };
  });

  app.post('/api/shutdown', async () => {
    hub.log('收到关闭指令，正在优雅退出…');
    setImmediate(() => opts.onShutdown());
    return { ok: true };
  });

  // 危险区：清空全部数据（双确认由前端 UI 把关；服务端二次校验）
  // 保留 chrome-profile/（登录态，重新积累成本高）；删除 db/头像/token/配置
  app.post('/api/data/wipe', async (req, reply) => {
    const { confirm } = (req.body ?? {}) as { confirm?: string };
    if (confirm !== 'DELETE') return reply.code(400).send({ ok: false, error: '确认词不符（应为 DELETE）' });
    try { engine.shutdown(); } catch {}
    const dataDir = path.resolve(here, '..', '..', 'data');
    const rm = (p: string) => { try { fs.rmSync(p, { recursive: true, force: true }); } catch {} };
    rm(path.join(dataDir, 'likeboard.db'));
    rm(path.join(dataDir, 'likeboard.db-wal'));
    rm(path.join(dataDir, 'likeboard.db-shm'));
    rm(path.join(dataDir, 'avatars'));
    rm(path.join(dataDir, 'runtime-token'));
    rm(path.join(dataDir, 'config.json'));
    hub.log('[危险区] 数据已清空（登录态保留），服务退出…');
    setImmediate(() => { setTimeout(() => process.exit(3), 500); });
    return { ok: true, message: '数据已清空，服务将自动退出——请重新运行 一键启动.bat' };
  });
}
