// ─── 捕获子进程：patchright 有头 Chrome 被动旁听（docs §1/§4/§5）───
// 职责：打开直播间页面 → 收 WS 帧 → 解码 Like/Member/Chat → 200ms 批量上报
//      core（档案分离协议）+ 房间状态机（换房/下播/风控检测）。
// 纯被动：从不向 WS 发帧、不调业务接口、无登录要求。
// 长跑自愈（v0.1.1）：WS 静默看门狗（刷新→重建递进）+ core 看护（互为守护）。
// 实验性功能（v0.3.0，默认全关；见 docs/开发策划书-实验性功能-2026-11-18.md）：
//  - EXP-2 fetchBackfill：被动旁听页面自发的 /webcast/im/fetch 响应（进房补帧）；
//  - EXP-3 set-tabs：core 运行时增减采集标签（不重启进程）；
//  - EXP-4 dualBufferRoom：换房两阶段导航 + 旧标签保留旧房推送 + 启动预开标签。

import { chromium, type Page } from 'patchright';
import WebSocket from 'ws';
import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { decodePushFrame } from '../pb.js';
import { parseChat, parseLike, parseMember, parseRoomStats, parseRoomUserSeq, type UserProfile } from '../messages.js';
import { decodeImFetchBody } from './backfill.js';
import { planGoto } from '../experiments.js';

const CORE_WS = process.env.CORE_WS_URL ?? 'ws://127.0.0.1:17730/agent';
const TOKEN = process.env.AGENT_TOKEN ?? '';
const PROFILE_DIR = process.env.CHROME_PROFILE_DIR ?? path.resolve('data', 'chrome-profile');
const HERE = path.dirname(fileURLToPath(import.meta.url));       // server/src/capture
const SERVER_DIR = path.resolve(HERE, '..', '..');               // server/
const CORE_ENTRY = path.resolve(HERE, '..', 'index.ts');
// 多路采集：抖音对点赞广播流是抽样下发（实测单连接 coverage 仅 3~8 成），
// N 个并发标签各自独立抽样，core 按 msgId 去重合并 → 覆盖率指数提升。
// v0.3.0：curTabs 可由 core 的 set-tabs 指令运行时调整（EXP-3，上限仍 4）。
const BASE_TABS = Math.max(1, Math.min(4, Number(process.env.CAPTURE_TABS ?? 2)));
let curTabs = BASE_TABS;

// ── 实验开关（EXP_FLAGS env 初始化；core 可经 exp-flags 指令热更新）──
// totalAuthoritative 是 core/前端层实验，捕获进程不参与。
interface CaptureExpFlags { fetchBackfill: boolean; adaptiveTabs: boolean; dualBufferRoom: boolean }
let expFlags: CaptureExpFlags = { fetchBackfill: false, adaptiveTabs: false, dualBufferRoom: false };
try {
  const j = JSON.parse(process.env.EXP_FLAGS ?? '{}');
  for (const k of Object.keys(expFlags) as (keyof CaptureExpFlags)[]) {
    if (typeof j[k] === 'boolean') expFlags[k] = j[k];
  }
} catch { /* 坏 env 忽略，默认全关 */ }

// ── 上报状态 ──
interface ProfileEntry { nick: string; avatar: string | null; starGuard: boolean; dirty: boolean }
const profiles = new Map<string, ProfileEntry>();   // secUid → 档案（变化才上报）
let likeBatch: { i: string; c: number; u: string; t: number; r?: string; bf?: number }[] = [];
let profileBatch: { u: string; nick: string; av: string | null; sg: boolean }[] = [];
let lastRoomSent = '';
let lastOnlineSent = 0;
let ws: WebSocket | null = null;
let shuttingDown = false;
let wsConnectedAt = 0;          // 最近一次与 core 建连时刻（看护用）

const log = (...a: unknown[]) => console.log(new Date().toISOString().slice(11, 19), ...a);
const expSend = (key: string, fields: Record<string, unknown>) =>
  send({ t: 'exp-metrics', key, ...fields });

