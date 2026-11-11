// ─── REST /api/*：控制台后端 ───────────────────────────────────────
import type { FastifyInstance } from 'fastify';
import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { avatarPath } from './avatars.js';
import { agentCtl } from './agent.js';
import type { Engine } from './engine.js';
import type { Store } from './store.js';
import type { Hub } from './hub.js';
import { AVATAR_DIR, getConfig, patchConfig } from './config.js';
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
  app.patch('/api/config', async (req) => {
    const before = getConfig().captureTabs;
    const next = patchConfig((req.body ?? {}) as any);
    // 并发标签数需要新进程才生效：捕获在跑时自动重启一次
    if (next.captureTabs !== before && engine.captureState !== 'disconnected') {
      hub.log(`捕获并发数 → ${next.captureTabs} 路，重启捕获生效…`);
      opts.onStopCapture();
      setTimeout(() => opts.onStartCapture(), 700);
    }
    return next;
  });

  app.get('/api/users', async (req) => {
    const q = req.query as any;
    return store.searchUsers(q.q ?? '', q.sort ?? 'total_likes',
      Math.min(100, Math.max(5, Number(q.limit ?? 30))), Math.max(0, Number(q.offset ?? 0)));
  });

  // 用户库一键清空（保留设置/登录态；红色弹窗 + 倒计时确认由前端把关，服务端二次校验）
  app.post('/api/users/wipe', async (req, reply) => {
    const { confirm } = (req.body ?? {}) as { confirm?: string };
    if (confirm !== 'CLEAR_USERS') return reply.code(400).send({ ok: false, error: '确认词不符（应为 CLEAR_USERS）' });
    let counts;
    try {
      counts = store.wipeUsers();
    } catch (e) {
      return reply.code(500).send({ ok: false, error: `清空失败：${String(e).slice(0, 160)}` });
    }
    // 头像缓存属于用户数据，一并清掉（不影响登录态）
    try { fs.rmSync(AVATAR_DIR, { recursive: true, force: true }); fs.mkdirSync(AVATAR_DIR, { recursive: true }); } catch {}
    const info = engine.wipeUsers();
    hub.log(`🧹 用户库已清空：${counts.users} 位赞友 / ${counts.rounds} 轮 / ${counts.sessions} 场` +
      `${info.room ? `；房间 ${info.room} 已从 0 开新场` : ''}`);
    return { ok: true, ...counts, room: info.room };
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

  // 宝石行配色：null=跟随默认（星守每场随机 / 非星守无宝石），'rainbow'=彩虹流光，#RRGGBB=指定色
  app.patch('/api/user/:secUid/gem', async (req, reply) => {
    const { secUid } = req.params as any;
    const body = (req.body ?? {}) as { color?: string | null };
    const color = body.color === undefined ? undefined : body.color;
    if (color === undefined) return reply.code(400).send({ ok: false, error: '缺少 color（null / rainbow / #RRGGBB）' });
    if (color !== null && color !== 'rainbow' && !/^#[0-9a-fA-F]{6}$/.test(String(color))) {
      return reply.code(400).send({ ok: false, error: '颜色格式应为 #RRGGBB、rainbow 或 null' });
    }
    if (!store.getUser(secUid)) return reply.code(404).send({ ok: false, error: '用户不存在' });
    store.setGemColor(secUid, color);
    engine.refreshStoreInfoFor([secUid]);
    return { ok: true, color };
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
    reply.header('content-disposition', `attachment; filename="likes-stats-export-${new Date().toISOString().slice(0, 10)}.json"`);
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

  // 一键打开桌面榜单窗口（Electron 壳；未安装则提示用 bat/浏览器）
  // mode=chroma：普通窗口 + 纯绿背景，供 OBS/直播伴侣窗口捕获 + Chroma Key
  app.post('/api/board-window', async (req, reply) => {
    const mode = String((req.body as { mode?: string } | null)?.mode ?? 'normal');
    const chroma = mode === 'chroma';
    const exe = path.resolve(here, '..', '..', 'desktop', 'node_modules', 'electron', 'dist', 'electron.exe');
    if (!fs.existsSync(exe)) {
      return reply.code(404).send({ ok: false, error: '桌面窗口未安装（desktop/node_modules/electron 缺失）——可用「打开榜单窗口.bat」/「打开榜单窗口-OBS兼容.bat」或 OBS 浏览器源 /board?transparent=1' });
    }
    const appDir = path.resolve(here, '..', '..', 'desktop');
    const argv = [appDir];
    if (chroma) argv.push('--chroma');
    spawn(exe, argv, { detached: true, stdio: 'ignore', windowsHide: false }).unref();
    return { ok: true, mode: chroma ? 'chroma' : 'normal' };
  });

  // ── 开机自启（HKCU Run 键，无需管理员；指向一键启动.bat）──
  const RUN_KEY = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run';
  const RUN_VALUE = 'LikesStatsAssistant';
  const LEGACY_RUN_VALUES = ['LikeBoard']; // 旧版自启项，开启/关闭时一并清理
  const batPath = path.resolve(here, '..', '..', '一键启动.bat');
  const regHas = (name: string) => {
    try {
      const r = spawnSync('reg', ['query', RUN_KEY, '/v', name], { timeout: 8000, encoding: 'utf-8' });
      return r.status === 0 && (r.stdout ?? '').includes(name);
    } catch { return false; }
  };
  const regQuery = () => regHas(RUN_VALUE) || LEGACY_RUN_VALUES.some(regHas);
  const regDelete = (name: string) => {
    try { spawnSync('reg', ['delete', RUN_KEY, '/v', name, '/f'], { timeout: 8000 }); } catch {}
  };
  app.get('/api/autostart', async () => ({ enabled: regQuery() }));
  app.post('/api/autostart', async (req, reply) => {
    const { enable } = (req.body ?? {}) as { enable?: boolean };
    if (!fs.existsSync(batPath)) return reply.code(404).send({ ok: false, error: '未找到 一键启动.bat' });
    // 有无窗启动器（vbs）则无感启动，否则直接指 bat（会闪一下黑框）
    const vbs = path.resolve(here, '..', '..', 'scripts-silent.vbs');
    const target = fs.existsSync(vbs)
      ? `"wscript.exe" "${vbs}"`
      : `"${batPath}"`;
    for (const legacy of LEGACY_RUN_VALUES) regDelete(legacy);
    if (enable) {
      const r = spawnSync('reg', ['add', RUN_KEY, '/v', RUN_VALUE, '/t', 'REG_SZ', '/d', target, '/f'], { timeout: 8000 });
      if (r.status !== 0) return reply.code(500).send({ ok: false, error: '注册表写入失败' });
    } else {
      regDelete(RUN_VALUE);
    }
    hub.log(enable ? '已开启开机自启' : '已关闭开机自启');
    return { ok: true, enabled: regQuery() };
  });

  app.post('/api/shutdown', async () => {
    hub.log('收到关闭指令，正在优雅退出…');
    // 先让本响应回到控制台（前端据此显示“已关闭”），再开始结算/杀窗口/关服务
    setTimeout(() => opts.onShutdown(), 300);
    return { ok: true };
  });

  // 危险区：清空全部数据（双确认由前端 UI 把关；服务端二次校验）
  // 保留 chrome-profile/（登录态）与 config.json（设置）；删除 db/头像/token
  app.post('/api/data/wipe', async (req, reply) => {
    const { confirm } = (req.body ?? {}) as { confirm?: string };
    if (confirm !== 'DELETE') return reply.code(400).send({ ok: false, error: '确认词不符（应为 DELETE）' });
    try { engine.shutdown(); } catch {}
    const dataDir = path.resolve(here, '..', '..', 'data');
    const rm = (p: string) => { try { fs.rmSync(p, { recursive: true, force: true }); } catch {} };
    rm(path.join(dataDir, 'likes-stats.db'));
    rm(path.join(dataDir, 'likes-stats.db-wal'));
    rm(path.join(dataDir, 'likes-stats.db-shm'));
    rm(path.join(dataDir, 'likeboard.db'));
    rm(path.join(dataDir, 'likeboard.db-wal'));
    rm(path.join(dataDir, 'likeboard.db-shm'));
    rm(path.join(dataDir, 'avatars'));
    rm(path.join(dataDir, 'runtime-token'));
    // config.json 保留：设置属于用户偏好，不应被“清空数据”带走
    hub.log('[危险区] 数据已清空（登录态保留），服务退出…');
    setImmediate(() => { setTimeout(() => process.exit(3), 500); });
    return { ok: true, message: '数据已清空，服务将自动退出——请重新运行 一键启动.bat' };
  });
}
