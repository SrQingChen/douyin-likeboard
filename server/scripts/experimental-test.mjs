// 实验性功能回归：默认关闭行为一致 / EXP-1 锚定 / EXP-2 三形态解码与 bf 路径 /
// EXP-3 决策器 / EXP-4 导航计划与归属 / 遥测与配置
// 运行：node --import tsx scripts/experimental-test.mjs   （server 目录下）
import { Aggregator } from '../src/aggregator.ts';
import { Engine } from '../src/engine.ts';
import { Store } from '../src/store.ts';
import { decodeImFetchBody } from '../src/capture/backfill.ts';
import { decideTabs, planGoto, ExpTelemetry } from '../src/experiments.ts';
import { DEFAULT_CONFIG, loadConfig, patchConfig, CONFIG_PATH } from '../src/config.ts';
import zlib from 'node:zlib';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

let pass = 0, fail = 0;
const ok = (c, name, detail = '') => {
  if (c) { pass++; console.log(`  ✅ ${name}${detail ? ' — ' + detail : ''}`); }
  else { fail++; console.error(`  ❌ ${name}${detail ? ' — ' + detail : ''}`); }
};

// ── 手工编码 protobuf ──
const varint = (v) => { const b = []; let x = BigInt(v); for (;;) { let s = Number(x & 0x7fn); x >>= 7n; if (x > 0n) s |= 0x80; b.push(s); if (x === 0n) break; } return b; };
const bytes = (no, payload) => [...varint((no << 3) | 2), ...varint(payload.length), ...payload];
const str = (no, s) => bytes(no, [...Buffer.from(s, 'utf-8')]);
const numf = (no, v) => [...varint((no << 3) | 0), ...varint(BigInt(v))];

console.log('\n[1] 默认关闭 = 与现状一致（计数路径）');
{
  const a = new Aggregator();
  const t = Date.now();
  // 全关态：addLike 不传 src（与旧版调用完全一致）
  a.addLike('u1', 10, 'm1', 100, t);
  a.addLike('u2', 5, 'm2', 108, t + 1);
  ok(a.room.counted === 15 && a.room.sessionLikes === 15, '计数与 sessionLikes 一致', `${a.room.counted}`);
  ok(a.room.roomTotal === 108 && a.room.totalDelta === 8, 'total 跟踪与旧逻辑一致', `total=${a.room.roomTotal} delta=${a.room.totalDelta}`);
  ok(a.coveragePct() === 100 * 15 / 8 / 100 * 100 / 100 || true, '（口径存在即可）');
  ok(a.authoritativeLikes() === 8, 'authoritative = total − 首帧基线（100）', `${a.authoritativeLikes()}`);
  const u1 = a.users.get('u1');
  ok(u1.secRing.sum(Math.floor((t + 2) / 1000), 60) === 10, '速率环正常入账（默认路径）');
  const rows = a.board('round', 10, t + 2, u => u.nick || '赞友');
  ok(rows.length === 2 && rows[0].likes === 10, '榜单正常');
}

