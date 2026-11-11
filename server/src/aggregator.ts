// ─── 聚合引擎：内存实时计数（计数准确性核心，docs §4）──────────────
// 滑动窗口用"带时间戳的环形桶"：写入时校验时间戳（不符则清零重写），
// 读取时按时间过滤 —— 长时间不活跃后的旧数据永远不会污染新窗口。

import { isAuthorSecUid } from './author.js';

export interface BoardRow {
  secUid: string; nick: string; avatar: string | null; badge: string | null;
  likes: number; speed: number; capped: boolean; rank: number;
  storeTotalLikes: number; storeChampion: number; storeRunner: number; storeThird: number;
  surge: boolean;              // 高能冲刺中（10s 窗口折算 ≥ surgeThreshold 赞/分）
  starGuard: boolean;          // 星守护（捕获层从勋章 URL 识别）
  gemColor: string | null;     // 宝石行颜色：null=普通玻璃条；'rainbow'=彩虹流光；#RRGGBB=指定色
}

interface UserAgg {
  secUid: string;
  nick: string;              // 最新昵称（可能打码）
  nickClean: string | null;  // 最近未打码昵称（优先展示）
  avatar: string | null;
  roundLikes: number;
  sessionLikes: number;
  settledSession: number;    // 本场已结算轮次收编的赞数（累计展示扣除，防重复计算）
  rookie: boolean;           // 本场首秀（新星候选）
  knownInStore: boolean;     // 库中已有档案（跨场保持，防"新星"误标）
  secRing: Ring;             // 60 个 1s 桶 → 60s 滑窗速度
  minRing: Ring;             // 60 个 1min 桶 → 1h 滑窗（限额推断）
  peakSpeed: number;
  lastActiveSec: number;
  capped: boolean;
  starGuard: boolean;        // 星守护身份（本场/库中任一为真）
  store: {
    totalLikes: number; champion: number; runner: number; third: number; badge: string | null;
    starGuard: boolean; gemColor: string | null;
  };
}

/** 星守随机宝石色板（每场首次出现时随机取一色，本场稳定） */
const GEM_PALETTE = ['#f43f5e', '#3b82f6', '#10b981', '#8b5cf6', '#f59e0b', '#06b6d4', '#ec4899', '#84cc16', '#e2e8f0'];

const MASK = /\*/;

/** 高能冲刺速度：最近 10 秒点赞数 × 6 折算为 赞/分钟 */
function surgeSpeed(u: UserAgg, nowSec: number): number {
  return u.secRing.sum(nowSec, 10) * 6;
}

/** 时间戳环形桶（写入校验、读取过滤） */
class Ring {
  vals = new Int32Array(60);
  ts = new Int32Array(60); // 0 = 未写
  add(atUnit: number, count: number) {
    const b = atUnit % 60;
    if (this.ts[b] !== atUnit) { this.vals[b] = 0; this.ts[b] = atUnit; }
    this.vals[b] += count;
  }
  /** [atUnit-window+1, atUnit] 区间和 */
  sum(atUnit: number, window: number): number {
    let s = 0;
    for (let b = 0; b < 60; b++) {
      const t = this.ts[b];
      if (t > 0 && atUnit - t < window) s += this.vals[b];
    }
    return s;
  }
}

export class Aggregator {
  users = new Map<string, UserAgg>();
  /** msgId 去重 LRU（插入序淘汰，容量 50000 ≈ 1000msg/s 下 50s 窗口） */
  private seenMsg = new Map<string, 1>();
  private seenCap = 50000;
  private lastGC = 0;

  room = {
    webRid: '', anchor: '', online: 0,
    roomTotal: -1,
    counted: 0, totalDelta: 0,             // 完整度分子/分母
    sessionLikes: 0,
    rateRing: new Ring(),
    peakRate: 0,
    lastMsgAt: 0,
  };