function connectCore() {
  if (shuttingDown) return;
  const sock = new WebSocket(`${CORE_WS}?token=${encodeURIComponent(TOKEN)}`, { handshakeTimeout: 5000 });
  ws = sock;
  sock.on('open', () => {
    log('已连接 core');
    wsConnectedAt = Date.now();
    sock.send(JSON.stringify({ t: 'hello', ver: 1 }));
  });
  sock.on('message', raw => {
    let m: any; try { m = JSON.parse(raw.toString()); } catch { return; }
    if (m.t === 'watch' && m.url) void enqueue(() => watchRoom(String(m.url)));
    else if (m.t === 'reload') void enqueue(() => reloadRoom());
    else if (m.t === 'exp-flags' && m.flags) applyExpFlags(m.flags);
    else if (m.t === 'set-tabs') void enqueue(() => setTabs(Number(m.n)));
    else if (m.t === 'shutdown') { log('收到 shutdown'); void gracefulExit(); }
  });
  sock.on('close', () => {
    ws = null;
    if (!shuttingDown) { log('与 core 断开，3s 后重连'); setTimeout(connectCore, 3000); }
  });
  sock.on('error', () => { try { sock.terminate(); } catch {} });
}

/** 实验开关热更新（不重启进程） */
function applyExpFlags(f: Record<string, unknown>) {
  const before = { ...expFlags };
  for (const k of Object.keys(expFlags) as (keyof CaptureExpFlags)[]) {
    if (typeof f[k] === 'boolean') expFlags[k] = f[k] as boolean;
  }
  const changed = (Object.keys(expFlags) as (keyof CaptureExpFlags)[]).filter(k => expFlags[k] !== before[k]);
  if (changed.length) log(`实验开关更新：${changed.map(k => `${k}=${expFlags[k]}`).join(' ')}`);
}

// ── 指令串行化：watch / reload / set-tabs / relaunch 的导航操作互斥，
//    杜绝并发补页/导航/关页对 roomPages 的竞态（核查 D-4 修正）──
let opChain: Promise<void> = Promise.resolve();
function enqueue<T>(fn: () => Promise<T>): Promise<T> {
  const run = opChain.then(fn, fn);
  opChain = run.then(() => {}, () => {});
  return run;
}

// ── core 看护（互为守护闭环）：core 异常退出 → 本进程拉起 core ──
let coreRestarts: number[] = [];
let coreWatchdog = setInterval(() => {
  if (shuttingDown) return;
  // 已连接 → 正常
  if (ws && ws.readyState === WebSocket.OPEN) return;
  // 冷启动/断连宽限 90s（重连循环 connectCore 每 3s 自跑），仍无连接才判死
  if (!wsConnectedAt || Date.now() - wsConnectedAt < 90_000) return;
  const now = Date.now();
  coreRestarts = coreRestarts.filter(t => now - t < 30 * 60_000);
  if (coreRestarts.length >= 5) { log('core 重启超限（30min/5 次），停止看护，等待人工排查'); clearInterval(coreWatchdog); return; }
  coreRestarts.push(now);
  log(`core 已 90s 无法连上（疑似崩溃）→ 自动拉起 core（第 ${coreRestarts.length} 次/30min）`);
  try {
    const logFd = fs.openSync(path.resolve(SERVER_DIR, '..', 'data', 'core.log'), 'a');
    const child = spawn(process.execPath, ['--import', 'tsx', CORE_ENTRY], {
      cwd: SERVER_DIR, env: process.env, detached: true,
      stdio: ['ignore', logFd, logFd], windowsHide: true,
    });
    child.unref();
    fs.closeSync(logFd);
  } catch (e) { log('拉起 core 失败', e); }
}, 15_000);

// ── 长跑兜底 ──
process.on('uncaughtException', e => console.error('[capture 异常兜底]', e));
process.on('unhandledRejection', e => console.error('[capture Promise兜底]', e));
const send = (o: unknown) => { try { if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(o)); } catch {} };

function noteProfile(u: UserProfile | null) {
  if (!u?.secUid) return;
  const cur = profiles.get(u.secUid);
  if (!cur) profiles.set(u.secUid, { nick: u.nick, avatar: u.avatar, starGuard: u.starGuard, dirty: true });
  else {
    let dirty = false;
    if (u.nick && u.nick !== cur.nick) { cur.nick = u.nick; dirty = true; }
    if (u.avatar && u.avatar !== cur.avatar) { cur.avatar = u.avatar; dirty = true; }
    if (u.starGuard && !cur.starGuard) { cur.starGuard = true; dirty = true; }
    if (dirty) cur.dirty = true;
  }
}

// ── Chrome ──
let ctx: Awaited<ReturnType<typeof chromium.launchPersistentContext>> | null = null;
let roomPages: Page[] = [];        // 多路采集标签（首个为监视基准页）
let currentRoomUrl = '';
let lastStatusSent = '';
let loggedIn = false;

