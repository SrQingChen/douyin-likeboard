// ─── webcast 消息解析（字段树见 docs/调研报告-抖音红包项目.md §4）───
// 全部防御式：字段缺失/类型异常时给安全默认，绝不抛错（洪峰流里一条坏消息
// 不能拖垮管线）。

import { asBig, asNum, asStr, fld, fldAll, isBytes, parseFields, type PBField } from './pb.js';

export interface LikeMsg {
  msgId: string;        // 去重键：String(BigInt)，64 位无损
  roomId: string;
  count: number;        // 本条点赞数
  total: number;        // 房间累计点赞总数
  secUid: string;       // 用户唯一键
  nick: string;
  avatar: string | null; // 归一化 URL
}

export interface UserProfile {
  secUid: string;
  nick: string;
  avatar: string | null;
}

/** URL 归一化：去 query/hash（CDN 多域名/签名变体归一，减少无谓重下载） */
export function normalizeAvatarUrl(u: string | null): string | null {
  if (!u) return null;
  try {
    const s = u.trim();
    if (!/^https?:\/\//.test(s)) return s;
    const q = s.indexOf('?'); return (q >= 0 ? s.slice(0, q) : s);
  } catch { return u; }
}

const isMasked = (nick: string) => nick.includes('*');

/** 解析 User 结构（f5）：nick(f3)、avatar(f9.f1 repeated string)、secUid(f73) */
function parseUser(buf: Buffer): (UserProfile & { masked: boolean }) | null {
  const fs: PBField[] = parseFields(buf);
  const secUid = asStr(fld(fs, 73));
  if (!secUid) return null;
  let nick = asStr(fld(fs, 3));
  let avatar: string | null = null;
  const av = fld(fs, 9);
  if (isBytes(av)) {
    // f9.f1 是**直接的 repeated string URL 列表**（评审勘误：非嵌套 Image.url_list）
    const urls = fldAll(parseFields(av), 1).map(asStr).filter(Boolean);
    avatar = urls.length ? urls[0] : null;
  }
  if (!nick) nick = secUid.slice(-6); // 极端兜底
  return { secUid, nick, avatar: normalizeAvatarUrl(avatar), masked: isMasked(nick) };
}

/** WebcastLikeMessage：msgId(f1.f2) count(f2) total(f3) user(f5) */
export function parseLike(payload: Buffer): LikeMsg | null {
  try {
    const fs = parseFields(payload);
    const common = fld(fs, 1);
    let msgId = '', roomId = '';
    if (isBytes(common)) {
      const cf = parseFields(common);
      msgId = String(asBig(fld(cf, 2)));   // int64 → 字符串键，无损
      roomId = String(asBig(fld(cf, 3)));
    }
    const userRaw = fld(fs, 5);
    const user = isBytes(userRaw) ? parseUser(userRaw) : null;
    if (!user) return null;                // 无 secUid 的点赞无法归属，丢弃（诚实计数）
    return {
      msgId, roomId,
      count: Math.max(0, asNum(fld(fs, 2))),
      total: asNum(fld(fs, 3)),
      secUid: user.secUid, nick: user.nick, avatar: user.avatar,
    };
  } catch { return null; }
}

/** WebcastMemberMessage：user(f2)、当前人数(f3) → 补档案 + 在线数 */
export function parseMember(payload: Buffer): { user: UserProfile | null; online: number } {
  try {
    const fs = parseFields(payload);
    const uRaw = fld(fs, 2);
    const user = isBytes(uRaw) ? parseUser(uRaw) : null;
    return {
      user: user ? { secUid: user.secUid, nick: user.nick, avatar: user.avatar } : null,
      online: asNum(fld(fs, 3)),
    };
  } catch { return { user: null, online: 0 }; }
}

/** WebcastChatMessage：user(f2)、文本(f3) → 只取档案（昵称未打码概率高） */
export function parseChat(payload: Buffer): { user: UserProfile | null; content: string } {
  try {
    const fs = parseFields(payload);
    const uRaw = fld(fs, 2);
    const user = isBytes(uRaw) ? parseUser(uRaw) : null;
    return {
      user: user ? { secUid: user.secUid, nick: user.nick, avatar: user.avatar } : null,
      content: asStr(fld(fs, 3)),
    };
  } catch { return { user: null, content: '' }; }
}
