// ─── 完整 demo：控制台主页 → 透明榜单叠加 → 冲刺/评论/结算演示 ──────
// 前置：core 已启动（127.0.0.1:17730），UI 已 build
// 产物：data/demo/likes-stats-demo-1080p.mp4（约 60~70s，1920×1080）
import { chromium } from 'patchright';
import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const serverDir = path.resolve(here, '..');
const outDir = path.resolve(serverDir, '..', 'data', 'demo');
const rawDir = path.join(outDir, 'raw-full');
fs.rmSync(rawDir, { recursive: true, force: true });
fs.mkdirSync(rawDir, { recursive: true });
fs.mkdirSync(outDir, { recursive: true });

const node = process.execPath;
const t0 = Date.now();
const log = (...a) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1).padStart(6)}s]`, ...a);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const status = async () => (await fetch('http://127.0.0.1:17730/api/status')).json();
const probe = f => Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration',
  '-of', 'default=nw=1:nk=1', f]).toString().trim());

// 1) 模拟直播（每次换独立房间号，保证新场从 0 开始；先跑到 2.5 千赞再录）
const ROOM = String(90000000 + (Date.now() % 90000));
const sim = spawn(node, [
  path.join(here, 'sim-capture.mjs'),
  '--rate', '30', '--users', '18', '--rename', '0', '--calm',
  '--room', ROOM, '--anchor', '多功能点赞统计助手 · 演示直播间',
], { cwd: serverDir, stdio: 'inherit' });
log('演示房间', ROOM);
const simExit = new Promise(r => sim.on('exit', r));

let waited = 0;
while (waited < 75_000) {
  const st = await status();
  // 必须等房间切到本次演示房，避免读到上一场的 sessionLikes 直接放行
  if (st.room.webRid === ROOM && st.room.sessionLikes >= 2_500) break;
  await sleep(1_000); waited += 1_000;
}
await sleep(4_000);
log('数据已就绪，开始分镜录制');

const b = await chromium.launch({ channel: 'chrome', headless: true });
const clips = [];
async function clip(fn, ms) {
  const ctx = await b.newContext({
    viewport: { width: 1920, height: 1080 },
    recordVideo: { dir: rawDir, size: { width: 1920, height: 1080 } },
  });
  const pg = await ctx.newPage();
  await fn(pg);
  await pg.waitForTimeout(ms);
  const video = pg.video();
  await ctx.close();
  clips.push(await video.path());
  log('clip 完成', path.basename(clips.at(-1)));
}

// ── 分镜 0：片头 ──
const titleHtml = `<!doctype html><html><head><meta charset="utf-8"><style>
  html,body{margin:0;width:100%;height:100%;overflow:hidden;background:#070b18;font-family:"PingFang SC","Microsoft YaHei","Noto Sans SC",system-ui,sans-serif}
  .wrap{position:relative;width:100%;height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;overflow:hidden}
  .wrap:before{content:"";position:absolute;inset:-20%;
    background:radial-gradient(45% 40% at 25% 25%,rgba(56,189,248,.20),transparent 70%),
      radial-gradient(50% 45% at 78% 30%,rgba(168,85,247,.22),transparent 70%),
      radial-gradient(55% 45% at 50% 95%,rgba(244,114,182,.14),transparent 70%);
    animation:drift 8s ease-in-out infinite alternate}
  @keyframes drift{to{transform:translate3d(0,-2%,0) scale(1.06)}}
  .k{position:relative;font-size:74px;line-height:1;filter:drop-shadow(0 8px 22px rgba(255,215,106,.35))}
  h1{position:relative;margin:22px 0 0;font-size:64px;letter-spacing:.12em;font-weight:900;
    background:linear-gradient(180deg,#fff6c8,#ffd76a 45%,#e0a51a);-webkit-background-clip:text;background-clip:text;color:transparent}
  p{position:relative;margin:16px 0 0;font-size:19px;color:rgba(255,255,255,.62);letter-spacing:.28em}
  .chips{position:relative;display:flex;gap:12px;margin-top:34px}
  .chip{font-size:14px;color:#ffe9a3;padding:8px 16px;border-radius:999px;background:rgba(255,215,106,.08);border:1px solid rgba(255,215,106,.28)}
  .foot{position:absolute;bottom:38px;font-size:12px;color:rgba(255,255,255,.28);letter-spacing:.18em}
</style></head><body><div class="wrap">
  <div class="k">👑</div>
  <h1>多功能点赞统计助手</h1>
  <p>抖音直播点赞统计 · 实时榜单工具</p>
  <div class="chips"><span class="chip">控制台</span><span class="chip">透明榜单叠加</span><span class="chip">冲刺鎏金 / 评论播报 / 结算</span></div>
  <div class="foot">多功能点赞统计助手 · 演示视频</div>
</div></body></html>`;

await clip(async pg => { await pg.setContent(titleHtml); }, 3_200);

// ── 分镜 1：控制台主页（概览：捕获状态/本场实况/榜单预览/日志）──
await clip(async pg => {
  await pg.goto('http://127.0.0.1:17730/', { waitUntil: 'networkidle', timeout: 20000 }).catch(() => {});
  await pg.waitForTimeout(2000);
  await pg.evaluate(() => {
    const f = document.querySelector('iframe');
    if (f) f.src = '/board?layout=vertical';
  });
  await pg.waitForTimeout(10000);
}, 0);

// ── 分镜 2：透明榜单叠加（OBS / 桌面窗口）──
const liveBg = `
<div id="demo-live-bg">
  <div class="dlg-orb o1"></div><div class="dlg-orb o2"></div><div class="dlg-orb o3"></div>
  <div class="dlg-live">🔴 直播中 · 1,234 人在线</div>
  <div class="dlg-host"><div class="dlg-host-face">🎤</div><div class="dlg-host-label">主播画面<br><span>（示意）</span></div></div>
  <div class="dlg-chat">
    <div class="dlg-msg"><i style="background:#f472b6"></i>观众A：来了来了</div>
    <div class="dlg-msg"><i style="background:#38bdf8"></i>观众B：冲榜！</div>
    <div class="dlg-msg"><i style="background:#fbbf24"></i>观众C：冲榜冲榜！</div>
    <div class="dlg-msg"><i style="background:#a78bfa"></i>观众D：这榜太卷了</div>
  </div>
  <div class="dlg-note">透明榜单叠加效果 · 直播画面为示意</div>
</div>`;
const liveCss = `
<style>
#demo-live-bg{position:fixed;inset:0;z-index:0;overflow:hidden;
  background:
    radial-gradient(60% 60% at 22% 28%,rgba(124,58,237,.38),transparent 70%),
    radial-gradient(46% 46% at 6% 88%,rgba(236,72,153,.24),transparent 70%),
    radial-gradient(40% 40% at 62% 82%,rgba(56,189,248,.14),transparent 70%),
    linear-gradient(135deg,#0b0a1a 0%,#140b24 52%,#04050b 100%)}
#demo-live-bg:after{content:"";position:absolute;inset:0;background:linear-gradient(90deg,rgba(0,0,0,.18),rgba(0,0,0,.55) 70%,rgba(0,0,0,.72))}
.dlg-orb{position:absolute;border-radius:999px;filter:blur(70px);opacity:.5}
.dlg-orb.o1{width:520px;height:520px;left:-120px;top:-120px;background:#7c3aed}
.dlg-orb.o2{width:420px;height:420px;left:520px;top:120px;background:#db2777}
.dlg-orb.o3{width:500px;height:500px;left:180px;bottom:-220px;background:#0ea5e9}
.dlg-live{position:absolute;left:52px;top:44px;z-index:2;font-size:15px;font-weight:700;color:#fecdd3;
  background:rgba(244,63,94,.16);border:1px solid rgba(244,63,94,.45);padding:8px 16px;border-radius:999px;
  box-shadow:0 0 30px rgba(244,63,94,.18)}
.dlg-host{position:absolute;left:16%;top:24%;width:360px;height:360px;border-radius:999px;z-index:2;
  background:radial-gradient(circle at 50% 35%,rgba(255,255,255,.16),rgba(124,58,237,.32) 55%,rgba(12,10,25,.9));
  border:1px solid rgba(255,255,255,.16);display:flex;flex-direction:column;align-items:center;justify-content:center;
  box-shadow:0 30px 90px rgba(0,0,0,.5),inset 0 0 60px rgba(168,85,247,.18)}
.dlg-host-face{font-size:110px;line-height:1;filter:drop-shadow(0 10px 24px rgba(0,0,0,.5))}
.dlg-host-label{margin-top:14px;text-align:center;font-size:15px;color:rgba(255,255,255,.7);letter-spacing:.14em;line-height:1.6}
.dlg-host-label span{font-size:11px;color:rgba(255,255,255,.4)}
.dlg-chat{position:absolute;left:7%;bottom:10%;width:390px;z-index:2;display:flex;flex-direction:column;gap:9px}
.dlg-msg{display:flex;align-items:center;gap:8px;font-size:14px;color:rgba(255,255,255,.82);
  background:rgba(8,10,22,.55);border:1px solid rgba(255,255,255,.10);padding:9px 13px;border-radius:999px;
  backdrop-filter:blur(8px);animation:dlgIn .5s ease both}
.dlg-msg i{width:8px;height:8px;border-radius:999px;flex:0 0 8px}
.dlg-msg:nth-child(2){animation-delay:.15s}.dlg-msg:nth-child(3){animation-delay:.3s}.dlg-msg:nth-child(4){animation-delay:.45s}
@keyframes dlgIn{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}
.dlg-note{position:absolute;left:52px;bottom:34px;z-index:2;font-size:12px;color:rgba(255,255,255,.32);letter-spacing:.12em}
#app{position:relative;z-index:1;display:flex;justify-content:flex-end;padding-right:56px}
#app > div{width:560px;flex:0 0 560px;margin-left:auto !important;margin-right:0 !important}
</style>`;

await clip(async pg => {
  await pg.goto('http://127.0.0.1:17730/board?transparent=1&layout=vertical&max=8',
    { waitUntil: 'domcontentloaded', timeout: 20000 }).catch(() => {});
  await pg.evaluate(({ bg, css }) => {
    const holder = document.createElement('div');
    holder.innerHTML = bg;
    document.body.insertBefore(holder.firstElementChild, document.body.firstChild);
    const st = document.createElement('style');
    st.textContent = css.replace(/<\/?style>/g, '');
    document.head.appendChild(st);
  }, { bg: liveBg, css: liveCss });
  await pg.waitForTimeout(10500);
}, 2_500);

// ── 分镜 3：功能演示（宽屏：评论播报 → 高能冲刺 → 结算）──
await clip(async pg => {
  await pg.goto('http://127.0.0.1:17730/board?layout=wide&max=15',
    { waitUntil: 'networkidle', timeout: 20000 }).catch(() => {});
  await pg.waitForTimeout(6_000);
  execFileSync(node, [path.join(here, 'sim-event.mjs'), '--chat', '加入'], { cwd: serverDir, stdio: 'inherit' });
  await pg.waitForTimeout(5_000);
  execFileSync(node, [path.join(here, 'sim-event.mjs'), '--surge', '--top', '--count', '60'], { cwd: serverDir, stdio: 'inherit' });
  await pg.waitForTimeout(15_000);
  const r = await fetch('http://127.0.0.1:17730/api/settle', { method: 'POST' });
  log('结算', r.status);
  await pg.waitForTimeout(4_000);
}, 0);

// 4) 拼接：裁掉每段启动空白，转 30fps + 淡入淡出
const trims = [0.8, 1.6, 1.2, 1.0];
const durs = clips.map((p, i) => Math.max(0.2, probe(p) - (trims[i] ?? 1)));
const total = durs.reduce((a, b) => a + b, 0);
log('分镜时长', durs.map(d => d.toFixed(1)).join(' + '), '=', total.toFixed(1));
const inputs = clips.flatMap(p => ['-i', p]);
const filters = clips.map((p, i) =>
  `[${i}:v]trim=start=${trims[i] ?? 1},setpts=PTS-STARTPTS[v${i}]`).join(';');
const cat = clips.map((_, i) => `[v${i}]`).join('') + `concat=n=${clips.length}:v=1:a=0[cat]`;
const fadeOut = Math.max(0, total - 1.1).toFixed(2);
const graph = `${filters};${cat};[cat]fps=30,fade=t=in:st=0:d=0.5,fade=t=out:st=${fadeOut}:d=0.9,format=yuv420p[v]`;
const mp4 = path.join(outDir, 'likes-stats-demo-1080p.mp4');
execFileSync('ffmpeg', ['-y', ...inputs, '-filter_complex', graph, '-map', '[v]',
  '-c:v', 'libx264', '-preset', 'medium', '-crf', '20', '-movflags', '+faststart', '-an', mp4],
{ stdio: 'inherit' });

sim.kill();
await Promise.race([simExit, sleep(3000)]).catch(() => {});
const outDur = probe(mp4);
log('MP4 完成', mp4, `${(fs.statSync(mp4).size / 1048576).toFixed(1)}MB`, `${outDur.toFixed(1)}s`);
await b.close();