// 每页当前所在房间（framenavigated 维护；消息按页携带房间归属 r）
const pageWebRid = new WeakMap<Page, string>();
function updatePageWebRid(page: Page, url: string) {
  const m = url.match(/live\.douyin\.com\/(\d{6,13})/);
  pageWebRid.set(page, m ? m[1] : '');
}

const sendStatus = (state: string, reason?: string) => {
  if (state !== lastStatusSent || state === 'offline' || state === 'risk') {
    lastStatusSent = state;
    send({ t: 'status', state, reason });
  }
};

let launchPromise: Promise<void> | null = null;

/** 单飞：core 的 watch 与启动流程可能同时调用，绝不能让两个 launch 互相清理 */
async function ensureBrowser(): Promise<void> {
  if (ctx) return;
  if (!launchPromise) {
    launchPromise = launchBrowser().finally(() => { launchPromise = null; });
  }
  await launchPromise;
}

async function launchBrowser() {
  fs.mkdirSync(PROFILE_DIR, { recursive: true });
  // profile 被上一轮残留 Chrome 占用时，launchPersistentContext 会直接报
  // “已在现有的浏览器会话中打开”；先按 profile 精确清理，避免首启就进入重启循环。
  killStaleChrome();
  // 防呆：系统 Chrome 存在 → channel:'chrome'（实测最佳完整度）；
  // 缺失 → CAPTURE_FORCE_CHANNEL=bundled 走内置 Chromium（便携包 blank 机兜底，完整度可能略低）
  const useBundled = process.env.CAPTURE_FORCE_CHANNEL === 'bundled';
  const myCtx = await chromium.launchPersistentContext(PROFILE_DIR, {
    ...(useBundled ? {} : { channel: 'chrome' }),
    headless: false,                       // 有头必须：headless 无 WS 推送（实测）
    viewport: null,                        // 真实窗口（固定视口在最大化时布局错乱，实测）
    args: [
      '--mute-audio',
      '--window-size=520,860',
      '--window-position=60,60',
      '--lang=zh-CN',
    ],
  });
  ctx = myCtx;
  try {
    const cookies = await myCtx.cookies('https://live.douyin.com');
    loggedIn = cookies.some(c => ['sessionid', 'sessionid_ss', 'passport_csrf_token'].includes(c.name));
    log(`登录态：${loggedIn ? '已登录' : '匿名'}（cookies=${cookies.length}）`);
  } catch { log('登录态检测失败（按匿名处理）'); }
  roomPages = myCtx.pages().length ? myCtx.pages().slice(0, 1) : [await myCtx.newPage()];
  wirePage(roomPages[0]);
  for (const p of roomPages) updatePageWebRid(p, p.url());
  myCtx.on('page', p => { wirePage(p); });   // 用户/抖音自行开的标签也纳入监听
  myCtx.on('close', () => {
    // 关键：旧上下文的 close 不能触发新一轮重启。relaunch 会先置空 ctx 再 close 旧上下文，
    // 若这里不比较引用，就会形成“close→8s 后 relaunch→close 新上下文”的无限重启循环。
    if (ctx !== myCtx) return;
    ctx = null;
    if (!shuttingDown) {
      log('浏览器被关闭，8s 后重启');
      scheduleRelaunch(8000);
    }
  });
  // EXP-4：预开标签（仅实验开启时；空白页对状态机无影响——roomMonitor 只看首页）
  if (expFlags.dualBufferRoom && roomPages.length < curTabs) {
    while (roomPages.length < curTabs) {
      const extra = await myCtx.newPage().catch(() => null);
      if (!extra) break;
      roomPages.push(extra);   // wirePage 由 on('page') 自动完成
      updatePageWebRid(extra, 'about:blank');
    }
    log(`[实验:换房] 双缓冲预开 ${roomPages.length} 个标签`);
    expSend('dualBufferRoom', { ev: 'preopen-tabs', n: roomPages.length });
  }
  log(`Chrome 已启动（捕获窗口，采集路数=${curTabs}）`);
}