  /** 点赞入账。返回 false = 重复消息被去重丢弃 */
  addLike(secUid: string, count: number, msgId: string, totalHint: number, atMs: number): boolean {
    // 去重键：正常情况下用 msgId（实测双标签收到同一事件的 msgId 完全一致）；
    // 极少数缺失/为 "0" 的消息退回 (secUid, total) —— total 是房间累计值，事件级唯一。
    const key = msgId && msgId !== '0'
      ? msgId
      : (totalHint > 0 ? `t:${secUid}:${totalHint}` : '');
    if (key) {
      if (this.seenMsg.has(key)) return false;
      this.seenMsg.set(key, 1);
      if (this.seenMsg.size > this.seenCap) {
        const first = this.seenMsg.keys().next().value as string;
        this.seenMsg.delete(first);
      }
    }
    const sec = Math.floor(atMs / 1000);
    const u = this.ensureUser(secUid, atMs);
    u.roundLikes += count; u.sessionLikes += count; u.lastActiveSec = sec;
    u.secRing.add(sec, count);
    u.minRing.add(Math.floor(sec / 60), count);

    this.room.sessionLikes += count;
    this.room.lastMsgAt = atMs;
    this.room.rateRing.add(sec, count);
    this.room.counted += count;

    // 完整度：以 totalHint 单调递增差值累计；断崖跳变(>5000)不计缺口、回退则 rebase
    if (totalHint > 0) {
      if (this.room.roomTotal < 0) this.room.roomTotal = totalHint;
      else if (totalHint >= this.room.roomTotal) {
        const d = totalHint - this.room.roomTotal;
        if (d <= 5000) this.room.totalDelta += d;
        this.room.roomTotal = totalHint;
      } else {
        this.room.roomTotal = totalHint; // 回退（重置）：忽略
      }
    }
    return true;
  }

  /** 档案更新（capture 档案分离协议） */
  updateProfile(secUid: string, nick: string, avatar: string | null, starGuard: boolean, atMs: number):
    { created: boolean; nickChanged: boolean; guardChanged: boolean } {
    const existed = this.users.has(secUid);
    const u = this.ensureUser(secUid, atMs);
    let nickChanged = false, guardChanged = false;
    if (nick && nick !== u.nick) {
      u.nick = nick;
      if (!MASK.test(nick)) u.nickClean = nick;
      nickChanged = true;
    }
    if (avatar && avatar !== u.avatar) u.avatar = avatar;
    if (starGuard && !u.starGuard) { u.starGuard = true; guardChanged = true; }
    return { created: !existed, nickChanged, guardChanged };
  }

  setStoreInfo(secUid: string, info: {
    totalLikes: number; champion: number; runner: number; third: number; badge: string | null;
    starGuard: boolean; gemColor: string | null;
  }) {
    const u = this.users.get(secUid);
    if (u) {
      u.store = info; u.knownInStore = true;
      if (info.starGuard) u.starGuard = true;
    }
  }

  markNotRookie(secUid: string) { const u = this.users.get(secUid); if (u) u.rookie = false; }

  private ensureUser(secUid: string, atMs: number): UserAgg {
    let u = this.users.get(secUid);
    if (!u) {
      u = {
        secUid, nick: '', nickClean: null, avatar: null,
        roundLikes: 0, sessionLikes: 0, settledSession: 0,
        rookie: true, knownInStore: false,
        secRing: new Ring(), minRing: new Ring(),
        peakSpeed: 0, lastActiveSec: Math.floor(atMs / 1000), capped: false,
        starGuard: false,
        store: { totalLikes: 0, champion: 0, runner: 0, third: 0, badge: null, starGuard: false, gemColor: null },
      };
      this.users.set(secUid, u);
    }
    return u;
  }

