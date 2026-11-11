// ─── 合成捕获器：模拟 agent 接入（UI 开发/演示/压测驱动）───────────
// node --import tsx scripts/sim-capture.mjs [--rate 50] [--users 30] [--dur 0=不限]
// 生成形态：少数"连点器"型重度用户（高频 count=10 连击）+ 长尾普通用户。

import WebSocket from 'ws';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const TOKEN = (() => {
  for (const p of [path.resolve(here, '..', '..', 'data', 'runtime-token'), path.resolve(here, '..', 'data', 'runtime-token')]) {
    try { return fs.readFileSync(p, 'utf-8').trim(); } catch {}
  }
  console.error('未找到 data/runtime-token —— 先启动 core'); process.exit(1);
})();

const args = process.argv.slice(2);
const arg = (k, d) => { const i = args.indexOf(`--${k}`); return i >= 0 ? Number(args[i + 1]) : d; };
const RATE = arg('rate', 40);        // 消息/秒
const NUSERS = arg('users', 30);     // 参与用户数
const DUR = arg('dur', 0);           // 秒（0 = 持续到 Ctrl+C）
const SURGE_EVERY = arg('surge-every', 0); // 每 N 秒注入一次高能冲刺点赞（0 = 不周期）
const SURGE_COUNT = arg('surge-count', 60); // 单次冲刺注入的点赞数（10s 窗口折算速度）
const RENAME = arg('rename', 45);    // 昵称轮换间隔秒（0 = 关闭）
const CALM = args.includes('--calm'); // 演示模式：压低重度用户，避免自然触发冲刺
const SURGE_AT = (() => {
  const i = args.indexOf('--surge-at');
  if (i < 0) return [];
  return String(args[i + 1] ?? '').split(',').map(Number).filter(n => n > 0);
})();
const strArg = (k, d) => { const i = args.indexOf(`--${k}`); return i >= 0 ? String(args[i + 1] ?? d) : d; };
const ROOM = strArg('room', '88888888');
const ANCHOR = strArg('anchor', '模拟主播·演示间');
const WARM = arg('warm', 0);      // 先入场 N 秒再开始点赞（录 demo 的空榜开场）
const GUARDS = arg('guards', 0);  // 前 N 位模拟星守护（宝石行演示）

const NAMES = ['星辰', '晚风', '柠檬精', '阿白', '奶盖', '山月', 'Koi', '柚子茶', '老K', '喵呜',
  '长风', '拾贰', '不加糖', '蓝鲸', '77', '冲浪选手', '半夏', '不歪', '热苏打', '岛上书',
  '玛卡巴卡', '流星雨', '大白兔', '与月', '橘子汽水', '夜航星', '小卖部长', '香菜杀手', '落日骑士', 'pp'];
const rnd = (a, b) => a + Math.random() * (b - a);
const pick = a => a[Math.floor(Math.random() * a.length)];

// 用户池：前 3 名重度（连点器形态：高频大额连击），其余普通
const users = Array.from({ length: NUSERS }, (_, i) => ({
  secUid: `SIM${String(i).padStart(4, '0')}MS4wLjABCDtest`,
  nick: NAMES[i % NAMES.length] + (i >= NAMES.length ? i : ''),
  heavy: i < 3,
  weight: i < 3 ? (CALM ? 2 : 10) : 1,
}));
// 加权抽样池（weight 整数化）
const weighted = [];
for (const u of users) for (let k = 0; k < Math.round(u.weight); k++) weighted.push(u);

const ws = new WebSocket(`ws://127.0.0.1:17730/agent?token=${encodeURIComponent(TOKEN)}`);
let msgSeq = 0;
let batch = [], profileSent = false;

function sendSurge(u, count = SURGE_COUNT) {
  if (!u) u = users[Math.floor(Math.random() * Math.min(3, users.length))];
  if (count <= 0) return;
  ws.send(JSON.stringify({
    t: 'likes', at: Date.now(),
    batch: [{ i: `sim-surge-${++msgSeq}`, c: count, u: u.secUid, t: 0 }],
  }));
  console.log(`sim 冲刺：${u.nick} +${count} 赞（10s 折合 ${count * 6}/分）`);
}

ws.on('open', () => {
  console.log(`sim-capture 已接入：rate=${RATE}/s users=${NUSERS} dur=${DUR || '∞'}` +
    `${SURGE_EVERY ? ` surge-every=${SURGE_EVERY}s` : ''}${SURGE_AT.length ? ` surge-at=${SURGE_AT.join('/')}s` : ''}`);
  ws.send(JSON.stringify({ t: 'hello', ver: 1 }));
  ws.send(JSON.stringify({ t: 'room', webRid: ROOM, anchor: ANCHOR, online: 1234 }));

  // 高能冲刺：周期触发 + 指定秒卡点（录 demo 可精确控制）
  if (SURGE_EVERY > 0) setInterval(() => sendSurge(), SURGE_EVERY * 1000);
  for (const sec of SURGE_AT) setTimeout(() => sendSurge(), sec * 1000);
});

ws.on('message', raw => {
  let m; try { m = JSON.parse(raw.toString()); } catch { return; }
  if (m.t === 'watch') console.log('sim 忽略 watch 指令（模拟模式）');
});

function startLikes() {
  if (RATE <= 0) return;
  setInterval(() => {
    if (!profileSent) {
      profileSent = true;
      ws.send(JSON.stringify({ t: 'profiles', list: users.map((u, i) => ({ u: u.secUid, nick: u.nick, av: null, sg: i < GUARDS })) }));
    }
    // 每周期固定 n 条消息，按权重抽样归属（总量=RATE msg/s，重度用户消息大额）
    const n = Math.max(1, Math.round(RATE / 10));
    for (let k = 0; k < n; k++) {
      const u = weighted[Math.floor(Math.random() * weighted.length)];
      const count = u.heavy
        ? (CALM ? Math.round(rnd(1, 2)) : Math.round(rnd(8, 30)))
        : (CALM ? Math.round(rnd(1, 3)) : Math.round(rnd(1, 6)));
      batch.push({ i: `sim-${++msgSeq}`, c: count, u: u.secUid, t: 0 });
    }
  }, 100);

  setInterval(() => {
    if (batch.length) { ws.send(JSON.stringify({ t: 'likes', batch, at: Date.now() })); batch = []; }
  }, 200);
}

if (WARM > 0) {
  console.log(`空榜热身 ${WARM}s 后开始点赞…`);
  setTimeout(startLikes, WARM * 1000);
} else {
  startLikes();
}

// 昵称轮换演示（默认每 45s 一个用户改名——验证昵称历史；--rename 0 关闭）
if (RENAME > 0) {
  setInterval(() => {
    const u = pick(users);
    const newName = u.nick + '·改';
    u.nick = newName;
    ws.send(JSON.stringify({ t: 'profiles', list: [{ u: u.secUid, nick: newName, av: null }] }));
  }, RENAME * 1000);
}

if (DUR > 0) setTimeout(() => { console.log('sim 结束'); process.exit(0); }, DUR * 1000);
ws.on('close', () => { console.log('与 core 断开'); process.exit(1); });
