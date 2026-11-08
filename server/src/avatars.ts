// ─── 头像缓存：按 secUid 归档磁盘，URL 归一化比对，变化才重下 ───────
import fs from 'node:fs';
import path from 'node:path';
import { AVATAR_DIR } from './config.js';

const inflight = new Map<string, Promise<boolean>>();
const failedUntil = new Map<string, number>();
const FAIL_RETRY_MS = 10 * 60_000;

export function avatarPath(secUid: string): string {
  // secUid 是 base64 域字符集（字母数字-_），做一层防御性清洗防路径穿越
  const safe = secUid.replace(/[^A-Za-z0-9_-]/g, '');
  return path.join(AVATAR_DIR, `${safe}.jpg`);
}

export function hasAvatar(secUid: string): boolean {
  try { return fs.statSync(avatarPath(secUid)).size > 0; } catch { return false; }
}

/** 异步下载头像（并发去重、失败退避）。成功返回 true。 */
export function downloadAvatar(secUid: string, url: string): Promise<boolean> {
  if (inflight.has(secUid)) return inflight.get(secUid)!;
  const until = failedUntil.get(secUid) ?? 0;
  if (Date.now() < until) return Promise.resolve(false);
  const p = (async () => {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 8000);
      const res = await fetch(url, { signal: ctrl.signal, headers: { 'User-Agent': 'Mozilla/5.0' } });
      clearTimeout(timer);
      if (!res.ok) throw new Error(String(res.status));
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length < 64) throw new Error('too small');
      fs.mkdirSync(AVATAR_DIR, { recursive: true });
      const tmp = avatarPath(secUid) + '.tmp';
      fs.writeFileSync(tmp, buf);
      fs.renameSync(tmp, avatarPath(secUid));
      return true;
    } catch {
      failedUntil.set(secUid, Date.now() + FAIL_RETRY_MS);
      return false;
    } finally {
      inflight.delete(secUid);
    }
  })();
  inflight.set(secUid, p);
  return p;
}

/** 头像获取入口：本地有→true；无→后台下载，先 false（前端占位，稍后快照自然刷新） */
export function ensureAvatar(secUid: string, url: string | null): boolean {
  if (hasAvatar(secUid)) return true;
  if (url) void downloadAvatar(secUid, url);
  return false;
}