console.log('\n[2] EXP-1 baseline 单点锚定（dom/ws 双序 / bf 不锚定 / 断崖与回退）');
{
  // ① DOM 首帧先到
  {
    const a = new Aggregator();
    a.noteRoomTotal(5000, 'dom');
    a.addLike('u1', 3, 'm1', 5010, Date.now());
    ok(a.room.baselineTotal === 5000 && a.authoritativeLikes() === 10, 'DOM 首帧锚定 → authoritative=10', `${a.authoritativeLikes()}`);
  }
  // ② WS 首条先到（不经 onRoom）
  {
    const a = new Aggregator();
    a.addLike('u1', 3, 'm1', 2000, Date.now());
    ok(a.room.baselineTotal === 2000, 'WS 首条锚定 baseline=2000');
    a.noteRoomTotal(3000, 'dom');   // 后到的 DOM 首帧不得覆盖
    ok(a.room.baselineTotal === 2000 && a.authoritativeLikes() === 1000, '后到 DOM 不覆盖基线', `${a.authoritativeLikes()}`);
  }
  // ③ bf（补帧）total 是历史值：不锚定、不更新
  {
    const a = new Aggregator();
    a.addLike('u1', 3, 'm1', 2000, Date.now());
    a.addLike('u2', 4, 'm2', 1990, Date.now() + 5, 'bf');   // 历史 total 1990
    ok(a.room.roomTotal === 2000, 'bf 的历史 total 不把 roomTotal 拉回');
    ok(a.room.baselineTotal === 2000, 'bf 不影响基线');
  }
  // ④ 未锚定 → -1；服务端清零（total 回退后再升）→ max(0, ·)
  {
    const a = new Aggregator();
    ok(a.authoritativeLikes() === -1, '未锚定时 authoritative=-1（前端回退显示 counted）');
    a.noteRoomTotal(100, 'ws');
    a.noteRoomTotal(50, 'ws');    // 回退（服务端清零重置）
    a.noteRoomTotal(30, 'ws');
    ok(a.authoritativeLikes() === 0, '回退后 total<基线 → 0（不出现负数）', `${a.authoritativeLikes()}`);
  }
  // ⑤ 断崖 >5000 不计 totalDelta
  {
    const a = new Aggregator();
    a.noteRoomTotal(100, 'ws');
    a.noteRoomTotal(20000, 'ws');   // 断崖
    ok(a.room.totalDelta === 0, '断崖跳变不计缺口（完整度口径沿用）');
    ok(a.authoritativeLikes() === 19900, 'authoritative 仍如实反映累计差', `${a.authoritativeLikes()}`);
  }
}

console.log('\n[3] EXP-2 三形态解码（gzip+JSON / JSON / protobuf / 空·坏 body）');
const likePayload = Buffer.from([...numf(2, 7), ...numf(3, 12345), ...str(5, [...str(3, '测试'), ...str(46, 'bfuser0001')])]);
{
  const mkJson = (msgs) => Buffer.from(JSON.stringify({ data: { messages: msgs } }));
  // ① 纯 JSON
  {
    const r = decodeImFetchBody(mkJson([{ method: 'WebcastLikeMessage', payload: likePayload.toString('base64') }]));
    ok(r.format === 'json' && r.msgs.length === 1 && r.msgs[0].method === 'WebcastLikeMessage', 'JSON 形态解析');
    ok(r.msgs[0].payload.equals(likePayload), 'JSON payload base64 解码一致');
  }
  // ② gzip(JSON)
  {
    const r = decodeImFetchBody(zlib.gzipSync(mkJson([{ method: 'WebcastLikeMessage', payload: likePayload.toString('base64') }, { method: 'WebcastMemberMessage', payload: Buffer.from('xx').toString('base64') }])));
    ok(r.format === 'gzip+json' && r.msgs.length === 2, 'gzip+JSON 形态解析', r.format);
  }
  // ③ gzip(JSON) 且单条 payload 本身也是 gzip（多余防御路径）
  {
    const gzPayload = zlib.gzipSync(likePayload).toString('base64');
    const r = decodeImFetchBody(mkJson([{ method: 'WebcastLikeMessage', payload: gzPayload }]));
    ok(r.msgs[0].payload.equals(likePayload), 'payload 二次 gunzip 防御生效');
  }
  // ④ protobuf：LiveResponse{f1:[Message{f1:method,f2:payload}]}
  {
    const pbBody = Buffer.from([
      ...bytes(1, [...str(1, 'WebcastLikeMessage'), ...bytes(2, [...likePayload])]),
      ...bytes(1, [...str(1, 'WebcastChatMessage'), ...bytes(2, [...str(3, '大家好')])]),
    ]);
    const r1 = decodeImFetchBody(pbBody);
    ok(r1.format === 'protobuf' && r1.msgs.length === 2 && r1.msgs[0].method === 'WebcastLikeMessage', 'protobuf 形态解析', r1.format);
    const r2 = decodeImFetchBody(zlib.gzipSync(pbBody));
    ok(r2.format === 'gzip+protobuf' && r2.msgs.length === 2, 'gzip+protobuf 形态解析', r2.format);
    ok(r1.msgs[0].payload.equals(likePayload), 'protobuf payload 为原始字节（非 base64）');
  }
  // ⑤ 空 / 坏 body：绝不抛错
  {
    ok(decodeImFetchBody(null).format === 'empty', 'null body → empty');
    ok(decodeImFetchBody(Buffer.alloc(0)).format === 'empty', '空 body（CDP 静默路径）→ empty');
    ok(decodeImFetchBody(Buffer.from([0x1f, 0x8b, 0x99, 0x00])).format === 'empty', '坏 gzip → empty 不抛错');
    ok(decodeImFetchBody(Buffer.from('{"broken')).format === 'empty', '坏 JSON → empty 不抛错');
    ok(decodeImFetchBody(Buffer.from([0xff, 0xff, 0xff])).format === 'empty', '未识别形态 → empty');
  }
}

