// 去重回归：msgId 正常去重 + 缺失/0 时用 (secUid,total) 兜底
import { Aggregator } from '../src/aggregator.ts';

let pass = 0, fail = 0;
const ok = (c, name, detail = '') => {
  if (c) { pass++; console.log(`  ✅ ${name}${detail ? ' — ' + detail : ''}`); }
  else { fail++; console.error(`  ❌ ${name}${detail ? ' — ' + detail : ''}`); }
};
const a = new Aggregator();
const t = Date.now();
ok(a.addLike('u1', 5, 'm1', 100, t), '首条 msgId=m1 入账');
ok(!a.addLike('u1', 5, 'm1', 100, t + 1), '同一 msgId 被去重');
ok(a.addLike('u2', 3, 'm2', 105, t + 2), '不同 msgId 正常入账');
ok(!a.addLike('u2', 3, 'm2', 105, t + 3), '不同用户的同一 msgId 仍去重（消息级唯一）');
ok(a.addLike('u1', 2, '0', 110, t + 4), 'msgId=0 用 (secUid,total) 兜底入账');
ok(!a.addLike('u1', 2, '0', 110, t + 5), '同一 (secUid,total) 兜底去重');
ok(a.addLike('u1', 2, '0', 112, t + 6), 'total 变化的 0 号消息不被误杀');
ok(a.room.sessionLikes === 12, '本场总赞只累计 5+3+2+2', `actual=${a.room.sessionLikes}`);
console.log(`\n═══ 去重测试：${pass} 通过 / ${fail} 失败 ═══`);
process.exit(fail ? 1 : 0);
