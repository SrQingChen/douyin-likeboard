// ─── 捕获子进程：patchright 有头 Chrome 被动旁听（docs §1/§4/§5）───
// 职责：打开直播间页面 → 收 WS 帧 → 解码 Like/Member/Chat → 200ms 批量上报
//      core（档案分离协议）+ 房间状态机（换房/下播/风控检测）。
// 纯被动：从不向 WS 发帧、不调业务接口、无登录要求。
// 长跑自愈（v0.1.1）：WS 静默看门狗（刷新→重建递进）+ core 看护（互为守护）。

import { chromium, type Page } from 'patchright';
import WebSocket from 'ws';
import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { decodePushFrame } from '../pb.js';
import { parseChat, parseLike, parseMember, type UserProfile } from '../messages.js';

const CORE_WS = process.env.CORE_WS_URL ?? 'ws://127.0.0.1:17730/agent';
const TOKEN = process.env.AGENT_TOKEN ?? '';
const PROFILE_DIR = process.env.CHROME_PROFILE_DIR ?? path.resolve('data', 'chrome-profile');
const HERE = path.dirname(fileURLToPath(import.meta.url));       // server/src/capture
const SERVER_DIR = path.resolve(HERE, '..', '..');               // server/
const CORE_ENTRY = path.resolve(HERE, '..', 'index.ts');
// 多路采集：抖音对点赞广播流是抽样下发（实测单连接 coverage 仅 3~8 成），
// N 个并发标签各自独立抽样，core 按 msgId 去重合并 → 覆盖率指数提升。
const TABS = Math.max(1, Math.min(4, Number(process.env.CAPTURE_TABS ?? 2)));

// ── 上报状态 ──
interface ProfileEntry { nick: string; avatar: string | null; dirty: boolean }
const profiles = new Map<string, ProfileEntry>();   // secUid → 档案（变化才上报）
let likeBatch: { i: string; c: number; u: string; t: number }[] = [];
let profileBatch: { u: string; nick: string; av: string | null }[] = [];
let lastRoomSent = '';
let lastOnlineSent = 0;
let ws: WebSocket | null = null;
let shuttingDown = false;
let wsConnectedAt = 0;          // 最近一次与 core 建连时刻（看护用）

const log = (...a: unknown[]) => console.log(new Date().toISOString().slice(11, 19), ...a);

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
    if (m.t === 'watch' && m.url) void watchRoom(String(m.url));
    else if (m.t === 'reload') void reloadRoom();
    else if (m.t === 'shutdown') { log('收到 shutdown'); void gracefulExit(); }
  });
  sock.on('close', () => {
    ws = null;
    if (!shuttingDown) { log('与 core 断开，3s 后重连'); setTimeout(connectCore, 3000); }
  });
  sock.on('error', () => { try { sock.terminate(); } catch {} });
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
  if (!cur) profiles.set(u.secUid, { nick: u.nick, avatar: u.avatar, dirty: true });
  else {
    let dirty = false;
    if (u.nick && u.nick !== cur.nick) { cur.nick = u.nick; dirty = true; }
    if (u.avatar && u.avatar !== cur.avatar) { cur.avatar = u.avatar; dirty = true; }
    if (dirty) cur.dirty = true;
  }
}

// ── Chrome ──
let ctx: Awaited<ReturnType<typeof chromium.launchPersistentContext>> | null = null;
let roomPages: Page[] = [];        // 多路采集标签（首个为监视基准页）
let currentRoomUrl = '';
let lastStatusSent = '';

const sendStatus = (state: string, reason?: string) => {
  if (state !== lastStatusSent || state === 'offline' || state === 'risk') {
    lastStatusSent = state;
    send({ t: 'status', state, reason });
  }
};

async function launchBrowser() {
  fs.mkdirSync(PROFILE_DIR, { recursive: true });
  // 防呆：系统 Chrome 存在 → channel:'chrome'（实测最佳完整度）；
  // 缺失 → CAPTURE_FORCE_CHANNEL=bundled 走内置 Chromium（便携包 blank 机兜底，完整度可能略低）
  const useBundled = process.env.CAPTURE_FORCE_CHANNEL === 'bundled';
  ctx = await chromium.launchPersistentContext(PROFILE_DIR, {
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
  roomPages = ctx.pages().length ? ctx.pages().slice(0, 1) : [await ctx.newPage()];
  wirePage(roomPages[0]);
  ctx.on('page', p => { wirePage(p); });   // 用户/抖音自行开的标签也纳入监听
  ctx.on('close', () => { if (!shuttingDown) { log('浏览器被关闭，8s 后重启'); setTimeout(() => void relaunch(), 8000); } });
  log(`Chrome 已启动（捕获窗口，采集路数=${TABS}）`);
}

let relaunchCount = 0; let relaunchTimes: number[] = [];
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
  const now = Date.now();
  relaunchTimes = relaunchTimes.filter(t => now - t < 600_000);
  if (relaunchTimes.length >= 6) { log('浏览器重启超限，报告 failed'); sendStatus('failed', 'browser-relaunch-limit'); return; }
  relaunchTimes.push(now);
  try { await ctx?.close(); } catch {}
  try { await launchBrowser(); if (currentRoomUrl) await gotoRoom(currentRoomUrl); }
  catch (e) {
    log('浏览器重启失败', e);
    killStaleChrome();                       // profile 被残留进程占用时的防呆清理
    setTimeout(() => void relaunch(), 15_000);
  }
}

function wirePage(page: Page) {
  // HTTP 侧：房间 enter/info 接口响应里有稳定的主播名（实测结构 data.room.data.owner）
  page.on('response', async res => {
    try {
      const u = res.url();
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
        if (buf.length < 8) return;               // 心跳 "hi" 等
        const msgs = decodePushFrame(buf);
        if (!msgs) return;
        for (const m of msgs) handleMsg(m.method, m.payload);
      } catch { /* 帧解码失败忽略 */ }
    });
  });
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
    void reloadRoom();
  }
}, 20_000);