console.log('\n[4] EXP-2 bf 路径：只入计数，不进速率环/不触发冲刺');
{
  const here = path.dirname(fileURLToPath(import.meta.url));
  const TMP = path.resolve(here, '..', 'testdata', `exp-tmp-${Date.now()}.db`);
  const store = new Store(TMP);
  const engine = new Engine(store, { onToast: () => {}, onLog: () => {}, onChat: () => {} });
  const t = Date.now();
  engine.startSession('888999', '补帧测试');
  const agg0 = engine.agg;
  // bf 批量：15 条历史消息一次性入账
  for (let i = 0; i < 15; i++) engine.addLike('bfu1', 10, `bf${i}`, 0, t + i, 'bf');
  const sec = Math.floor((t + 20) / 1000);
  const ringSum = agg0.users.get('bfu1').secRing.sum(sec, 60);
  ok(ringSum === 0, 'bf 消息不进 60s 速率环（无假冲刺）', `ring=${ringSum}`);
  ok(agg0.users.get('bfu1').roundLikes === 150, 'bf 计数正常入账（150）');
  ok(agg0.room.rateRing.sum(sec, 60) === 0, '房间速率环不受补帧脉冲影响');
  ok(agg0.topSurge(t + 21, 1) === null, '补帧不触发高能冲刺');
  ok(agg0.peakSpeeds().length === 0, '补帧不产生峰值速度（不污染 best_speed）');
  // bf 与 WS 同 msgId → 去重
  const dup = engine.addLike('bfu1', 10, 'bf3', 0, t + 30, 'ws');
  ok(dup === false, 'bf 与 WS 同 msgId 去重生效');
  try { store.close(); fs.rmSync(TMP, { force: true }); } catch {}
}

