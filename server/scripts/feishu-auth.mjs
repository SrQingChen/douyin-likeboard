// ─── 飞书 OAuth 授权（本地回调，token 存 .secrets/）────────────────
// 用法：node server/scripts/feishu-auth.mjs
// 流程：起本地 3000 端口 → 打印授权 URL（并尝试打开浏览器）→ 你点授权
//       → 回调换 user_access_token → 存 .secrets/feishu-token.json
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SECRETS = path.resolve(HERE, '..', '..', '.secrets');
const cred = JSON.parse(fs.readFileSync(path.join(SECRETS, 'feishu.json'), 'utf-8'));
const PORT = 3000;
const REDIRECT = `http://localhost:${PORT}/callback`;
const SCOPES = 'docx:document drive:drive';

const authUrl = `https://accounts.feishu.cn/open-apis/authen/v1/authorize?app_id=${encodeURIComponent(cred.app_id)}`
  + `&redirect_uri=${encodeURIComponent(REDIRECT)}`
  + `&scope=${encodeURIComponent(SCOPES)}&state=likeboard`;

console.log('\n═══ 请在浏览器完成飞书授权 ═══\n');
console.log(authUrl);
console.log('\n（若浏览器未自动打开，请手动复制上面链接）\n');
try { spawn('cmd', ['/c', 'start', '', authUrl], { detached: true, stdio: 'ignore' }).unref(); } catch {}

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, `http://localhost:${PORT}`);
  if (u.pathname !== '/callback') { res.writeHead(404); res.end('not found'); return; }
  const code = u.searchParams.get('code');
  if (!code) {
    res.writeHead(400, { 'content-type': 'text/html; charset=utf-8' });
    res.end(`<h2>授权失败</h2><p>${u.searchParams.get('error_description') ?? '未收到 code'}</p>`);
    return;
  }
  try {
    const r = await fetch('https://open.feishu.cn/open-apis/authen/v2/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify({
        grant_type: 'authorization_code',
        client_id: cred.app_id,
        client_secret: cred.app_secret,
        code,
        redirect_uri: REDIRECT,
      }),
    });
    const j = await r.json();
    if (j.code !== 0 || !j.access_token) throw new Error(JSON.stringify(j).slice(0, 400));
    const store = {
      access_token: j.access_token,
      refresh_token: j.refresh_token,
      expires_at: Date.now() + (j.expires_in ?? 7200) * 1000,
      scope: j.scope,
    };
    fs.writeFileSync(path.join(SECRETS, 'feishu-token.json'), JSON.stringify(store, null, 2), 'utf-8');
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end('<h2>✅ 授权成功</h2><p>可以回到 ZCode 了，token 已保存。</p>');
    console.log('\n✅ 授权成功，token 已保存到 .secrets/feishu-token.json');
    setTimeout(() => { server.close(); process.exit(0); }, 600);
  } catch (e) {
    res.writeHead(500, { 'content-type': 'text/html; charset=utf-8' });
    res.end(`<h2>换取 token 失败</h2><pre>${String(e).slice(0, 500)}</pre>`);
    console.error('换 token 失败:', e);
    setTimeout(() => { server.close(); process.exit(1); }, 600);
  }
});
server.listen(PORT, '127.0.0.1', () => console.log(`回调服务器已监听 ${REDIRECT}\n`));
setTimeout(() => { console.error('⏱ 120s 未完成授权，退出'); server.close(); process.exit(2); }, 300_000);
