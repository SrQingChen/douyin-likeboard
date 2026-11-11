// 用户库清空回归：临时 DB 写入 → wipeUsers → 断言全空
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Store } from '../src/store.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const p = path.resolve(here, '..', '..', 'data', 'test-wipe.db');
for (const f of [p, p + '-wal', p + '-shm']) fs.rmSync(f, { force: true });

const s = new Store(p);
s.upsertProfile('u1', '测试用户', false, null, Date.now());
const sid = s.openSession('12345678', '测试主播');
const rid = s.openRound(sid, 1);
s.checkpointRound(rid, [{ secUid: 'u1', likes: 10 }]);
s.settleRound(rid, sid, [{ secUid: 'u1', likes: 10, rank: 1 }], { top1: 'u1', settleType: 'test' });
s.setRecord('record.round', { v: 10 });

const before = s.statsSummary();
const counts = s.wipeUsers();
const after = s.statsSummary();
const nick = s.nickHistory('u1').length;
s.close();
for (const f of [p, p + '-wal', p + '-shm']) fs.rmSync(f, { force: true });

console.log('before:', before);
console.log('counts:', counts);
console.log('after :', after, 'nicknames:', nick);
const ok = after.users === 0 && after.totalLikes === 0 && after.rounds === 0 && after.sessions === 0 && nick === 0;
console.log(ok ? '✅ wipeUsers 清空成功' : '❌ wipeUsers 仍有残留');
process.exit(ok ? 0 : 1);
