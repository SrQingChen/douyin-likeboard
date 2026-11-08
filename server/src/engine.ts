// ─── 引擎：会话/轮次生命周期 + 结算 + 纪录 + 徽章（docs §5/§6）─────

import { Aggregator, type BoardRow } from './aggregator.js';
import { Store } from './store.js';
import { getConfig } from './config.js';

export interface SettleResult {
  roundIdx: number;
  top: { rank: number; secUid: string; nick: string; likes: number }[];
  ceremony: 'champion' | 'record' | 'normal'; // 全屏彩带 / 轻量 toast 分级
  recordBroken: string | null;
  settleType: string;
}

export interface EngineEvents {
  onToast: (t: { kind: 'settle' | 'milestone' | 'session'; data: unknown }) => void;
  onLog: (msg: string) => void;
}

export class Engine {
  agg = new Aggregator();
  sessionId: number | null = null;
  roundId: number | null = null;
  roundIdx = 0;
  roundStartedAt = 0;
  sessionStartedAt = 0;
  captureState = 'disconnected'; // disconnected|starting|watching|offline|risk|failed
  lastSettleAt = 0;
  private settleTimer: ReturnType<typeof setInterval> | null = null;
  private checkpointTimer: ReturnType<typeof setInterval> | null = null;

  constructor(private store: Store, private ev: EngineEvents) {}

  // ── 捕获状态流 ──
  setCaptureState(s: string, reason?: string) {
    this.captureState = s;
    this.ev.onLog(`捕获状态 → ${s}${reason ? ` (${reason})` : ''}`);
    if (s === 'offline') this.endSession('offline');
  }

  /** capture 上报房间信息（webRid 变化 → 换场） */
  onRoom(webRid: string, anchor: string | null, online: number) {
    if (webRid && webRid !== this.agg.room.webRid) {
      if (this.sessionId) this.endSession('room-switch');
      this.startSession(webRid, anchor);
    }
    if (anchor) this.agg.room.anchor = anchor;
    if (online > 0) this.agg.room.online = online;
  }

  startSession(webRid: string, anchor: string | null) {
    this.agg.resetSession();
    this.sessionBumped.clear();
    this.agg.room.webRid = webRid;
    this.sessionId = this.store.openSession(webRid, anchor);
    this.sessionStartedAt = Date.now();
    this.startRound(1);
    this.ev.onLog(`开场：房间 ${webRid}${anchor ? ` · ${anchor}` : ''}`);
  }

  startRound(idx: number) {
    if (!this.sessionId) return;
    this.roundIdx = idx;
    this.roundId = this.store.openRound(this.sessionId, idx);
    this.roundStartedAt = Date.now();
  }

  /** 终场：结算当前轮 + 关闭 session */
  endSession(reason: string) {
    if (!this.sessionId) return;
    this.settleCurrent(reason === 'room-switch' ? 'session-end' : reason);
    this.store.closeSession(this.sessionId, this.agg.room.sessionLikes, this.countLikers());
    this.ev.onToast({ kind: 'session', data: { webRid: this.agg.room.webRid, reason, total: this.agg.room.sessionLikes } });
    this.sessionId = null; this.roundId = null; this.roundIdx = 0;
  }

  private countLikers(): number {
    let n = 0;
    for (const u of this.agg.users.values()) if (u.sessionLikes > 0) n++;
    return n;
  }

  /** 档案入账（agent/回放共用）：聚合层 + 库档案 + 昵称历史 */
  applyProfile(secUid: string, nick: string, avatar: string | null, atMs = Date.now()) {
    const r = this.agg.updateProfile(secUid, nick, avatar, atMs);
    if (r.created || r.nickChanged) {
      this.store.upsertProfile(secUid, nick, nick.includes('*'), avatar, atMs);
      this.refreshStoreInfoFor([secUid]);
    }
    return r;
  }

  /** 手动立即结算 */
  manualSettle(): SettleResult | null { return this.settleCurrent('manual'); }

  /** 本场已点赞但尚未计入 sessions_seen 的用户（每场每用户只 +1 一次） */
  private sessionBumped = new Set<string>();
  private takeSessionSeen(candidates?: string[]): string[] {
    const out: string[] = [];
    if (candidates) {
      for (const u of candidates) if (!this.sessionBumped.has(u)) { this.sessionBumped.add(u); out.push(u); }
      return out;
    }
    for (const [uid, u] of this.agg.users) {
      if (u.sessionLikes > 0 && !this.sessionBumped.has(uid)) { this.sessionBumped.add(uid); out.push(uid); }
    }
    return out;
  }