function handleMsg(method: string, payload: Buffer) {
  if (method === 'WebcastLikeMessage') {
    const like = parseLike(payload);
    if (!like || !like.count) return;
    likeBatch.push({ i: like.msgId, c: like.count, u: like.secUid, t: like.total });
    noteProfile({ secUid: like.secUid, nick: like.nick, avatar: like.avatar });
  } else if (method === 'WebcastMemberMessage') {
    const mem = parseMember(payload);
    if (mem.user) noteProfile(mem.user);
    if (mem.online > 0) lastOnlineSent = mem.online;
  } else if (method === 'WebcastChatMessage') {
    const chat = parseChat(payload);
    if (chat.user) noteProfile(chat.user);       // 弹幕用户昵称未打码概率高，优质档案源
  }
}

async function gotoRoom(url: string) {
  if (!ctx) return;
  log(`进入房间 ${url}（${TABS} 路）`);
  // 首路：主导航；其余路：补齐标签后同址导航
  while (roomPages.length < TABS) {
    const extra = await ctx.newPage().catch(() => null);
    if (!extra) break;
    roomPages.push(extra);
    wirePage(extra);
  }
  await Promise.all(roomPages.map((p, i) =>
    p.goto(i === 0 ? url : url, { waitUntil: 'domcontentloaded', timeout: 45_000 })
      .catch(e => log(`goto[tab${i}]`, String(e).slice(0, 100)))));
  await detectAnchor().catch(() => {});
}

async function watchRoom(url: string) {
  currentRoomUrl = url;
  if (!ctx) await launchBrowser().catch(async e => { log('launch fail', e); await relaunch(); });
  await gotoRoom(url);
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

/** 2s 房间状态机：URL 变化=换房；jingxuan 重定向=下播；verify=风控 */
let anchorRetries = 0;
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
    return;
  }
  lastUrl = url;
  if (/live\.douyin\.com\/(\d{6,13})/.test(url)) {
    log('房间页面', url);
    sendRoom(true);
    anchorRetries = 0;   // 主播名异步重试（进房瞬间元素未渲染，实测需等 2~6s）
    await detectAnchor().catch(() => {});
  } else if (/jingxuan|\/select/.test(url)) {
    log('检测到下播（重定向精选页）');
    sendStatus('offline', 'redirected-to-jingxuan');
    currentRoomUrl = '';
  } else if (/verify|captcha|challenge/.test(url)) {
    log('检测到验证页');
    sendStatus('risk', 'verify-page');
  } else if (url === 'about:blank' || url === '') {
    sendStatus('starting');
  }
}

let lastOnlineReported = -1;
function sendRoom(force: boolean) {
  const m = lastUrl.match(/live\.douyin\.com\/(\d{6,13})/);
  if (!m) return;
  const webRid = m[1];
  // 强制/换房/有新主播名/在线人数变化 时上报（验证 P2-④：online 持续更新）
  if (!force && webRid === lastRoomSent && !pendingAnchor && lastOnlineSent === lastOnlineReported) return;
  lastRoomSent = webRid;
  lastOnlineReported = lastOnlineSent;
  const anchor = pendingAnchor; pendingAnchor = '';
  send({ t: 'room', webRid, anchor: anchor || null, online: lastOnlineSent });
}

// ── 200ms 批量上报 + 档案分离 ──
setInterval(() => {
  if (likeBatch.length) { send({ t: 'likes', batch: likeBatch, at: Date.now() }); likeBatch = []; }
  if (profileBatch.length || [...profiles.values()].some(p => p.dirty)) {
    profileBatch = [];
    const list: { u: string; nick: string; av: string | null }[] = [];
    for (const [u, p] of profiles) if (p.dirty) { list.push({ u, nick: p.nick, av: p.avatar }); p.dirty = false; }
    if (list.length) send({ t: 'profiles', list });
  }
}, 200);

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
  log('捕获进程启动', { CORE_WS, PROFILE_DIR });
  connectCore();
  try { await launchBrowser(); }
  catch (e) {
    log('浏览器启动失败', e);
    sendStatus('failed', 'browser-launch');
    setTimeout(() => void relaunch(), 15_000);
  }
  // 孤儿 Chrome 检测：本进程退出但 Chrome 仍在的残留场景由 profile 占用异常暴露
  process.on('exit', () => { try { ctx?.close(); } catch {} });
})();
