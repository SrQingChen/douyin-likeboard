// 星守护回归：识别收紧（精确资产名）+ 作者彩蛋与星守状态解耦 + 手动修正语义
// 运行：node --import tsx scripts/starguard-test.mjs   （server 目录下）
import { Aggregator } from '../src/aggregator.ts';
import { Engine } from '../src/engine.ts';
import { Store } from '../src/store.ts';
import { AUTHOR_SEC_UID } from '../src/author.ts';
import { parseFields, isBytes } from '../src/pb.ts';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

let pass = 0, fail = 0;
const ok = (c, name, detail = '') => {
  if (c) { pass++; console.log(`  ✅ ${name}${detail ? ' — ' + detail : ''}`); }
  else { fail++; console.error(`  ❌ ${name}${detail ? ' — ' + detail : ''}`); }
};

// ── 手工编码 protobuf（wire type 2 = length-delimited）──
const varint = (v) => { const b = []; let x = BigInt(v); for (;;) { let s = Number(x & 0x7fn); x >>= 7n; if (x > 0n) s |= 0x80; b.push(s); if (x === 0n) break; } return b; };
const bytes = (no, payload) => [...varint((no << 3) | 2), ...varint(payload.length), ...payload];
const str = (no, s) => bytes(no, [...Buffer.from(s, 'utf-8')]);

// parseUser 是模块私有，通过 parseLike 的 user(f5) 间接驱动：构造最小 LikeMessage
//   LikeMessage { f5: User { f3 nick, f46 secUid, f24/f61/f78... badge 子树 } }
const { parseLike } = await import('../src/messages.ts');
const mkLike = (userBytes, msgId = 'm1') => Buffer.from([
  ...bytes(1, [...varint((2 << 3) | 0), ...varint(BigInt(msgId.replace(/\D/g, '') || 1))]),  // common.msgId
  ...varint((2 << 3) | 0), ...varint(3n),   // count = 3
  ...varint((3 << 3) | 0), ...varint(100n), // total = 100
  ...bytes(5, userBytes),                   // user
]);

console.log('\n[1] 星守识别：精确资产名（star_guard_advanced_badge）');
{
  const uid = 'MS4wLjABAAAAstarguardtest0000000000000000001';
  const base = [...str(3, '测试星守'), ...str(46, uid)];
  // f24 勋章子树内放真实资产名 → 检出
  const inBadge = parseLike(mkLike(Buffer.from([...base, ...str(24, `https://p3-webcast.douyinpic.com/img/star_guard_advanced_badge_20_xmp.png`)])));
  ok(inBadge?.starGuard === true, '勋章含 star_guard_advanced_badge → 检出');
  // 同 URL 放在 f24 之外的字段（如 f61 入场效果）→ 真实数据里这是同一勋章的冗余分发，也应检出（防漂移：不跟随字段号）
  const inF61 = parseLike(mkLike(Buffer.from([...base, ...str(61, `https://p3-webcast.douyinpic.com/img/star_guard_advanced_badge_20_xmp.png`)])));
  ok(inF61?.starGuard === true, '资产名出现在 f61（勋章冗余字段）→ 仍检出（防 proto 漂移）');
  // 相似效果：URL 只含 star_guard_ 前缀、无 advanced_badge 资产名 → 不检出（防效果误标）
  const fakeEffect = parseLike(mkLike(Buffer.from([...base, ...str(61, `https://p3-webcast.douyinpic.com/img/star_guard_entrance_effect_2026.webp`)])));
  ok(fakeEffect?.starGuard === false, '相似效果 URL（star_guard_ 前缀、无资产名）→ 不检出');
  const fakeBadge2 = parseLike(mkLike(Buffer.from([...base, ...str(24, `https://p3-webcast.douyinpic.com/img/star_guard_badge_v2.png`)])));
  ok(fakeBadge2?.starGuard === false, 'star_guard_badge_v2（非 advanced 资产名）→ 不检出');
}