  /** 轮结算核心 */
  settleCurrent(settleType: string): SettleResult | null {
    if (!this.roundId || !this.sessionId) return null;
    const ranking = this.agg.roundRanking();
    if (ranking.length === 0) {
      // 空轮：直接结束开新轮（不发奖）
      this.store.settleRound(this.roundId, this.sessionId, [], { top1: null, settleType: 'empty' });
      this.agg.resetRound();
      this.startRound(this.roundIdx + 1);
      this.lastSettleAt = Date.now();
      return null;
    }
    const champions = ranking.filter(r => r.rank === 1).map(r => r.secUid);
    const others = ranking.filter(r => r.rank !== 1).map(r => r.secUid);
    const top1 = champions[0] ?? null;

    // 全局纪录判断（结算前）
    const bestRoundLikes = ranking[0].likes;
    const prevRecord = this.store.getRecord<{ v: number; secUid: string; nick: string; at: number }>('record.round');
    let recordBroken: string | null = null;
    if (!prevRecord || bestRoundLikes > prevRecord.v) recordBroken = 'round';

    this.store.settleRound(this.roundId, this.sessionId, ranking, { top1, settleType });
    this.store.updateStreaks(champions);
    void others;
    this.store.bumpSessionsSeen(this.takeSessionSeen(ranking.map(r => r.secUid)));
    this.store.updateBestSpeeds(this.agg.peakSpeeds());

    // 纪录落库
    const now = Date.now();
    if (recordBroken === 'round') {
      const champAgg = this.agg.profileOf(top1 ?? '');
      this.store.setRecord('record.round', { v: bestRoundLikes, secUid: top1, nick: champAgg?.nickClean ?? champAgg?.nick ?? '', at: now });
    }
    // 连霸纪录
    const streakRow = this.store.getUser(top1 ?? '');
    if (top1 && streakRow) {
      const prevStreak = this.store.getRecord<{ v: number; secUid: string }>('record.streak');
      if (!prevStreak || streakRow.streak > prevStreak.v) {
        this.store.setRecord('record.streak', { v: streakRow.streak, secUid: top1 });
        if (streakRow.streak >= 2 && (!prevStreak || streakRow.streak > prevStreak.v) && prevStreak) recordBroken = recordBroken ?? 'streak';
      }
    }

    this.recomputeBadges();
    this.refreshStoreInfoFor(ranking.slice(0, 60).map(r => r.secUid));

    const top = ranking.slice(0, 6).map(r => {
      const p = this.agg.profileOf(r.secUid);
      return { rank: r.rank, secUid: r.secUid, nick: p ? (p.nickClean ?? p.nick) || '赞友' : '赞友', likes: r.likes };
    });
    const ceremony: 'champion' | 'record' | 'normal' =
      recordBroken ? 'record' : (settleType === 'session-end' || settleType === 'manual') ? 'champion' : 'normal';
    const result: SettleResult = { roundIdx: this.roundIdx, top, ceremony, recordBroken, settleType };

    this.ev.onToast({ kind: 'settle', data: result });
    this.ev.onLog(`第 ${this.roundIdx} 轮结算（${settleType}）：冠军 ${top.find(t => t.rank === 1)?.nick ?? '-'} ${bestRoundLikes} 赞`);

    this.agg.settleRoundCounters();   // 收编本轮到 settledSession 再清零（累计展示防重复计算）
    this.startRound(this.roundIdx + 1);
    this.lastSettleAt = Date.now();
    return result;
  }

  /** 徽章重算（结算时；快照只读冗余字段，避免每秒全库排序）。
   *  优先级：N冠王 > 全库之最（点赞王/亚军×N/季军×N）> 老友·N场 */
  recomputeBadges() {
    // 1. 全员基础徽章重算（冠王 / 老友 / 空）
    this.store.db.prepare(`UPDATE users SET badge =
      CASE WHEN champion > 0 THEN champion || '冠王'
           WHEN sessions_seen >= 5 THEN '老友·' || sessions_seen || '场'
           ELSE NULL END`).run();
    // 2. 全库之最徽章：先清旧持有者，再授新持有者（冠王/老友优先者不覆盖）
    const firsts = this.store.globalFirsts();
    const specials: [string, string | undefined][] = [
      ['累计点赞王', firsts.totalLikes?.secUid],
      [firsts.runner ? `亚军×${firsts.runner.v}` : '', firsts.runner?.secUid],
      [firsts.third ? `季军×${firsts.third.v}` : '', firsts.third?.secUid],
    ];
    for (const [text, uid] of specials) {
      if (!text) continue;
      this.store.db.prepare(`UPDATE users SET badge=NULL WHERE badge=? AND sec_uid IS NOT ?`)
        .run(text, uid ?? '');
      if (uid) this.store.db.prepare(
        `UPDATE users SET badge=? WHERE sec_uid=? AND champion=0 AND sessions_seen < 5`).run(text, uid);
    }
  }