  /** 1s tick：速度峰值/限额推断/房间速率峰值 */
  tick(nowMs: number, cappedThreshold: number) {
    const sec = Math.floor(nowMs / 1000);
    const roomActive = nowMs - this.room.lastMsgAt < 10_000;
    for (const u of this.users.values()) {
      const speed = u.secRing.sum(sec, 60);
      if (speed > u.peakSpeed) u.peakSpeed = speed;
      const idle = sec - u.lastActiveSec;
      // 限额推断（docs/点赞限额机制.md §3.3，推断性标注）：
      // 滚动 1h 赞数 ≥ 阈值 + 60s 停滞 + 房间仍有他人点赞
      u.capped = u.minRing.sum(Math.floor(sec / 60), 60) >= cappedThreshold
        && speed === 0 && roomActive && idle >= 5 && idle <= 3600;
    }
    const rate = this.room.rateRing.sum(sec, 60);
    if (rate > this.room.peakRate) this.room.peakRate = rate;
    this.gcUsers(sec);
  }

  /** 惰性清理：>2h 无活动且无计数意义的用户移出内存（结算数据已落库） */
  private gcUsers(sec: number) {
    if (sec - this.lastGC < 300) return;
    this.lastGC = sec;
    if (this.users.size < 3000) return;
    const cutoff = sec - 7200;
    for (const [k, u] of this.users) {
      if (u.lastActiveSec < cutoff && u.roundLikes === 0 && u.sessionLikes === 0) this.users.delete(k);
    }
  }

  roomRatePerMin(nowMs = Date.now()): number { return this.room.rateRing.sum(Math.floor(nowMs / 1000), 60); }

  /** coverage 百分比（0-100；分母 0 时为 100） */
  coveragePct(): number {
    if (this.room.totalDelta <= 0) return 100;
    return Math.min(100, (this.room.counted / this.room.totalDelta) * 100);
  }

  /** 当前榜单（competition ranking 并列同名次） */
  board(basis: 'round' | 'session', topN: number, nowMs: number, nickOf: (u: UserAgg) => string,
    surgeThreshold = 300): BoardRow[] {
    const sec = Math.floor(nowMs / 1000);
    const key = (u: UserAgg) => basis === 'round' ? u.roundLikes : u.sessionLikes;
    const arr = [...this.users.values()].filter(u => key(u) > 0)
      .sort((a, b) => key(b) - key(a) || a.secUid.localeCompare(b.secUid));
    const rows: BoardRow[] = [];
    let prevLikes = -1, prevRank = 0;
    for (let i = 0; i < Math.min(arr.length, topN + 10); i++) {
      const u = arr[i];
      const likes = key(u);
      const rank = likes === prevLikes ? prevRank : i + 1;
      prevLikes = likes; prevRank = rank;
      rows.push({
        secUid: u.secUid, nick: nickOf(u), avatar: u.avatar,
        // 新星仅给"库中无档案的本场首秀"（knownInStore 跨场保持，防换房误标）
        badge: u.rookie && !u.knownInStore ? (u.store.badge ?? '新星') : u.store.badge,
        likes, speed: u.secRing.sum(sec, 60), capped: u.capped, rank,
        surge: surgeSpeed(u, sec) >= surgeThreshold,
        starGuard: this.isStarGuard(u),
        gemColor: this.gemColorOf(u),
        // 累计 = 库累计 + 本场未结算部分（已结算部分已入库，防重复计算）
        storeTotalLikes: u.store.totalLikes + (u.sessionLikes - u.settledSession),
        storeChampion: u.store.champion, storeRunner: u.store.runner, storeThird: u.store.third,
      });
    }
    return rows;
  }

  /** 星守护：本场捕获到 or 库里曾标记（作者固定视为星守护，用于宝石行） */
  private isStarGuard(u: UserAgg): boolean {
    return isAuthorSecUid(u.secUid) || u.starGuard || u.store.starGuard;
  }

