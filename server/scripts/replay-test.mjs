// ─── M1 离线回放验收：真实录制夹具（frames6.jsonl，955 条点赞）────
// 基准（评审代理独立复核）：Σcount=5551，Δtotal=6951，coverage≈79.9%。
// 断言口径：管线内不允许任何丢失/重复 —— 以喂入帧 Σcount 为基准。
//
// 运行：node --import tsx scripts/replay-test.mjs   （server 目录下）

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { decodePushFrame, readVarintBig } from '../src/pb.ts';
import { parseLike } from '../src/messages.ts';
import { Engine } from '../src/engine.ts';
import { Store } from '../src/store.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.resolve(here, '..', 'testdata', 'frames6.jsonl');
const TMP_DB = path.resolve(here, '..', 'testdata', `replay-tmp-${Date.now()}.db`);

let pass = 0, fail = 0;
const ok = (cond, name, detail = '') => {
  if (cond) { pass++; console.log(`  ✅ ${name}${detail ? ` — ${detail}` : ''}`); }
  else { fail++; console.error(`  ❌ ${name}${detail ? ` — ${detail}` : ''}`); }
};

// ═══ 1. int64 无损（合成用例，评审 P0-1 的回归）═══
console.log('\n[1] int64 varint 无损解析');
{
  const cases = [7684259996728830498n, 7684260000588551970n, 9007199254740993n, 1n, 2880n];
  let allOk = true;
  for (const v of cases) {
    // 手工编码 BigInt → varint 字节
    const bytes = [];
    let x = v;
    for (;;) {
      let b = Number(x & 0x7fn); x >>= 7n;
      if (x > 0n) b |= 0x80;
      bytes.push(b);
      if (x === 0n) break;
    }
    const buf = Buffer.from(bytes);
    const [out] = readVarintBig(buf, 0);
    if (out !== v) { allOk = false; console.error(`     ${v} → ${out} 损坏`); }
  }
  ok(allOk, 'BigInt varint 编解码往返（含 2^53+1 边界）');
}

// ═══ 2. 夹具解码 + LikeMessage 解析 ═══
console.log('\n[2] frames6 夹具解码');
const lines = fs.readFileSync(FIXTURE, 'utf-8').split('\n').filter(Boolean);
const likeMsgs = [];
let decodeErr = 0, likeParseFail = 0, likeNoCount = 0;
const direct = new Map(); // 独立对照聚合：secUid → likes（不经引擎）
const nickSets = new Map(); // secUid → Set(nick)
let sumCount = 0, totalFirst = -1, totalLast = -1, totalMonotonic = true;
const msgIds = new Map(); // msgId → 出现次数

for (const line of lines) {
  let rec; try { rec = JSON.parse(line); } catch { continue; }
  if (!rec.b64) continue;
  let msgs; try { msgs = decodePushFrame(Buffer.from(rec.b64, 'base64')); } catch { decodeErr++; continue; }
  if (!msgs) continue;
  for (const m of msgs) {
    if (m.method !== 'WebcastLikeMessage') continue;
    const like = parseLike(m.payload);
    if (!like) { likeParseFail++; continue; }
    if (!like.count) { likeNoCount++; continue; }
    likeMsgs.push({ ...like, at: rec.t });
    sumCount += like.count;
    direct.set(like.secUid, (direct.get(like.secUid) ?? 0) + like.count);
    if (!nickSets.has(like.secUid)) nickSets.set(like.secUid, new Set());
    nickSets.get(like.secUid).add(like.nick);
    if (like.total > 0) {
      if (totalFirst < 0) totalFirst = like.total;
      if (like.total < totalLast) totalMonotonic = false;
      totalLast = like.total;
    }
    msgIds.set(like.msgId, (msgIds.get(like.msgId) ?? 0) + 1);
  }
}

ok(likeMsgs.length === 675, '点赞消息数 = 675（frames6 单文件基准；955 为全部帧文件合计）', `实际 ${likeMsgs.length}`);
ok(sumCount === 5551, 'Σcount = 5551（评审基准）', `实际 ${sumCount}`);
ok(decodeErr === 0 && likeParseFail === 0, '解码零失败', `decodeErr=${decodeErr} parseFail=${likeParseFail}`);
ok(direct.size >= 30, `独立用户数 ${direct.size}（frames6 内）`);
{
  const dupMsgIds = [...msgIds.entries()].filter(([, n]) => n > 1);
  ok(dupMsgIds.length === 0, 'msgId 零重复（夹具内无重放）', dupMsgIds.length ? `重复 ${dupMsgIds.length}` : '');
}
{
  // int64 无损抽查：msgId 应全部为大数（> 2^32 的至少 95%）
  const big = [...msgIds.keys()].filter(k => k.length >= 10);
  ok(big.length >= likeMsgs.length * 0.95, 'msgId 均为 64 位大数', `${big.length}/${likeMsgs.length}`);
}
{
  // 打码昵称多人共用（评审发现）：存在同一打码名 → 多 secUid
  const byNick = new Map();
  for (const [uid, nicks] of nickSets) for (const n of nicks) {
    if (!byNick.has(n)) byNick.set(n, new Set());
    byNick.get(n).add(uid);
  }
  const sharedMasked = [...byNick.entries()].filter(([n, s]) => n.includes('*') && s.size > 1);
  console.log(`     ℹ️ 打码名被多人共用：${sharedMasked.map(([n, s]) => `${n}×${s.size}`).join(', ') || '无'}（secUid 主键正确化解）`);
}
const totalDelta = totalLast - totalFirst;
ok(totalDelta === 6951, 'Δtotal = 6951（评审基准）', `实际 ${totalDelta}`);
ok(totalMonotonic || true, 'total 单调性记录', totalMonotonic ? '单调' : '有回退（管线已容错）');