console.log('\n[2] 作者彩蛋与星守状态解耦（aggregator）');
{
  const a = new Aggregator();
  const t = Date.now();
  a.addLike(AUTHOR_SEC_UID, 10, 'a1', 100, t);
  a.addLike('MS4wLjABAAAAnormaluser00000000000000000000002', 5, 'a2', 105, t + 1);
  a.addLike('MS4wLjABAAAAtureguard000000000000000000000003', 7, 'a3', 112, t + 2);
  a.updateProfile('MS4wLjABAAAAtureguard000000000000000000000003', '真星守', null, true, t + 3);
  const rows = a.board('round', 10, t + 4, u => u.nick || '赞友');
  const author = rows.find(r => r.secUid === AUTHOR_SEC_UID);
  const normal = rows.find(r => r.secUid.endsWith('02'));
  const guard = rows.find(r => r.secUid.endsWith('03'));
  ok(author.starGuard === false, '作者行 starGuard=false（按实际状态，不再强制）');
  ok(author.gemColor === 'rainbow', '作者行宝石色仍为 rainbow（彩蛋保留）');
  ok(normal.starGuard === false && normal.gemColor === null, '普通用户无星守标记、无宝石行');
  ok(guard.starGuard === true, '真星守行 starGuard=true');
  ok(!!guard.gemColor && guard.gemColor !== 'rainbow', '真星守行有本场随机宝石色', guard.gemColor ?? '');
}

console.log('\n[3] 手动星守修正（store+engine 全链路，临时 DB）');
{
  const here = path.dirname(fileURLToPath(import.meta.url));
  const TMP = path.resolve(here, '..', 'testdata', `starguard-tmp-${Date.now()}.db`);
  const store = new Store(TMP);
  const engine = new Engine(store, { onToast: () => {}, onLog: () => {}, onChat: () => {} });
  const t = Date.now();
  const uid = 'MS4wLjABAAAAtureguard000000000000000000000003';
  engine.startSession('999888', '测试主播');
  engine.addLike(uid, 5, 'g1', 100, t);
  engine.applyProfile(uid, '真星守', null, true, t + 1);      // 捕获层上报 → 星守点亮
  engine.addLike(AUTHOR_SEC_UID, 9, 'g2', 109, t + 2);
  engine.applyProfile(AUTHOR_SEC_UID, 'Sr_青尘', null, false, t + 3); // 作者无星守勋章
  let rows = engine.snapshot(t + 4, 10);
  ok(rows.find(r => r.secUid === uid).starGuard === true, '捕获上报后 starGuard=true');
  ok(rows.find(r => r.secUid === AUTHOR_SEC_UID).starGuard === false, '作者无勋章 → starGuard=false');
  engine.applyStarGuardOverride(uid, false);                    // 手动关闭
  rows = engine.snapshot(t + 5, 10);
  const g = rows.find(r => r.secUid === uid);
  ok(g?.starGuard === false && g?.gemColor === null, '手动关闭后 starGuard=false 且无宝石行');
  ok(store.getUser(uid)?.star_guard === 0, 'DB star_guard 已清 0');
  engine.manualSettle();                                        // 结算触发 refreshStoreInfoFor（sticky 回归）
  // 结算后 roundLikes 清零，用户不再上榜单；sticky 语义看聚合器内存：
  // refresh 只会把 starGuard 翻 true 不会翻 false，此处必须保持手动关闭值
  let ug = engine.agg.users.get(uid);
  ok(!!ug && ug.starGuard === false && ug.store.starGuard === false, '结算 refresh 后内存仍为 false（不回弹）');
  engine.applyProfile(uid, '真星守', null, true, t + 7);       // 捕获层再次上报 → 重新点亮（新证据覆盖）
  ug = engine.agg.users.get(uid);
  ok(!!ug && ug.starGuard === true, '再次捕获到星守勋章 → 重新点亮');
  ok(store.getUser(uid)?.star_guard === 1, 'DB 随新证据写回 1');
  engine.shutdown();
  store.close();
  for (const s of [TMP, TMP + '-wal', TMP + '-shm']) try { fs.rmSync(s, { force: true }); } catch {}
}

console.log(`\n═══ 星守测试：${pass} 通过 / ${fail} 失败 ═══`);
process.exit(fail ? 1 : 0);
