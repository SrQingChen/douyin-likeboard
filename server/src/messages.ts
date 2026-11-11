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
  starGuard: boolean;    // 星守护（付费粉丝团高级身份，勋章 URL 含 star_guard）
}

export interface UserProfile {
  secUid: string;
  nick: string;
  avatar: string | null;
  starGuard: boolean;
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

/** 解析 User 结构（f5）：nick(f3)、avatar(f9.f1 repeated string)、secUid(f46 稳定 / f73 轮换)、星守护勋章 */
function parseUser(buf: Buffer): (UserProfile & { masked: boolean }) | null {
  const fs: PBField[] = parseFields(buf);
  // 身份主键：f46 是经典 secUid（1.0.0 / MS4wLjABAAAA...，账号级稳定）；
  // f73 是 1.0.3 格式的轮换令牌（实测同一 uid 42s 内 158 个不同值，跨会话必变），
  // 只在打码用户缺 f46 时兜底 —— 这类用户无法跨消息聚合。
  const secUid = asStr(fld(fs, 46)) || asStr(fld(fs, 73));
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
  // 星守护：粉丝团勋章（f24.data.badge.icons）里会出现
  // star_guard_advanced_badge_N_xmp.png；直接扫 URL 标记，避免跟随 proto 版本漂移。
  const starGuard = buf.toString('latin1').includes('star_guard_');
  return { secUid, nick, avatar: normalizeAvatarUrl(avatar), starGuard, masked: isMasked(nick) };
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
      secUid: user.secUid, nick: user.nick, avatar: user.avatar, starGuard: user.starGuard,
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
      user: user ? { secUid: user.secUid, nick: user.nick, avatar: user.avatar, starGuard: user.starGuard } : null,
      online: asNum(fld(fs, 3)),
    };
  } catch { return { user: null, online: 0 }; }
}

/** WebcastRoomUserSeqMessage：进房初期就会推送，f3=在线人数（f9 是同一数字的字符串兜底）
 *  实测进房 ~4.7s 就能拿到，比等 MemberMessage 快很多。 */
export function parseRoomUserSeq(payload: Buffer): { online: number } {
  try {
    const fs = parseFields(payload);
    const n = asNum(fld(fs, 3));
    if (n > 0) return { online: n };
    const s = Number(asStr(fld(fs, 9)) || 0);
    return { online: Number.isFinite(s) && s > 0 ? s : 0 };
  } catch { return { online: 0 }; }
}

/** WebcastRoomStatsMessage：f5=在线观众数（实测 f4 为 "27在线观众"） */
export function parseRoomStats(payload: Buffer): { online: number } {
  try {
    return { online: asNum(fld(parseFields(payload), 5)) };
  } catch { return { online: 0 }; }
}

/** WebcastChatMessage：user(f2)、文本(f3) → 只取档案（昵称未打码概率高） */
export function parseChat(payload: Buffer): { user: UserProfile | null; content: string } {
  try {
    const fs = parseFields(payload);
    const uRaw = fld(fs, 2);
    const user = isBytes(uRaw) ? parseUser(uRaw) : null;
    return {
      user: user ? { secUid: user.secUid, nick: user.nick, avatar: user.avatar, starGuard: user.starGuard } : null,
      content: asStr(fld(fs, 3)),
    };
  } catch { return { user: null, content: '' }; }
}