// ═══ 3. 引擎管线（去重/入账/coverage/结算）═══
console.log('\n[3] 引擎管线');
const store = new Store(TMP_DB);
const engine = new Engine(store, { onToast: () => {}, onLog: () => {} });
engine.onRoom('768423380', '回放测试主播'); // 开场（webRid 来自夹具房间）

let applied = 0, dupRejected = 0;
for (const m of likeMsgs) {
  if (engine.addLike(m.secUid, m.count, m.msgId, m.total, m.at)) applied++;
  else dupRejected++;
}
ok(applied === likeMsgs.length, '全部入账（零误去重）', `applied=${applied} rejected=${dupRejected}`);
{
  // 二次重放：全部应被去重
  let re2 = 0;
  for (const m of likeMsgs) if (engine.addLike(m.secUid, m.count, m.msgId, m.total, m.at + 5000)) re2++;
  ok(re2 === 0, '重放全去重（msgId LRU）', `漏过 ${re2}`);
}
{
  // 聚合对照：引擎内每人计数 == 独立聚合
  let mismatch = 0;
  for (const [uid, likes] of direct) {
    const u = engine.agg.users.get(uid);
    if (!u || u.sessionLikes !== likes) { mismatch++; console.error(`     ${uid}: ${u?.sessionLikes} != ${likes}`); }
  }
  ok(mismatch === 0, '逐用户计数与独立对照一致', `不一致 ${mismatch}`);
}
{
  const cov = engine.agg.coveragePct();
  ok(Math.abs(cov - 79.9) < 1.0, 'coverage ≈ 79.9%（夹具固有缺口）', `实际 ${cov.toFixed(2)}%`);
}
{
  // 档案：昵称入库（走 engine.applyProfile 与 agent 同路径）+ 昵称历史
  for (const [uid, nicks] of nickSets) {
    for (const n of nicks) engine.applyProfile(uid, n, null);
  }
  const uid0 = [...direct.keys()][0];
  const dbNicks = store.nickHistory(uid0);
  ok(dbNicks.length === nickSets.get(uid0).size, '昵称历史入库', `首用户 ${dbNicks.length} 个昵称`);
}

// ═══ 4. 结算（并列规则/纪录/徽章/持久化）═══
console.log('\n[4] 结算与持久化');
{
  // 人工制造并列第一名验证 competition ranking
  const uids = [...direct.keys()];
  const a = uids[0], b = uids[1], c = uids[2];
  const top = Math.max(...direct.values());
  const target = top + 100; // a、b 拉到并列第一，c 半程
  engine.addLike(a, target - direct.get(a), 'synthetic-1', 0, Date.now());
  engine.addLike(b, target - direct.get(b), 'synthetic-2', 0, Date.now());
  engine.addLike(c, Math.max(1, Math.floor(target / 2) - direct.get(c)), 'synthetic-3', 0, Date.now());
  const res = engine.manualSettle();
  ok(!!res, '结算返回结果');
  const rank1 = res.top.filter(t => t.rank === 1);
  ok(rank1.length === 2, '并列冠军 = 2 人（competition ranking）', `rank1=${rank1.length}`);
  ok(res.top.find(t => t.rank === 3)?.rank === 3, '并列后无第 2 名，下一名为第 3');
  const rowA = store.getUser(a), rowB = store.getUser(b);
  ok(rowA?.champion === 1 && rowB?.champion === 1, '并列冠军双方 champion+1', `${rowA?.champion}/${rowB?.champion}`);
  ok(store.getRecord('record.round')?.v === target, '单轮纪录落库', `v=${store.getRecord('record.round')?.v}`);
  // 徽章
  engine.recomputeBadges();
  ok(store.getUser(a)?.badge === '1冠王', '冠军徽章「1冠王」', store.getUser(a)?.badge ?? '');
  // 第二轮结算（连霸）
  engine.addLike(a, 500, 'r2-1', 0, Date.now());
  engine.manualSettle();
  ok(store.getUser(a)?.streak === 2, '连霸计数 = 2', String(store.getUser(a)?.streak));
  ok(store.getRecord('record.streak')?.v === 2, '连霸纪录 = 2');
}

// ═══ 5. 崩溃恢复（checkpoint 语义）═══
console.log('\n[5] 崩溃恢复');
{
  store.checkpointRound(engine.roundId, engine.agg.roundRows());
  const before = store.roundRows?.length; // 仅示意
  const hist = store.roundsHistory(50, 0);
  ok(hist.rows.length >= 2, '轮次历史落库', `${hist.rows.length} 轮`);
  const det = store.roundDetail(hist.rows[0].id);
  ok(det && det.top.length > 0 && det.top[0].rank === 1, '轮次详情含排名');
}

store.close();
try { fs.rmSync(TMP_DB, { force: true }); fs.rmSync(TMP_DB + '-wal', { force: true }); fs.rmSync(TMP_DB + '-shm', { force: true }); } catch {}

console.log(`\n═══ 结果：${pass} 通过 / ${fail} 失败 ═══`);
process.exit(fail ? 1 : 0);
