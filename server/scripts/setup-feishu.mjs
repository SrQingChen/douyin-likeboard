// ─── 飞书 MCP 一键配置 ─────────────────────────────────────────────
// 前置：在 https://open.feishu.cn/app 创建自建应用，把 app_id/app_secret 写入
//       <项目根>/.secrets/feishu.json  格式 { "app_id": "cli_xxx", "app_secret": "xxx" }
// 用法：node server/scripts/setup-feishu.mjs [--uninstall]
// 作用：生成 lark-mcp 专用配置 + 注册到 ZCode config.json（自动备份）

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const SECRETS = path.join(ROOT, '.secrets');
const SECRET_FILE = path.join(SECRETS, 'feishu.json');
const LARK_CFG = path.join(SECRETS, 'lark-mcp-config.json');
const ZCODE_CFG = path.join(process.env.APPDATA ?? '', '..', '.zcode', 'cli', 'config.json');
const ZCODE_CFG_ALT = path.join(process.env.USERPROFILE ?? '', '.zcode', 'cli', 'config.json');
const target = fs.existsSync(ZCODE_CFG) ? ZCODE_CFG : ZCODE_CFG_ALT;

// lark-mcp 入口（全局安装位置）
const LARK_ENTRY = 'D:/nodejs-nvm/node_modules/@larksuiteoapi/lark-mcp/dist/index.js';
const NODE_EXE = process.execPath;

const uninstall = process.argv.includes('--uninstall');

if (uninstall) {
  const cfg = JSON.parse(fs.readFileSync(target, 'utf-8'));
  if (cfg?.mcp?.servers?.lark) {
    delete cfg.mcp.servers.lark;
    fs.writeFileSync(target, JSON.stringify(cfg, null, 2), 'utf-8');
    console.log('✓ 已从 ZCode 配置移除 lark MCP（重启 ZCode 生效）');
  } else console.log('lark MCP 未配置，无需移除');
  process.exit(0);
}

// 1. 读凭证
if (!fs.existsSync(SECRET_FILE)) {
  console.error(`✗ 缺少凭证文件：${SECRET_FILE}`);
  console.error('  请创建并填写：{ "app_id": "cli_xxx", "app_secret": "xxx" }');
  process.exit(1);
}
const cred = JSON.parse(fs.readFileSync(SECRET_FILE, 'utf-8'));
if (!cred.app_id || !cred.app_secret) {
  console.error('✗ feishu.json 需包含 app_id 与 app_secret');
  process.exit(1);
}
if (!fs.existsSync(LARK_ENTRY)) {
  console.error(`✗ 未找到 lark-mcp：${LARK_ENTRY}`);
  console.error('  请先运行：npm i -g @larksuiteoapi/lark-mcp --registry=https://registry.npmmirror.com');
  process.exit(1);
}

// 2. 生成 lark-mcp 专用配置（凭证只存在 .secrets/ 内）
fs.mkdirSync(SECRETS, { recursive: true });
const larkCfg = {
  appId: cred.app_id,
  appSecret: cred.app_secret,
  domain: cred.domain ?? 'https://open.feishu.cn',
  tools: ['preset.doc.default', 'preset.light'],
  language: 'zh',
  tokenMode: 'auto',
  mode: 'stdio',
  oauth: true,
  scope: 'offline_access docx:document drive:drive wiki:wiki',
};
fs.writeFileSync(LARK_CFG, JSON.stringify(larkCfg, null, 2), 'utf-8');
console.log('✓ lark-mcp 配置已生成：', LARK_CFG);

// 3. 注册进 ZCode（备份原文件）
if (!fs.existsSync(target)) { console.error('✗ 未找到 ZCode config.json:', target); process.exit(1); }
const backup = `${target}.bak-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '')}`;
fs.copyFileSync(target, backup);
const zcfg = JSON.parse(fs.readFileSync(target, 'utf-8'));
zcfg.mcp = zcfg.mcp ?? { servers: {} };
zcfg.mcp.servers = zcfg.mcp.servers ?? {};
zcfg.mcp.servers.lark = {
  type: 'stdio',
  command: NODE_EXE,
  args: [LARK_ENTRY, 'mcp', '--config', LARK_CFG],
  env: { LARK_MCP_DEBUG: '0' },
  timeoutMs: 300000,
};
fs.writeFileSync(target, JSON.stringify(zcfg, null, 2), 'utf-8');
console.log('✓ 已注册到 ZCode：', target);
console.log('  备份：', backup);
console.log('\n下一步：重启 ZCode（关闭后重新打开）使 MCP 生效。');
console.log('首次调用会弹出飞书 OAuth 授权页，请用你的账号登录并点「授权」。');