let relaunchTimes: number[] = [];
let relaunching = false;
let relaunchTimer: ReturnType<typeof setTimeout> | null = null;
function scheduleRelaunch(ms: number) {
  if (shuttingDown || relaunchTimer) return;
  relaunchTimer = setTimeout(() => { relaunchTimer = null; void relaunch(); }, ms);
}
/** 清理残留的捕获 Chrome（只杀命令行含本 profile 目录的进程，绝不误伤用户自己的浏览器） */
function killStaleChrome() {
  try {
    const esc = PROFILE_DIR.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/'/g, "''");
    spawnSync('powershell', ['-NoProfile', '-Command',
      `Get-CimInstance Win32_Process -Filter "name='chrome.exe'" | Where-Object { $_.CommandLine -match '${esc}' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }`],
      { timeout: 15_000 });
    log('已清理残留捕获 Chrome（仅限本 profile）');
  } catch {}
}
async function relaunch() {
  if (shuttingDown || relaunching) return;
  const now = Date.now();
  relaunchTimes = relaunchTimes.filter(t => now - t < 600_000);
  if (relaunchTimes.length >= 6) { log('浏览器重启超限，报告 failed'); sendStatus('failed', 'browser-relaunch-limit'); return; }
  relaunchTimes.push(now);
  relaunching = true;
  try {
    const old = ctx;
    ctx = null;                              // 先置空，旧上下文的 close 事件不再触发重启
    try { await old?.close(); } catch {}
    await ensureBrowser();
    if (currentRoomUrl) await enqueue(() => gotoRoom(currentRoomUrl, 'relaunch'));
  } catch (e) {
    log('浏览器重启失败', e);
    killStaleChrome();                       // profile 被残留进程占用时的防呆清理
    scheduleRelaunch(15_000);
  } finally {
    relaunching = false;
  }
}