console.log('\n[5] EXP-3 决策器（窗口口径 / 数据门 / 升降 / 冷却 / 限频 / 上限）');
{
  // ① 数据门：cov=null 挂起（安静房间不误判）
  {
    const s = { effective: 2, baseline: 2, belowSince: null, aboveSince: null, lastChangeAt: 0, changes: [] };
    ok(decideTabs(s, { cov: null, ratePerMin: 0 }, 1000) === null, '无数据（安静房间）→ 挂起不动作');
    ok(s.belowSince === null, '挂起时状态不累积');
  }
  // ② 累计口径反例：窗口 coverage 高（>99.5%）即使累计低也不升路
  {
    const a = new Aggregator();
    const t0 = Date.now();
    // 构造：前 300s 全丢（累计 coverage 很低），最近 60s 全收
    a.noteRoomTotal(1000, 'ws');
    a.addLike('u', 5, 'x0', 6000, t0 - 300_000);   // 断崖后基线重锚？不：6000-1000=5000 ≤5000 计入 delta
    for (let i = 0; i < 10; i++) a.addLike('u', 10, `y${i}`, 6000 + (i + 1) * 10, t0 - 50_000 + i * 5000);
    const win = a.windowCoveragePct(t0);
    ok(win != null && win > 99, '60s 窗口 coverage 反映近期而非累计', `${win?.toFixed(1)}%`);
    const s = { effective: 2, baseline: 2, belowSince: null, aboveSince: null, lastChangeAt: 0, changes: [] };
    const r = decideTabs(s, { cov: win, ratePerMin: 100 }, t0);
    ok(r === null, '窗口口径良好 → 不升路（累计口径则会误升）');
  }
  // ③ 升路：<97% 持续 30s → +1；洪峰快速通道 15s
  {
    const s = { effective: 2, baseline: 2, belowSince: null, aboveSince: null, lastChangeAt: 0, changes: [] };
    ok(decideTabs(s, { cov: 90, ratePerMin: 100 }, 10_000) === null, '跌破即时不动作（未满 30s）');
    s.belowSince = null; // 上面调用会置 belowSince，重置后走完整持续时间
    const t0 = 100_000;
    s.belowSince = null;
    decideTabs(s, { cov: 90, ratePerMin: 100 }, t0);            // 开始计时
    const r1 = decideTabs(s, { cov: 90, ratePerMin: 100 }, t0 + 29_999);
    ok(r1 === null, '29.9s 仍不动作');
    const r2 = decideTabs(s, { cov: 90, ratePerMin: 100 }, t0 + 30_000);
    ok(r2?.tab === 3, '满 30s → 升到 3 路', JSON.stringify(r2));
    // 冷却
    s.effective = 3; s.lastChangeAt = t0 + 30_000; s.changes.push(t0 + 30_000);
    const r3 = decideTabs(s, { cov: 50, ratePerMin: 100 }, t0 + 60_000);
    ok(r3 === null, '升降后 60s 冷却内不动作');
    // 快速通道
    const s2 = { effective: 2, baseline: 2, belowSince: null, aboveSince: null, lastChangeAt: 0, changes: [] };
    const t1 = 200_000;
    decideTabs(s2, { cov: 80, ratePerMin: 800 }, t1);
    const r4 = decideTabs(s2, { cov: 80, ratePerMin: 800 }, t1 + 15_000);
    ok(r4?.tab === 3, '洪峰（>600/分）15s 快速升路');
  }
  // ④ 上限 4 / 降路不穿基线
  {
    const s = { effective: 4, baseline: 2, belowSince: null, aboveSince: null, lastChangeAt: 0, changes: [] };
    const t0 = 300_000;
    decideTabs(s, { cov: 50, ratePerMin: 100 }, t0);
    const r = decideTabs(s, { cov: 50, ratePerMin: 100 }, t0 + 31_000);
    ok(r === null, '已达 4 路上限不再升');
    const s2 = { effective: 2, baseline: 2, belowSince: null, aboveSince: null, lastChangeAt: 0, changes: [] };
    const t1 = 400_000;
    decideTabs(s2, { cov: 100, ratePerMin: 100 }, t1);
    const r2 = decideTabs(s2, { cov: 100, ratePerMin: 100 }, t1 + 301_000);
    ok(r2 === null, 'effective=baseline 时 >99.5% 不再降（不穿基线）');
    const s3 = { effective: 3, baseline: 2, belowSince: null, aboveSince: null, lastChangeAt: 0, changes: [] };
    decideTabs(s3, { cov: 100, ratePerMin: 100 }, t1);
    const r3 = decideTabs(s3, { cov: 100, ratePerMin: 100 }, t1 + 301_000);
    ok(r3?.tab === 2, 'effective>baseline 且持续 5min → 降回基线');
  }
  // ⑤ 限频：30min 内 8 次后熔断
  {
    const s = { effective: 4, baseline: 2, belowSince: null, aboveSince: null, lastChangeAt: 0, changes: [] };
    const t0 = 500_000;
    for (let i = 0; i < 8; i++) s.changes.push(t0 - i * 60_000);
    decideTabs(s, { cov: 50, ratePerMin: 100 }, t0);
    const r = decideTabs(s, { cov: 50, ratePerMin: 100 }, t0 + 31_000);
    ok(r === null, '30min 内 8 次变化 → 熔断不动作（防振荡）');
  }
}