  /** 把库里的累计数据同步进聚合层（新用户入榜/结算后刷新） */
  refreshStoreInfoFor(secUids: string[]) {
    for (const uid of secUids) {
      const row = this.store.getUser(uid);
      if (row) {
        this.agg.setStoreInfo(uid, {
          totalLikes: row.total_likes, champion: row.champion, runner: row.runner,
          third: row.third, badge: row.badge,
        });
        this.agg.markNotRookie(uid);
      }
    }
  }

  /** 点赞入账（agent 调用）+ 新用户库档案同步 */
  addLike(secUid: string, count: number, msgId: string, totalHint: number, atMs: number): boolean {
    if (!this.sessionId) return false; // 无会话（未进房）时丢弃，诚实原则
    const isNew = !this.agg.users.has(secUid);
    const ok = this.agg.addLike(secUid, count, msgId, totalHint, atMs);
    if (ok && isNew) this.refreshStoreInfoFor([secUid]);
    if (ok) this.checkMilestone();
    return ok;
  }

  /** 里程碑：房间本场总赞破 1万/10万/100万（一次性插播） */
  private checkMilestone() {
    const t = this.agg.room.sessionLikes;
    for (const m of [10_000, 100_000, 1_000_000]) {
      if (t >= m && !this.milestoneFired.has(m)) {
        this.milestoneFired.add(m);
        this.ev.onToast({ kind: 'milestone', data: { value: m } });
      }
    }
  }
  private milestoneFired = new Set<number>();

  startTimers() {
    const tickMs = 1000;
    this.settleTimer = setInterval(() => {
      const cfg = getConfig();
      if (!this.sessionId || !this.roundId || cfg.roundMinutes <= 0) return;
      const due = this.roundStartedAt + cfg.roundMinutes * 60_000;
      if (Date.now() >= due) this.settleCurrent('auto');
    }, tickMs);
    this.checkpointTimer = setInterval(() => {
      const cfg = getConfig();
      if (!this.roundId) return;
      const rows = this.agg.roundRows();
      if (rows.length) this.store.checkpointRound(this.roundId, rows);
      const seen = this.takeSessionSeen();
      if (seen.length) this.store.bumpSessionsSeen(seen);
    }, Math.max(10, getConfig().checkpointSec) * 1000);
  }

  stopTimers() {
    if (this.settleTimer) clearInterval(this.settleTimer);
    if (this.checkpointTimer) clearInterval(this.checkpointTimer);
  }

  /** 榜单快照（hub 1s 推送） */
  snapshot(nowMs: number): BoardRow[] {
    const cfg = getConfig();
    return this.agg.board(cfg.rankBasis, cfg.boardCount, nowMs, u => (u.nickClean ?? u.nick) || `赞友${u.secUid.slice(-4)}`);
  }

  /** 纪录池（轮换框数据源；DB 部分带 15s 缓存，内存部分实时） */
  private dbRecordsCache: { at: number; holders: { champion: unknown; runner: unknown; third: unknown } } = { at: 0, holders: { champion: null, runner: null, third: null } };
  records(): Record<string, unknown> {
    if (Date.now() - this.dbRecordsCache.at > 15_000) {
      this.dbRecordsCache = { at: Date.now(), holders: this.store.topHolders() as any };
    }
    const round = this.store.getRecord<{ v: number; secUid: string; nick: string; at: number }>('record.round');
    const streak = this.store.getRecord<{ v: number; secUid: string }>('record.streak');
    const firsts = this.store.statsSummary();
    // 本场极值（内存）
    let sessionMost: { secUid: string; likes: number; nick: string } | null = null;
    let fastest: { secUid: string; speed: number; nick: string } | null = null;
    for (const u of this.agg.users.values()) {
      if (u.sessionLikes > 0 && (!sessionMost || u.sessionLikes > sessionMost.likes))
        sessionMost = { secUid: u.secUid, likes: u.sessionLikes, nick: (u.nickClean ?? u.nick) || '赞友' };
      if (u.peakSpeed > 0 && (!fastest || u.peakSpeed > fastest.speed))
        fastest = { secUid: u.secUid, speed: u.peakSpeed, nick: (u.nickClean ?? u.nick) || '赞友' };
    }
    return {
      roundRecord: round, streakRecord: streak ? { ...streak, nick: this.agg.profileOf(streak.secUid)?.nickClean ?? '' } : null,
      sessionMost, fastest,
      holders: this.dbRecordsCache.holders,
      global: { users: firsts.users, totalLikes: firsts.totalLikes, rounds: firsts.rounds, sessions: firsts.sessions },
    };
  }

  shutdown() {
    this.stopTimers();
    if (this.roundId && this.sessionId) {
      const rows = this.agg.roundRows();
      if (rows.length) this.store.checkpointRound(this.roundId, rows);
    }
    if (this.sessionId) this.endSession('shutdown');
  }
}