  /** 宝石色：手动指定 > 作者彩虹 > 星守本场随机；非星守返回 null（普通玻璃条） */
  private gemColors = new Map<string, string>();
  private gemColorOf(u: UserAgg): string | null {
    if (!this.isStarGuard(u)) return null;
    if (u.store.gemColor) return u.store.gemColor;
    if (isAuthorSecUid(u.secUid)) return 'rainbow';
    let c = this.gemColors.get(u.secUid);
    if (!c) {
      c = GEM_PALETTE[Math.floor(Math.random() * GEM_PALETTE.length)];
      this.gemColors.set(u.secUid, c);
    }
    return c;
  }

  /** 当前冲刺最快的用户（10s 窗口折算 赞/分；无冲刺返回 null）——横幅用 */
  topSurge(nowMs: number, threshold = 300): { secUid: string; nick: string; avatar: string | null; speed: number } | null {
    const sec = Math.floor(nowMs / 1000);
    let best: { secUid: string; nick: string; avatar: string | null; speed: number } | null = null;
    for (const u of this.users.values()) {
      const s = surgeSpeed(u, sec);
      if (s >= threshold && (!best || s > best.speed)) {
        best = { secUid: u.secUid, nick: (u.nickClean ?? u.nick) || u.secUid.slice(-6), avatar: u.avatar, speed: s };
      }
    }
    return best;
  }

  /** 结算排名视图（settler 用；并列同名次） */
  roundRanking(): { secUid: string; likes: number; rank: number }[] {
    const arr = [...this.users.values()].filter(u => u.roundLikes > 0)
      .sort((a, b) => b.roundLikes - a.roundLikes || a.secUid.localeCompare(b.secUid));
    const out: { secUid: string; likes: number; rank: number }[] = [];
    let prevLikes = -1, prevRank = 0;
    for (let i = 0; i < arr.length; i++) {
      const rank = arr[i].roundLikes === prevLikes ? prevRank : i + 1;
      prevLikes = arr[i].roundLikes; prevRank = rank;
      out.push({ secUid: arr[i].secUid, likes: arr[i].roundLikes, rank });
    }
    return out;
  }

  /** 本轮全部用户（checkpoint 用） */
  roundRows(): { secUid: string; likes: number }[] {
    return [...this.users.values()].filter(u => u.roundLikes > 0)
      .map(u => ({ secUid: u.secUid, likes: u.roundLikes }));
  }

  /** 下一轮开始：本轮计数清零（会话累计与档案保留） */
  resetRound() { for (const u of this.users.values()) u.roundLikes = 0; }

  /** 结算收编：本轮赞数计入 settledSession（累计展示扣除项），再清零本轮 */
  settleRoundCounters() {
    for (const u of this.users.values()) { u.settledSession += u.roundLikes; u.roundLikes = 0; }
  }

  /** 新场开始：会话态清零（档案与 knownInStore 保留），房间与去重窗重置 */
  resetSession() {
    for (const u of this.users.values()) {
      u.sessionLikes = 0; u.settledSession = 0; u.roundLikes = 0;
      u.rookie = true; u.peakSpeed = 0; u.capped = false;
    }
    this.room = {
      webRid: '', anchor: '', online: 0, roomTotal: -1,
      counted: 0, totalDelta: 0, sessionLikes: 0,
      rateRing: new Ring(), peakRate: 0, lastMsgAt: 0,
    };
    this.seenMsg.clear(); // 换房后 msgId 空间独立，清空去重窗防误杀
    this.gemColors.clear(); // 星守随机宝石色：每场首次出现时重新随机
  }

  /** 峰值速度清单（结算时更新 best_speed 用） */
  peakSpeeds(): { secUid: string; speed: number }[] {
    return [...this.users.values()].filter(u => u.peakSpeed > 0)
      .map(u => ({ secUid: u.secUid, speed: u.peakSpeed }));
  }

  profileOf(secUid: string): { nick: string; nickClean: string | null; avatar: string | null } | null {
    const u = this.users.get(secUid);
    return u ? { nick: u.nick, nickClean: u.nickClean, avatar: u.avatar } : null;
  }
}