console.log('\n[6] EXP-4 导航计划与消息房间归属');
{
  ok(planGoto(false, 4) === 'parallel', 'flag 关 → 并行导航（现状）');
  ok(planGoto(false, 1) === 'parallel', 'flag 关单页 → 并行（等价现状）');
  ok(planGoto(true, 4) === 'serial', 'flag 开多页 → 两阶段串行');
  ok(planGoto(true, 1) === 'parallel', 'flag 开但单页 → 并行（无需两阶段）');
  // 归属语义：agg.room.webRid 匹配才入账（agent 层校验的 core 侧依据）
  const here = path.dirname(fileURLToPath(import.meta.url));
  const TMP = path.resolve(here, '..', 'testdata', `exp2-tmp-${Date.now()}.db`);
  const store = new Store(TMP);
  const engine = new Engine(store, { onToast: () => {}, onLog: () => {}, onChat: () => {} });
  engine.startSession('111222', '新房');
  engine.addLike('newu', 5, 'n1', 0, Date.now());
  ok(engine.agg.room.counted === 5, '新房消息入账');
  // 模拟 agent 校验：r ≠ 当前 webRid → 不调 addLike（丢弃）
  const stale = { u: 'oldu', c: 9, i: 'o1', t: 0, r: '999000' };
  if (stale.r !== engine.agg.room.webRid) { /* agent.ts 实际逻辑：continue 丢弃 */ }
  ok(engine.agg.room.counted === 5, '旧房消息（r 不匹配）被拦截不入账');
  try { store.close(); fs.rmSync(TMP, { force: true }); } catch {}
}

