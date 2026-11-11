// ─── Release 打包：多功能点赞统计助手 便携包（零部署，空白机可用）───
// 用法：node --import tsx scripts/package-release.mjs
// 产出：release/LikesStatsAssistant-<ver>-win64-portable.zip + VERSION.json
//
// 依赖清单（完整管线）：
//   runtime/node.exe            便携 Node 运行时
//   server/  src+scripts+node_modules   core 与捕获（tsx 直跑 TS，无构建）
//   ui/      dist(已构建)+src           控制台与榜单页面
//   desktop/ electron 壳 + dist         透明榜单窗口 + 部署进度窗
//   browsers/chromium-1248      无 Chrome 空白机的捕获兜底
//   docs/ LICENSE README.md *.bat      文档与启动器

import fs from 'node:fs';
import path from 'node:path';
import { execSync, spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const VERSION = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.version.json'), 'utf-8')).version;
const NAME = `LikesStatsAssistant-${VERSION}-win64-portable`;
const STAGE = path.join(ROOT, 'release', `LikesStatsAssistant-${VERSION}`);
const ZIP = path.join(ROOT, 'release', `${NAME}.zip`);

const robocopy = (src, dest, opts = '') => {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const r = spawnSync('robocopy', [src, dest, '/E', '/NFL', '/NDL', '/NJH', '/NJS', '/NP', opts], { shell: false });
  // robocopy 退出码 0-7 均为成功
  if (r.status === null || r.status >= 8) throw new Error(`robocopy ${src} → ${dest} 失败 (code=${r.status})`);
};
const copyFile = (src, dest) => { fs.mkdirSync(path.dirname(dest), { recursive: true }); fs.copyFileSync(src, dest); };

console.log(`═══ 多功能点赞统计助手 v${VERSION} 打包 ═══`);
if (fs.existsSync(STAGE)) fs.rmSync(STAGE, { recursive: true, force: true });
fs.mkdirSync(STAGE, { recursive: true });

// 1. 便携 Node 运行时
console.log('[1/8] runtime/node.exe');
copyFile('D:/nodejs-nvm/node.exe', path.join(STAGE, 'runtime', 'node.exe'));

// 2. server（源码 + 全量 node_modules；tsx 在 dependencies，开箱可跑）
console.log('[2/8] server（源码 + 依赖）');
for (const d of ['src', 'scripts', 'testdata']) robocopy(path.join(ROOT, 'server', d), path.join(STAGE, 'server', d));
for (const f of ['package.json', 'package-lock.json', 'tsconfig.json']) copyFile(path.join(ROOT, 'server', f), path.join(STAGE, 'server', f));
robocopy(path.join(ROOT, 'server', 'node_modules'), path.join(STAGE, 'server', 'node_modules'));

// 3. ui（构建产物 + 源码）
console.log('[3/8] ui（dist + 源码）');
robocopy(path.join(ROOT, 'ui', 'dist'), path.join(STAGE, 'ui', 'dist'));
for (const d of ['src']) robocopy(path.join(ROOT, 'ui', d), path.join(STAGE, 'ui', d));
for (const f of ['index.html', 'board.html', 'vite.config.ts', 'package.json', 'package-lock.json']) copyFile(path.join(ROOT, 'ui', f), path.join(STAGE, 'ui', f));

// 4. desktop（Electron 壳 + 运行时）
console.log('[4/8] desktop（Electron）');
for (const f of ['main.js', 'preload.js', 'loading.html', 'setup.html', 'package.json']) copyFile(path.join(ROOT, 'desktop', f), path.join(STAGE, 'desktop', f));
robocopy(path.join(ROOT, 'desktop', 'node_modules', 'electron', 'dist'), path.join(STAGE, 'desktop', 'node_modules', 'electron', 'dist'));
copyFile(path.join(ROOT, 'desktop', 'node_modules', 'electron', 'package.json'), path.join(STAGE, 'desktop', 'node_modules', 'electron', 'package.json'));

// 5. 内置 Chromium（有头捕获兜底；不含 headless_shell）
console.log('[5/8] browsers（chromium + ffmpeg）');
robocopy(path.join(ROOT, 'browsers', 'chromium-1248'), path.join(STAGE, 'browsers', 'chromium-1248'));
robocopy(path.join(ROOT, 'browsers', 'ffmpeg-1013'), path.join(STAGE, 'browsers', 'ffmpeg-1013'));

// 6. 文档 / 启动器 / 协议
console.log('[6/8] docs / README / LICENSE / bat（中文 + ASCII 双名防编码坑）');
robocopy(path.join(ROOT, 'docs'), path.join(STAGE, 'docs'));
copyFile(path.join(ROOT, 'README.md'), path.join(STAGE, 'README.md'));
copyFile(path.join(ROOT, 'LICENSE'), path.join(STAGE, 'LICENSE'));
// 双名：中文给资源管理器体验，ASCII 名防个别解压工具的编码问题（内容相同）
copyFile(path.join(ROOT, '一键启动.bat'), path.join(STAGE, '一键启动.bat'));
copyFile(path.join(ROOT, '一键启动.bat'), path.join(STAGE, 'Start-Assistant.bat'));
copyFile(path.join(ROOT, '打开榜单窗口.bat'), path.join(STAGE, '打开榜单窗口.bat'));
copyFile(path.join(ROOT, '打开榜单窗口.bat'), path.join(STAGE, 'Open-Board-Window.bat'));
copyFile(path.join(ROOT, '打开榜单窗口-OBS兼容.bat'), path.join(STAGE, '打开榜单窗口-OBS兼容.bat'));
copyFile(path.join(ROOT, '打开榜单窗口-OBS兼容.bat'), path.join(STAGE, 'Open-Board-OBS.bat'));

// 7. VERSION.json（水印与出处标记）
console.log('[7/8] VERSION.json（构建水印）');
let commit = 'unknown';
try { commit = execSync('git rev-parse --short HEAD', { cwd: ROOT }).toString().trim(); } catch {}
const versionStamp = {
  name: '多功能点赞统计助手',
  version: VERSION,
  author: 'SrQingChen',
  license: 'GPL-3.0-or-later',
  repository: 'https://github.com/SrQingChen/douyin-likeboard',
  commit,
  builtAt: new Date().toISOString(),
  buildHost: crypto.randomUUID().slice(0, 8),
  channel: 'win64-portable',
};
fs.writeFileSync(path.join(STAGE, 'VERSION.json'), JSON.stringify(versionStamp, null, 2) + '\n', 'utf-8');

// 8. 关键产物校验（缺一不可的防呆自检）
console.log('[8/8] 产物校验');
const must = [
  ['runtime/node.exe'], ['desktop/node_modules/electron/dist/electron.exe'],
  ['server/src/index.ts'], ['server/node_modules/tsx/dist/cli.mjs'],
  ['server/node_modules/better-sqlite3/build/Release/better_sqlite3.node'],
  ['ui/dist/board.html'], ['ui/dist/index.html'],
  ['browsers/chromium-1248/chrome-win64/chrome.exe'],
  ['一键启动.bat'], ['Start-Assistant.bat'], ['Open-Board-Window.bat'], ['Open-Board-OBS.bat'],
  ['LICENSE'], ['VERSION.json'], ['README.md'],
];
const missing = must.filter(([p]) => !fs.existsSync(path.join(STAGE, p)));
if (missing.length) { console.error('❌ 缺失关键产物：', missing.map(m => m[0])); process.exit(1); }
console.log('  ✓ 全部关键产物就位');

// 压缩：PowerShell Compress-Archive（.NET ZipArchive 写 UTF-8 文件名标记，
// 资源管理器 / 7-Zip / WinRAR 解压中文路径均正常；bsdtar 的 zip 无 EFS 标记会乱码）
console.log('压缩 zip（PowerShell，大包需几分钟）…');
fs.rmSync(ZIP, { force: true });
const r = spawnSync('powershell', ['-NoProfile', '-Command',
  `$ProgressPreference='SilentlyContinue'; Compress-Archive -Path '${path.basename(STAGE)}' -DestinationPath '${path.basename(ZIP)}' -CompressionLevel Optimal -Force`],
  { stdio: 'inherit', cwd: path.dirname(STAGE), timeout: 30 * 60 * 1000 });
if (r.status !== 0) { console.error('❌ 压缩失败'); process.exit(1); }
const mb = (fs.statSync(ZIP).size / 1048576).toFixed(1);
console.log(`\n═══ 完成：${ZIP}（${mb} MB）═══`);
