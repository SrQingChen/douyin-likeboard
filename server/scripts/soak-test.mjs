// ─── 长跑压测：模拟整场直播的稳定运行（内存曲线 / GC 压力 / 结算风暴）─
// node --import tsx scripts/soak-test.mjs [--dur 3600] [--rate 300] [--users 5000]
// 断言：零丢失 + 内存无单调泄漏（后半程均值不超前半程均值 + 阈值）+ 快照稳定。

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Engine } from '../src/engine.ts';
import { Store } from '../src/store.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const arg = (k, d) => { const i = args.indexOf(`--${k}`); return i >= 0 ? Number(args[i + 1]) : d; };
const DUR = arg('dur', 3600);          // 秒（默认 1h 代表性长跑）
const RATE = arg('rate', 300);         // msg/s（活跃房间真实峰值量级）
const NUSERS = arg('users', 5000);     // 累计观众（长跑中陆续进场）
const ROUND_MIN = arg('round', 10);    // 轮次（分钟）——长跑中制造多次结算

const TMP = path.resolve(here, '..', 'testdata', `soak-tmp-${Date.now()}.db`);
const store = new Store(TMP);
const engine = new Engine(store, { onToast: () => {}, onLog: () => {} });
engine.onRoom('88888888', '长跑压测间');
// patchConfig 会落盘真实 config.json —— 先备份，退出时恢复
const cfgPath = path.resolve(here, '..', '..', 'data', 'config.json');
const origCfg = fs.existsSync(cfgPath) ? fs.readFileSync(cfgPath, 'utf-8') : null;
const cfgPatch = (await import('../src/config.js')).patchConfig;
cfgPatch({ roundMinutes: ROUND_MIN, checkpointSec: 15 });
engine.startTimers();
process.on('exit', () => {
  try { origCfg !== null ? fs.writeFileSync(cfgPath, origCfg, 'utf-8') : fs.rmSync(cfgPath, { force: true }); } catch {}
});

const users = Array.from({ length: NUSERS }, (_, i) => `SOAK${String(i).padStart(5, '0')}`);
let seq = 0, sent = 0, sentLikes = 0, applied = 0;
const samples = [];   // {t, heapMB, users, rounds}
const mem0 = process.memoryUsage().heapUsed;

// 进场模型：观众随时间陆续进场（每 6s 进一批），进场后常驻低频点赞
let joined = 0;
const joinTimer = setInterval(() => {
  const batch = Math.min(users.length - joined, Math.max(1, Math.round(NUSERS / (DUR / 6))));
  for (let k = 0; k < batch && joined < users.length; k++, joined++) {
    engine.applyProfile(users[joined], `观众${joined}`, null);
  }
}, 6000);

// 点赞流：300msg/s；重度用户（前 50）+ 普通长尾
const sendTimer = setInterval(() => {
  for (let i = 0; i < Math.round(RATE / 10); i++) {
    const u = Math.random() < 0.15
      ? users[Math.floor(Math.random() * 50)]
      : users[Math.floor(Math.random() * Math.max(1, joined))];
    if (!u) continue;
    const c = 1 + Math.floor(Math.random() * 8);
    if (engine.addLike(u, c, `s${++seq}`, 0, Date.now())) applied++;
    sent++; sentLikes += c;
  }
}, 100);

// 采样：每 30s
const sampleTimer = setInterval(() => {
  const heapMB = (process.memoryUsage().heapUsed / 1048576);
  samples.push({ t: Math.round((Date.now() - t0) / 1000), heapMB: +heapMB.toFixed(1),
    users: engine.agg.users.size, rounds: store.statsSummary().rounds });
  console.log(`[${String(Math.round((Date.now() - t0) / 1000)).padStart(4)}s] heap=${heapMB.toFixed(0)}MB users=${engine.agg.users.size} rounds=${store.statsSummary().rounds} likes=${engine.agg.room.sessionLikes}`);
}, 30_000);

// 快照稳定性监控（长跑中 snapshot 延迟不应恶化）
let snapMax = 0;
const snapTimer = setInterval(() => {
  const a = performance.now(); engine.snapshot(Date.now()); const b = performance.now();
  snapMax = Math.max(snapMax, b - a);
}, 5000);

const t0 = Date.now();
console.log(`长跑压测：${DUR}s @ ${RATE}msg/s，${NUSERS} 观众，轮次 ${ROUND_MIN}min`);

setTimeout(async () => {
  clearInterval(joinTimer); clearInterval(sendTimer); clearInterval(sampleTimer); clearInterval(snapTimer);
  const memGrowMB = (process.memoryUsage().heapUsed - mem0) / 1048576;
  const half = Math.floor(samples.length / 2) || 1;
  const avg = a => a.reduce((s, x) => s + x.heapMB, 0) / Math.max(1, a.length);
  const firstHalf = avg(samples.slice(0, half)), secondHalf = avg(samples.slice(half));
  const drift = secondHalf - firstHalf;
  const loss = sent - applied;

  console.log(`\n═══ 长跑结果（${DUR}s @ ${RATE}msg/s）═══`);
  console.log(`消息 ${sent} 条（丢失 ${loss}）| 总赞 ${engine.agg.room.sessionLikes} | 结算轮次 ${store.statsSummary().rounds}`);
  console.log(`内存：前半程均值 ${firstHalf.toFixed(0)}MB → 后半程均值 ${secondHalf.toFixed(0)}MB（漂移 ${drift >= 0 ? '+' : ''}${drift.toFixed(0)}MB）| 全程增长 ${memGrowMB.toFixed(0)}MB`);
  console.log(`快照峰值 ${snapMax.toFixed(1)}ms | 终态档案 ${engine.agg.users.size}`);

  const okRows = store.statsSummary();
  const pass = loss === 0 && drift < 150 && snapMax < 50
    && okRows.rounds >= Math.max(1, Math.floor(DUR / 60000 / ROUND_MIN) - 1);
  console.log(`\n═══ ${pass ? '✅ 长跑通过' : '❌ 长跑未达标'} ═══`);
  store.close();
  for (const s of ['', '-wal', '-shm']) try { fs.rmSync(TMP + s, { force: true }); } catch {}
  process.exit(pass ? 0 : 1);
}, DUR * 1000);