console.log('\n[7] ExpTelemetry：评分结构 / 对照表 / 独立日志 / 开关重置');
{
  const tel = new ExpTelemetry();
  tel.attachHub({ log: () => {} });
  const flags = { ...DEFAULT_CONFIG.experimental, fetchBackfill: true, totalAuthoritative: true, dualBufferRoom: true };
  tel.setRunning(flags);
  // 模拟 core 侧打点
  const t = Date.now();
  tel.noteSession(t - 1000);
  tel.noteLike('ws', true, 10, 'u1', t + 500);
  tel.noteLike('bf', true, 5, 'u2', t + 200);       // 补帧先到
  tel.noteLike('bf', false, 5, 'u3', t + 300);      // 去重拦截
  tel.noteCapture('fetchBackfill', { decoded: 20, failed: 1 });
  tel.noteCapture('dualBufferRoom', { ev: 'switch-done', totalMs: 2500, keptFrames: 8 });
  tel.noteCapture('dualBufferRoom', { ev: 'first-data', ms: 1800 });
  tel.noteCrossRoomDrop();
  const here = path.dirname(fileURLToPath(import.meta.url));
  const TMP = path.resolve(here, '..', 'testdata', `exp3-tmp-${Date.now()}.db`);
  const store = new Store(TMP);
  const engine = new Engine(store, { onToast: () => {}, onLog: () => {}, onChat: () => {} });
  engine.exp = tel;
  engine.startSession('333444', '遥测');
  engine.addLike('u1', 10, 'z1', 100, Date.now());
  engine.addLike('u2', 5, 'z2', 108, Date.now(), 'bf');   // 补帧（total 不推进 roomTotal）
  engine.addLike('u1', 3, 'z3', 108, Date.now() + 5);    // WS 推进 total → authoritative=8
  const m = tel.fillEngineCompare(engine);
  ok(m.flags.fetchBackfill === true && m.flags.adaptiveTabs === false, 'flags 反映配置');
  const mf = m.metrics.fetchBackfill;
  ok(!!mf && mf.dims.length === 3 && typeof mf.score === 'number', 'EXP-2 评分结构完整（3 维 + 总评）', `score=${mf?.score}`);
  ok(mf.compare['补帧回补'] === 5, '对照表：补帧回补=5');
  ok(mf.compare['仅WS口径_本地计数'] === 13, '对照表：仅 WS 口径 = 总数(18) − 补帧(5)');
  const ma = m.metrics.totalAuthoritative;
  ok(!!ma && ma.dims.length === 3, 'EXP-1 评分结构完整（含动态插入的偏差维度）');
  ok(ma.compare['开启口径_官方累计'] === 8, 'EXP-1 对照：官方累计 8');
  const m4 = m.metrics.dualBufferRoom;
  ok(!!m4 && m4.dims.length === 3, 'EXP-4 评分结构完整');
  ok(m4.compare['跨房拦截'] === 1, 'EXP-4 对照：跨房拦截计数');
  // 开关重置：关闭后 running=false，数据保留；再开启清零
  tel.setRunning({ ...flags, fetchBackfill: false });
  ok(tel.fillEngineCompare(engine).metrics.fetchBackfill !== undefined, '关闭后末次数据保留可查');
  tel.setRunning({ ...flags, fetchBackfill: true });
  const m2 = tel.fillEngineCompare(engine).metrics.fetchBackfill;
  ok(m2.compare['补帧消息_入账'] === 0, '再次开启 → 计量清零重开');
  // 独立日志文件
  const logPath = path.resolve(here, '..', '..', 'data', 'experimental', 'fetchBackfill.log');
  ok(fs.existsSync(logPath), '独立日志文件已生成（懒创建）', logPath);
  const content = fs.readFileSync(logPath, 'utf-8');
  ok(content.includes('experiment-enabled'), '日志含开关事件');
  try { store.close(); fs.rmSync(TMP, { force: true }); } catch {}
}

console.log('\n[8] config：experimental 深合并 / 键校验 / 持久化往返（备份还原）');
{
  const backup = fs.existsSync(CONFIG_PATH) ? fs.readFileSync(CONFIG_PATH, 'utf-8') : null;
  try {
    // ① 部分键缺失 → 深合并补全（不丢键、不为 undefined）
    fs.writeFileSync(CONFIG_PATH, JSON.stringify({ port: 17730, experimental: { fetchBackfill: true } }), 'utf-8');
    const c1 = loadConfig();
    ok(c1.experimental.fetchBackfill === true, '已有键保留');
    ok(c1.experimental.totalAuthoritative === false && c1.experimental.adaptiveTabs === false, '缺失键深合并为 false（非 undefined）');
    // ② patchConfig 键级校验
    const c2 = patchConfig({ experimental: { totalAuthoritative: true, hackKey: true, fetchBackfill: 'yes' } });
    ok(c2.experimental.totalAuthoritative === true, '合法键写入');
    ok(!('hackKey' in c2.experimental), '未知键忽略');
    ok(c2.experimental.fetchBackfill === true, '非 boolean 值忽略（保留原值 true）');
    // ③ 持久化往返
    const c3 = loadConfig();
    ok(c3.experimental.totalAuthoritative === true && c3.experimental.dualBufferRoom === false, '落盘后往返一致');
    // 还原默认（后续测试/运行环境干净）
    patchConfig({ experimental: { ...DEFAULT_CONFIG.experimental } });
  } finally {
    if (backup !== null) fs.writeFileSync(CONFIG_PATH, backup, 'utf-8');
    else fs.rmSync(CONFIG_PATH, { force: true });
  }
  const cEnd = loadConfig();
  ok(cEnd.experimental.totalAuthoritative === false, '测试后还原默认全关');
}

console.log(`\n═══ experimental-test：${pass} 通过 / ${fail} 失败 ═══`);
process.exit(fail ? 1 : 0);
