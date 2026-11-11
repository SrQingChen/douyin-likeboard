// ─── 单发事件：高能冲刺 / 评论「加入」（录 demo 时手动卡点）───────────
// node scripts/sim-event.mjs --surge                # 给中游用户注入 60 赞（折合 360/分）
// node scripts/sim-event.mjs --surge --top          # 给当前第 1 名注入，领奖台鎏金
// node scripts/sim-event.mjs --surge --user 2 --count 80
// node scripts/sim-event.mjs --chat 加入            # 随机一名榜单用户评论
import WebSocket from 'ws';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const TOKEN = (() => {
  for (const p of [path.resolve(here, '..', '..', 'data', 'runtime-token'), path.resolve(here, '..', 'data', 'runtime-token')]) {
    try { return fs.readFileSync(p, 'utf-8').trim(); } catch {}
  }
  console.error('未找到 data/runtime-token —— 先启动 core');
  process.exit(1);
})();

const args = process.argv.slice(2);
const has = k => args.includes(`--${k}`);
const val = k => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : undefined; };

const wantSurge = has('surge');
const pickTop = has('top');
const chatText = has('chat') ? (val('chat') || '加入') : null;
if (!wantSurge && chatText == null) {
  console.log('用法：node scripts/sim-event.mjs --surge [--top] [--user 0] [--count 60]');
  console.log('      node scripts/sim-event.mjs --chat 加入 [--user 3]');
  process.exit(1);
}

const NAMES = ['星辰', '晚风', '柠檬精', '阿白', '奶盖', '山月', 'Koi', '柚子茶', '老K', '喵呜',
  '长风', '拾贰', '不加糖', '蓝鲸', '77', '冲浪选手', '半夏', '不歪', '热苏打', '岛上书',
  '玛卡巴卡', '流星雨', '大白兔', '与月', '橘子汽水', '夜航星', '小卖部长', '香菜杀手', '落日骑士', 'pp'];
const simUser = i => ({
  secUid: `SIM${String(i).padStart(4, '0')}MS4wLjABCDtest`,
  nick: NAMES[i % NAMES.length] + (i >= NAMES.length ? i : ''),
});

/** 读一帧榜单快照（选当前第 1 名，保证鎏金落在领奖台上） */
function latestBoard(timeoutMs = 2500) {
  return new Promise(resolve => {
    const ws = new WebSocket('ws://127.0.0.1:17730/ws');
    const timer = setTimeout(() => { try { ws.close(); } catch {} resolve(null); }, timeoutMs);
    ws.on('message', raw => {
      try {
        const m = JSON.parse(raw.toString());
        if (m.t === 'board') { clearTimeout(timer); ws.close(); resolve(m); }
      } catch {}
    });
    ws.on('error', () => { clearTimeout(timer); resolve(null); });
  });
}

const snap = await latestBoard();
const rows = snap ? [...(snap.podium ?? []), ...(snap.list ?? [])] : [];

let target;
const userArg = val('user');
if (userArg != null && /^\d+$/.test(userArg)) {
  target = simUser(Number(userArg));
} else if (rows.length) {
  // 冲刺默认挑中游名次：榜单行鎏金 + 前三光环可在同一段 demo 里同时看到
  const picked = wantSurge
    ? (pickTop
        ? rows.find(r => r.rank === 1) ?? rows[0]
        : rows.find(r => r.rank >= 6 && r.rank <= 12) ?? rows.find(r => r.rank >= 4) ?? rows[0])
    : rows.find(r => r.rank >= 4) ?? rows[rows.length - 1];
  target = { secUid: picked.secUid, nick: picked.nick };
} else {
  target = simUser(0);
}

const ws = new WebSocket(`ws://127.0.0.1:17730/agent?token=${encodeURIComponent(TOKEN)}`);
ws.on('open', () => {
  ws.send(JSON.stringify({ t: 'profiles', list: [{ u: target.secUid, nick: target.nick, av: null }] }));
  if (wantSurge) {
    const count = Math.max(1, Number(val('count') ?? 60) | 0);
    ws.send(JSON.stringify({
      t: 'likes', at: Date.now(),
      batch: [{ i: `sim-event-surge-${Date.now()}`, c: count, u: target.secUid, t: 0 }],
    }));
    console.log(`已发送冲刺：${target.nick} +${count} 赞（10s 折合 ${count * 6}/分）`);
  }
  if (chatText != null) {
    ws.send(JSON.stringify({ t: 'chat', u: target.secUid, nick: target.nick, text: chatText, at: Date.now() }));
    console.log(`已发送评论：${target.nick}「${chatText}」`);
  }
  setTimeout(() => { try { ws.close(); } catch {} process.exit(0); }, 400);
});
ws.on('error', e => { console.error('连接 core 失败：', String(e).slice(0, 120)); process.exit(1); });