// ── 页面接线：WeakSet 防双注册（v0.3.0 修复：newPage() 既触发 ctx.on('page')
//    又被 gotoRoom 手动 wire，历史上每帧解码两次，全靠 core msgId 去重兜底）──
const wiredPages = new WeakSet<Page>();
function wirePage(page: Page) {
  if (wiredPages.has(page)) return;
  wiredPages.add(page);
  // 导航诊断：被踢/换房/登录重定向都从这里留下证据；同时维护消息归属 webRid
  page.on('framenavigated', frame => {
    if (frame !== page.mainFrame()) return;
    log('页面导航 →', frame.url().slice(0, 140));
    updatePageWebRid(page, frame.url());
  });
  // HTTP 侧：房间 enter/info 接口响应里有稳定的主播名（实测结构 data.room.data.owner）
  page.on('response', async res => {
    try {
      const u = res.url();
      // EXP-2 进房补帧：页面自发请求的 /webcast/im/fetch（need_persist_msg_count），
      // 响应含最近 15 条持久化消息——零额外请求的官方补帧（报告 B 4.2-2）
      if (expFlags.fetchBackfill && u.includes('/webcast/im/fetch')) {
        void handleImFetchResponse(res, page);
        return;
      }
      if (!/live\.douyin\.com\/webcast\/room\//.test(u) || !/info|enter/.test(u)) return;
      const json = await res.json();
      const room = json?.data?.room?.data ?? json?.data?.room ?? json?.data;
      const owner = room?.owner ?? room?.owner_info;
      const nick = owner?.nickname || owner?.nick_name || room?.anchor_name;
      if (nick) { pendingAnchor = String(nick).slice(0, 20); lastUrl = ''; /* 触发下次 sendRoom */ }
    } catch { /* 非业务响应忽略 */ }
  });
  page.on('websocket', ws_ => {
    ws_.on('framereceived', frame => {
      try {
        const p = frame.payload;
        const buf = Buffer.isBuffer(p) ? p : Buffer.from(String(p));
        lastFrameAt = Date.now();                 // 任何帧（含心跳 "hi"）都是生命迹象
        // EXP-4：双缓冲切换期旧房保留帧计数（平滑度证据；这些帧经 r 归属被 core 拦截不入账）
        if (dualSwitchActive && pageWebRid.get(page) && pageWebRid.get(page) !== switchTargetRid) keptFrames++;
        if (buf.length < 8) return;               // 心跳 "hi" 等
        const msgs = decodePushFrame(buf);
        if (!msgs) return;
        for (const m of msgs) handleMsg(m.method, m.payload, page);
      } catch { /* 帧解码失败忽略 */ }
    });
  });
}

// ── EXP-2：im/fetch 补帧 ──
let bfPending: { i: string; c: number; u: string; t: number; r: string; bf: 1 }[] = [];
const bfStats = { decoded: 0, failed: 0 };        // 周期计数（30s 上报后清零）
/** core 已确认会话的房间（roomMonitor 换房识别 sendRoom 后记录）——补帧只在该房间就绪后放行，
 *  保证 core 先切会话、补帧后入账（避免计入旧场或被 !sessionId 丢弃，核查 B-3/E-1） */
let announcedWebRid = '';

async function handleImFetchResponse(res: { body: () => Promise<Buffer> }, page: Page) {
  let body: Buffer | null = null;
  try { body = await res.body(); }
  catch (e) { bfStats.failed++; log('[实验:补帧] im/fetch body 读取失败（页面销毁/detach）', String(e).slice(0, 80)); return; }
  const r = decodeImFetchBody(body);
  if (r.format === 'empty') {
    bfStats.failed++;
    log(`[实验:补帧] im/fetch 解码失败：${r.note ?? '未知'}（len=${body?.length ?? 0}）`);
    return;
  }
  if (!r.msgs.length) return;
  bfStats.decoded += r.msgs.length;
  const webRid = pageWebRid.get(page) ?? '';
  let likes = 0, members = 0;
  for (const m of r.msgs) {
    if (m.method === 'WebcastLikeMessage') {
      const like = parseLike(m.payload);
      if (!like || !like.count) continue;
      // total 是进房前历史值：core 侧 src='bf' 不会用它锚定基线，仅做兜底去重键
      bfPending.push({ i: like.msgId, c: like.count, u: like.secUid, t: like.total, r: webRid, bf: 1 });
      noteProfile({ secUid: like.secUid, nick: like.nick, avatar: like.avatar, starGuard: like.starGuard });
      likes++;
    } else if (m.method === 'WebcastMemberMessage') {
      const mem = parseMember(m.payload);
      if (mem.user) { noteProfile(mem.user); members++; }
    } else if (m.method === 'WebcastChatMessage') {
      const chat = parseChat(m.payload);
      if (chat.user) noteProfile(chat.user);
    }
  }
  maybeFirstData(webRid);
  log(`[实验:补帧] im/fetch ${r.format} 解码 ${r.msgs.length} 条（点赞 ${likes} / 进场 ${members}），待会话就绪后入账`);
  if (bfPending.length > 500) bfPending.splice(0, bfPending.length - 500);  // 换房途中滞留防泄漏
}

// ── EXP-4：换房打点状态 ──
let switchTargetRid = '';       // 本次换房目标房间
let switchT0 = 0;               // 换房开始时刻
let firstDataRid = '';          // 已打 first-data 的房间（每房一次）
let dualSwitchActive = false;   // 双缓冲切换进行中（旧房保留帧计数窗口）
let keptFrames = 0;             // 本次切换期间旧房保留帧数

function maybeFirstData(rid: string | undefined) {
  if (!expFlags.dualBufferRoom || !rid || !switchT0 || rid !== switchTargetRid || firstDataRid === rid) return;
  firstDataRid = rid;
  expSend('dualBufferRoom', { ev: 'first-data', ms: Date.now() - switchT0 });
}

// ── EXP-3：多路 msgId 重叠率采样（判定"并集>单路"假设真伪的最直接指标）──
const overlapSeen = new Map<string, number | 'dup'>();   // msgId → 首见页下标或 'dup'（LRU 5000）
function noteOverlap(msgId: string, page: Page) {
  if (!msgId || msgId === '0') return;
  const prev = overlapSeen.get(msgId);
  if (prev === undefined) {
    overlapSeen.set(msgId, roomPages.indexOf(page));
    if (overlapSeen.size > 5000) overlapSeen.delete(overlapSeen.keys().next().value as string);
  } else if (prev !== 'dup') {
    overlapSeen.set(msgId, 'dup');
  }
}

// ── WS 静默看门狗（长跑自愈）：断网/睡眠唤醒/页面假死 → 刷新 → 重建 ──
let lastFrameAt = Date.now();
let wdReloads = 0;
setInterval(() => {
  if (shuttingDown || !ctx) return;
  if (!/live\.douyin\.com\/\d{6,13}/.test(lastUrl)) return;   // 只看在房状态
  const silentMs = Date.now() - lastFrameAt;
  if (silentMs < 60_000) { wdReloads = 0; return; }
  lastFrameAt = Date.now();
  if (silentMs > 180_000 || wdReloads >= 3) {
    log(`WS 静默 ${Math.round(silentMs / 1000)}s 且刷新无效 → 重建浏览器（断网/睡眠自愈）`);
    wdReloads = 0;
    void relaunch();
  } else {
    wdReloads++;
    log(`WS 静默 ${Math.round(silentMs / 1000)}s → 刷新页面自愈 (#${wdReloads})`);
    void enqueue(() => reloadRoom());
  }
}, 20_000);

function handleMsg(method: string, payload: Buffer, page?: Page) {
  if (method === 'WebcastLikeMessage') {
    const like = parseLike(payload);
    if (!like || !like.count) return;
    if (page) noteOverlap(like.msgId, page);
    const rid = page ? pageWebRid.get(page) : undefined;
    maybeFirstData(rid);
    // 消息房间归属：任一相关实验开启时携带 r，core 校验归属（防跨房污染；全关时不携带，报文与旧版一致）
    const tagOn = expFlags.fetchBackfill || expFlags.dualBufferRoom;
    likeBatch.push(tagOn && rid
      ? { i: like.msgId, c: like.count, u: like.secUid, t: like.total, r: rid }
      : { i: like.msgId, c: like.count, u: like.secUid, t: like.total });
    noteProfile({ secUid: like.secUid, nick: like.nick, avatar: like.avatar, starGuard: like.starGuard });
  } else if (method === 'WebcastMemberMessage') {
    const mem = parseMember(payload);
    if (mem.user) noteProfile(mem.user);
    if (mem.online > 0) lastOnlineSent = mem.online;
  } else if (method === 'WebcastRoomUserSeqMessage') {
    // 进房初期就能拿到在线人数，不必等第一个进场/点赞消息
    const { online } = parseRoomUserSeq(payload);
    if (online > 0 && online !== lastOnlineSent) { lastOnlineSent = online; sendRoom(false); }
  } else if (method === 'WebcastRoomStatsMessage') {
    const { online } = parseRoomStats(payload);
    if (online > 0 && online !== lastOnlineSent) { lastOnlineSent = online; sendRoom(false); }
  } else if (method === 'WebcastChatMessage') {
    const chat = parseChat(payload);
    if (chat.user) noteProfile(chat.user);       // 弹幕用户昵称未打码概率高，优质档案源
  }
}

async function gotoRoom(url: string, via: 'watch' | 'relaunch' = 'watch') {
  if (!ctx) return;
  // 首路：主导航；其余路：补齐标签后同址导航
  while (roomPages.length < curTabs) {
    const extra = await ctx.newPage().catch(() => null);
    if (!extra) break;
    roomPages.push(extra);   // wirePage 由 ctx.on('page') 自动完成
  }
  // 双缓冲计划（纯函数，可测）：flag 关 = 并行导航（现状）；开 = 两阶段串行
  const dual = planGoto(expFlags.dualBufferRoom, roomPages.length) === 'serial';
  const m = url.match(/live\.douyin\.com\/(\d{6,13})/);
  switchTargetRid = m ? m[1] : '';
  switchT0 = dual ? Date.now() : switchT0;
  log(`进入房间 ${url}（${curTabs} 路${dual ? ' · 双缓冲两阶段' : ''}）`);
  if (dual) {
    // EXP-4：阶段 A 首路先走，期间其余页保持旧房推送（旧房数据连续）；
    // 阶段 B 其余页再切。旧房页消息经 r 归属由 core 拦截，不会污染新房会话。
    dualSwitchActive = true; keptFrames = 0;
    expSend('dualBufferRoom', { ev: 'switch-start', via });
    await roomPages[0].goto(url, { waitUntil: 'domcontentloaded', timeout: 45_000 })
      .catch(e => log(`goto[tab0]`, String(e).slice(0, 100)));
    expSend('dualBufferRoom', { ev: 'phase-a-done', ms: Date.now() - switchT0 });
    await Promise.all(roomPages.slice(1).map(p =>
      p.goto(url, { waitUntil: 'domcontentloaded', timeout: 45_000 })
        .catch(e => log(`goto[tab${roomPages.indexOf(p)}]`, String(e).slice(0, 100)))));
    dualSwitchActive = false;
    expSend('dualBufferRoom', { ev: 'phase-b-done', ms: Date.now() - switchT0, totalMs: Date.now() - switchT0, keptFrames });
  } else {
    await Promise.all(roomPages.map((p, i) =>
      p.goto(url, { waitUntil: 'domcontentloaded', timeout: 45_000 })
        .catch(e => log(`goto[tab${i}]`, String(e).slice(0, 100)))));
  }
  await detectAnchor().catch(() => {});
}

async function watchRoom(url: string) {
  currentRoomUrl = url;
  if (!ctx) await ensureBrowser().catch(async e => { log('launch fail', e); await relaunch(); });
  await gotoRoom(url, 'watch');
}

/** EXP-3：core 指令运行时调整采集路数（1~4；ack 回执） */
async function setTabs(n: number) {
  n = Math.max(1, Math.min(4, Math.floor(n)));
  if (!ctx || !currentRoomUrl || !/live\.douyin\.com\/\d{6,13}/.test(currentRoomUrl)) {
    // 未进房/浏览器不在：只记账，下次 gotoRoom 自然按 curTabs 补齐
    curTabs = n;
    log(`[实验:并发] 采集路数 → ${n}（未在房，仅记账）`);
    send({ t: 'tabs-ack', n });
    return;
  }
  if (n > curTabs) {
    while (roomPages.length < n) {
      const extra = await ctx.newPage().catch(() => null);
      if (!extra) break;
      roomPages.push(extra);
    }
    await Promise.all(roomPages.slice(curTabs).map(p =>
      p.goto(currentRoomUrl, { waitUntil: 'domcontentloaded', timeout: 45_000 }).catch(() => {})));
  } else if (n < curTabs) {
    const drop = roomPages.splice(n);   // 保留 roomPages[0..n)
    for (const p of drop) await p.close().catch(() => {});
  }
  curTabs = n;
  log(`[实验:并发] 采集路数 → ${n}`);
  send({ t: 'tabs-ack', n });
}

async function reloadRoom() {
  await Promise.all(roomPages.map(p =>
    p.reload({ waitUntil: 'domcontentloaded', timeout: 45_000 }).catch(() => {})));
}

let lastUrl = '';
async function detectAnchor(): Promise<void> {
  const base = roomPages[0];
  if (!base) return;
  const anchor = await base.evaluate(() => {
    // DOM 兜底只用精确来源（h1/模糊类名会命中快捷键提示条等垃圾文本，实测教训）
    const sels = ['[data-e2e="anchor-name"]', '[class*=CsUBJdAJ]'];
    for (const s of sels) {
      const el = document.querySelector(s);
      const t = (el?.textContent ?? '').trim();
      if (t && t.length <= 24) return t.replace(/[0-9.]+万?本场点赞.*$/, '').replace(/\s+/g, '').slice(0, 20);
    }
    return '';
  }).catch(() => '');
  if (anchor) pendingAnchor = anchor;
}
let pendingAnchor = '';
let lastLikeTotal = 0;

/** 页面头部「4001本场点赞」：进房后几秒即可拿到房间累计赞，作为 room 首帧上报。
 *  只在没有点赞消息之前使用；真实 total 会由 LikeMessage 接管。 */
async function detectRoomStats(): Promise<number> {
  const base = roomPages[0];
  if (!base) return 0;
  const total = await base.evaluate(() => {
    const text = document.body.innerText;
    const m = text.match(/([0-9]+(?:\.[0-9]+)?)(万?)\s*本场点赞/);
    if (!m) return 0;
    return Math.round(Number(m[1]) * (m[2] === '万' ? 10000 : 1));
  }).catch(() => 0);
  if (total > 0 && total !== lastLikeTotal) { lastLikeTotal = total; sendRoom(false); }
  return total;
}

/** 2s 房间状态机：URL 变化=换房；jingxuan 重定向=下播；verify=风控 */
let anchorRetries = 0;
let statsRetries = 0;
async function roomMonitor() {
  const base = roomPages[0];
  if (!base || !ctx) return;
  const url = base.url();
  if (url === lastUrl) {
    // 同房间：周期性上报 room 心跳（含 anchor/online）
    if (currentRoomUrl) sendRoom(false);
    // 主播名重试：进房后前 ~20s 每 2s 试一次 DOM（接口未命中时的兜底）
    if (anchorRetries >= 0 && anchorRetries < 10 && !pendingAnchor) {
      anchorRetries++;
      if (!pendingAnchor) await detectAnchor().catch(() => {});
    }
    if (lastLikeTotal <= 0 && statsRetries < 10) {
      statsRetries++;
      await detectRoomStats().catch(() => {});
    }
    return;
  }
  lastUrl = url;
  if (/live\.douyin\.com\/(\d{6,13})/.test(url)) {
    log('房间页面', url);
    sendStatus('watching');   // 已进房即“监听中”，不必等第一条点赞（安静房间否则永远显示启动中）
    lastLikeTotal = 0; statsRetries = 0;
    sendRoom(true);
    announcedWebRid = url.match(/live\.douyin\.com\/(\d{6,13})/)![1];   // core 会话已就绪 → 补帧放行
    anchorRetries = 0;   // 主播名异步重试（进房瞬间元素未渲染，实测需等 2~6s）
    await detectAnchor().catch(() => {});
    await detectRoomStats().catch(() => {});
  } else if (/jingxuan|\/select/.test(url)) {
    log('检测到下播（重定向精选页）');
    sendStatus('offline', 'redirected-to-jingxuan');
    currentRoomUrl = '';
  } else if (/verify|captcha|challenge/.test(url)) {
    log('检测到验证页', url.slice(0, 140));
    sendStatus('risk', 'verify-page');
  } else if (/passport|login|sso/.test(url)) {
    log('检测到登录页', url.slice(0, 140));
    sendStatus('risk', 'login-required');
  } else if (url === 'about:blank' || url === '') {
    sendStatus('starting');
  } else if (/^https?:\/\/live\.douyin\.com\/?($|[?#])/.test(url)) {
    // 被重定向回首页：匿名观看受限、下播、或风控；下一步刷新会自动重试
    log(`直播间被重定向回首页（${loggedIn ? '已登录' : '匿名'}）`);
    sendStatus(loggedIn ? 'starting' : 'risk', loggedIn ? 'redirected-home' : 'login-required');
  } else {
    log('未识别页面', url.slice(0, 140));
  }
}

let lastOnlineReported = -1;
let lastLikeTotalReported = 0;
function sendRoom(force: boolean) {
  const m = lastUrl.match(/live\.douyin\.com\/(\d{6,13})/);
  if (!m) return;
  const webRid = m[1];
  // 强制/换房/有新主播名/在线人数变化/房间累计赞首帧变化 时上报
  if (!force && webRid === lastRoomSent && !pendingAnchor
      && lastOnlineSent === lastOnlineReported && lastLikeTotal === lastLikeTotalReported) return;
  lastRoomSent = webRid;
  lastOnlineReported = lastOnlineSent;
  lastLikeTotalReported = lastLikeTotal;
  const anchor = pendingAnchor; pendingAnchor = '';
  send({ t: 'room', webRid, anchor: anchor || null, online: lastOnlineSent, likeTotal: lastLikeTotal || undefined });
}

// ── 200ms 批量上报 + 档案分离 + 补帧放行 ──
setInterval(() => {
  // EXP-2：只放行 core 会话已就绪（announcedWebRid 匹配）的补帧消息
  if (bfPending.length && announcedWebRid) {
    const stay: typeof bfPending = [];
    for (const x of bfPending) (x.r === announcedWebRid ? likeBatch : stay).push(x as any);
    bfPending = stay;
  }
  if (likeBatch.length) { send({ t: 'likes', batch: likeBatch, at: Date.now() }); likeBatch = []; }
  if (profileBatch.length || [...profiles.values()].some(p => p.dirty)) {
    profileBatch = [];
    const list: { u: string; nick: string; av: string | null; sg: boolean }[] = [];
    for (const [u, p] of profiles) if (p.dirty) { list.push({ u, nick: p.nick, av: p.avatar, sg: p.starGuard }); p.dirty = false; }
    if (list.length) send({ t: 'profiles', list });
  }
}, 200);

// ── 实验打点周期上报（30s）：补帧解码统计 / 多路重叠率采样 ──
setInterval(() => {
  if (shuttingDown) return;
  if (bfStats.decoded || bfStats.failed) {
    expSend('fetchBackfill', { decoded: bfStats.decoded, failed: bfStats.failed });
    bfStats.decoded = 0; bfStats.failed = 0;
  }
  if (overlapSeen.size) {
    let dup = 0;
    for (const v of overlapSeen.values()) if (v === 'dup') dup++;
    expSend('adaptiveTabs', { overlapTotal: overlapSeen.size, overlapHits: dup });
    overlapSeen.clear();
  }
}, 30_000);

setInterval(() => { void roomMonitor(); }, 2000);

async function gracefulExit() {
  shuttingDown = true;
  try { await ctx?.close(); } catch {}
  try { ws?.close(); } catch {}
  process.exit(0);
}

process.on('SIGINT', () => void gracefulExit());
process.on('SIGTERM', () => void gracefulExit());

// ── main ──
(async () => {
  log('捕获进程启动', { CORE_WS, PROFILE_DIR, expFlags });
  connectCore();
  try { await ensureBrowser(); }
  catch (e) {
    log('浏览器启动失败', e);
    sendStatus('failed', 'browser-launch');
    setTimeout(() => void relaunch(), 15_000);
  }
  // 孤儿 Chrome 检测：本进程退出但 Chrome 仍在的残留场景由 profile 占用异常暴露
  process.on('exit', () => { try { ctx?.close(); } catch {} });
})();
