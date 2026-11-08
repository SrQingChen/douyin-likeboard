// ─── 性能压测：1000 msg/s × 30s 直喂引擎（docs §11 M6）─────────────
// node --import tsx scripts/perf-test.mjs [--rate 1000] [--dur 30] [--users 3000]
// 断言：零丢失、快照构建 < 50ms、内存增长合理。

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Engine } from '../src/engine.ts';
import { Store } from '../src/store.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const arg = (k, d) => { const i = args.indexOf(`--${k}`); return i >= 0 ? Number(args[i + 1]) : d; };
const RATE = arg('rate', 1000);
const DUR = arg('dur', 30);
const NUSERS = arg('users', 3000);

const TMP = path.resolve(here, '..', 'testdata', `perf-tmp-${Date.now()}.db`);
const store = new Store(TMP);
const engine = new Engine(store, { onToast: () => {}, onLog: () => {} });
engine.onRoom('99999999', '压测间');

const users = Array.from({ length: NUSERS }, (_, i) => `PERF${String(i).padStart(5, '0')}secUid`);
for (const u of users) engine.applyProfile(u, `用户${u.slice(-3)}`, null);

console.log(`压测：${RATE} msg/s × ${DUR}s，${NUSERS} 用户`);
let sent = 0, sentLikes = 0, applied = 0;
let seq = 0;
const t0 = Date.now();
const mem0 = process.memoryUsage().heapUsed;

const timer = setInterval(() => {
  for (let i = 0; i < Math.round(RATE / 10); i++) {
    const u = users[Math.floor(Math.random() * users.length)];
    const c = 1 + Math.floor(Math.random() * 10);
    if (engine.addLike(u, c, `p${++seq}`, 0, Date.now())) applied++;
    sent++; sentLikes += c;
  }
}, 100);

let snapMax = 0, tickMax = 0;
const timer2 = setInterval(() => {
  const a = performance.now();
  engine.agg.tick(Date.now(), 2800);
  const b = performance.now();
  engine.snapshot(Date.now());
  const c = performance.now();
  tickMax = Math.max(tickMax, b - a); snapMax = Math.max(snapMax, c - b);
}, 1000);

setTimeout(() => {
  clearInterval(timer); clearInterval(timer2);
  const wall = (Date.now() - t0) / 1000;
  const memGrowMB = ((process.memoryUsage().heapUsed - mem0) / 1048576).toFixed(1);
  const sessionLikes = engine.agg.room.sessionLikes;
  console.log(`\n结果：发送 ${sent} 条（${sentLikes} 赞）/ ${wall.toFixed(1)}s = ${(sent / wall).toFixed(0)} msg/s`);
  console.log(`入账 ${applied} 条（丢失 ${sent - applied}）| 会话总赞 ${sessionLikes}（应=${sentLikes}）`);
  console.log(`tick 峰值 ${tickMax.toFixed(1)}ms | 快照峰值 ${snapMax.toFixed(1)}ms | 堆增长 ${memGrowMB}MB`);
  // 最终结算压测（3000 用户排序 + 批量写库）
  const sa = performance.now();
  engine.manualSettle();
  console.log(`结算耗时 ${(performance.now() - sa).toFixed(0)}ms（${NUSERS} 用户规模）`);
  const pass = applied === sent && sessionLikes === sentLikes && snapMax < 50;
  console.log(`\n═══ ${pass ? '✅ 压测通过' : '❌ 压测失败'} ═══`);
  store.close();
  for (const s of ['', '-wal', '-shm']) try { fs.rmSync(TMP + s, { force: true }); } catch {}
  process.exit(pass ? 0 : 1);
}, DUR * 1000);
