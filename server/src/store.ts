// ─── 持久层：better-sqlite3（WAL）──────────────────────────────────
// 设计原则（docs/开发方案.md §8）：只存聚合与结算结果，不存原始事件流。

import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';

export interface UserRow {
  sec_uid: string; nick: string; nick_clean: string | null; avatar: string | null;
  first_seen: number; last_seen: number; total_likes: number;
  champion: number; runner: number; third: number;
  best_speed: number; streak: number; sessions_seen: number; rounds_seen: number;
  badge: string | null;
  star_guard: number; gem_color: string | null;
}
export interface RoundRow {
  id: number; session_id: number; idx: number; started_at: number; ended_at: number | null;
  settle_type: string | null; top1_sec_uid: string | null;
}
export interface Holder { secUid: string; nick: string; v: number }

export class Store {
  db: Database.Database;

  constructor(dbPath: string) {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('synchronous = NORMAL');
    this.migrate();
    this.bootRecover();
  }

  private migrate() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS users (
        sec_uid TEXT PRIMARY KEY,
        nick TEXT NOT NULL,
        nick_clean TEXT,
        avatar TEXT,
        first_seen INTEGER NOT NULL,
        last_seen INTEGER NOT NULL,
        total_likes INTEGER NOT NULL DEFAULT 0,
        champion INTEGER NOT NULL DEFAULT 0,
        runner INTEGER NOT NULL DEFAULT 0,
        third INTEGER NOT NULL DEFAULT 0,
        best_speed INTEGER NOT NULL DEFAULT 0,
        streak INTEGER NOT NULL DEFAULT 0,
        sessions_seen INTEGER NOT NULL DEFAULT 0,
        rounds_seen INTEGER NOT NULL DEFAULT 0,
        badge TEXT,
        star_guard INTEGER NOT NULL DEFAULT 0,
        gem_color TEXT
      );
      CREATE TABLE IF NOT EXISTS nicknames (
        sec_uid TEXT NOT NULL,
        nick TEXT NOT NULL,
        masked INTEGER NOT NULL DEFAULT 0,
        first_at INTEGER NOT NULL,
        last_at INTEGER NOT NULL,
        hits INTEGER NOT NULL DEFAULT 1,
        PRIMARY KEY (sec_uid, nick)
      );
      CREATE TABLE IF NOT EXISTS sessions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        web_rid TEXT, anchor TEXT,
        started_at INTEGER NOT NULL, ended_at INTEGER NOT NULL,
        total_likes INTEGER NOT NULL DEFAULT 0,
        likers INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE IF NOT EXISTS rounds (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id INTEGER NOT NULL,
        idx INTEGER NOT NULL,
        started_at INTEGER NOT NULL,
        ended_at INTEGER,
        settle_type TEXT,
        top1_sec_uid TEXT
      );
      CREATE TABLE IF NOT EXISTS round_users (
        round_id INTEGER NOT NULL,
        sec_uid TEXT NOT NULL,
        likes INTEGER NOT NULL,
        rank INTEGER,
        PRIMARY KEY (round_id, sec_uid)
      );
      CREATE TABLE IF NOT EXISTS kv (
        key TEXT PRIMARY KEY, value TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_ru_round ON round_users(round_id);
      CREATE INDEX IF NOT EXISTS idx_round_session ON rounds(session_id);
      CREATE INDEX IF NOT EXISTS idx_nick_user ON nicknames(sec_uid);
    `);
    // 增量列（旧库升级）：星守护状态 + 手动宝石配色（null=跟随默认/随机）
    const cols = (this.db.prepare(`PRAGMA table_info(users)`).all() as { name: string }[]).map(c => c.name);
    if (!cols.includes('star_guard')) this.db.exec(`ALTER TABLE users ADD COLUMN star_guard INTEGER NOT NULL DEFAULT 0`);
    if (!cols.includes('gem_color')) this.db.exec(`ALTER TABLE users ADD COLUMN gem_color TEXT`);
  }

  /** 启动恢复：上次异常退出留下的开放 session/round 标记为 interrupted（不发奖，诚实原则）。
   *  会话汇总从轮次明细回填（验证 P1-③：不能只写 ended_at 导致 total_likes/likers 归零） */
  private bootRecover() {
    const now = Date.now();
    const openRounds = this.db.prepare(
      `SELECT id FROM rounds WHERE ended_at IS NULL`).all() as { id: number }[];
    if (openRounds.length) {
      const st = this.db.prepare(`UPDATE rounds SET ended_at=?, settle_type='interrupted' WHERE id=?`);
      const tx = this.db.transaction(() => {
        for (const r of openRounds) st.run(now, r.id);
      }); tx();
    }
    const openSessions = this.db.prepare(
      `SELECT id FROM sessions WHERE ended_at = 0 OR ended_at IS NULL`).all() as { id: number }[];
    if (openSessions.length) {
      const st = this.db.prepare(`
        UPDATE sessions SET ended_at=?,
          total_likes = (SELECT COALESCE(SUM(ru.likes),0) FROM round_users ru
                         JOIN rounds r ON r.id = ru.round_id WHERE r.session_id = sessions.id),
          likers = (SELECT COUNT(DISTINCT ru.sec_uid) FROM round_users ru
                    JOIN rounds r ON r.id = ru.round_id WHERE r.session_id = sessions.id)
        WHERE id=?`);
      const tx = this.db.transaction(() => { for (const s of openSessions) st.run(now, s.id); }); tx();
    }
  }

  // ── 用户档案 ──
  upsertProfile(secUid: string, nick: string, masked: boolean, avatar: string | null, at: number, starGuard = false) {
    const cur = this.db.prepare(`SELECT nick, nick_clean, avatar FROM users WHERE sec_uid=?`).get(secUid) as
      { nick: string; nick_clean: string | null; avatar: string | null } | undefined;
    const sg = starGuard ? 1 : 0;
    if (!cur) {
      this.db.prepare(`
        INSERT INTO users (sec_uid, nick, nick_clean, avatar, first_seen, last_seen, star_guard)
        VALUES (?,?,?,?,?,?,?)`).run(secUid, nick, masked ? null : nick, avatar, at, at, sg);
    } else {
      const clean = masked ? cur.nick_clean : nick;
      this.db.prepare(`UPDATE users SET nick=?, nick_clean=COALESCE(?, nick_clean), avatar=COALESCE(?, avatar),
        last_seen=?, star_guard=MAX(star_guard, ?) WHERE sec_uid=?`)
        .run(nick, clean, avatar, at, sg, secUid);
    }
    // 昵称历史（含本次昵称的 last_at/hits 更新）
    this.db.prepare(`
      INSERT INTO nicknames (sec_uid, nick, masked, first_at, last_at, hits) VALUES (?,?,?,?,?,1)
      ON CONFLICT(sec_uid, nick) DO UPDATE SET last_at=excluded.last_at, hits=hits+1`)
      .run(secUid, nick, masked ? 1 : 0, at, at);
  }

  getUser(secUid: string): UserRow | undefined {
    return this.db.prepare(`SELECT * FROM users WHERE sec_uid=?`).get(secUid) as UserRow | undefined;
  }

  /** 手动宝石配色：null=跟随默认（星守每场随机），'rainbow'=彩虹流光 */
  setGemColor(secUid: string, color: string | null) {
    this.db.prepare(`UPDATE users SET gem_color=? WHERE sec_uid=?`).run(color, secUid);
  }
  getUsers(secUids: string[]): (UserRow | undefined)[] {
    const st = this.db.prepare(`SELECT * FROM users WHERE sec_uid=?`);
    return secUids.map(u => st.get(u) as UserRow | undefined);
  }

  nickHistory(secUid: string): { nick: string; masked: number; first_at: number; last_at: number; hits: number }[] {
    return this.db.prepare(
      `SELECT nick, masked, first_at, last_at, hits FROM nicknames WHERE sec_uid=? ORDER BY last_at DESC`)
      .all(secUid) as any[];
  }

  searchUsers(q: string, sort: string, limit: number, offset: number): { total: number; rows: UserRow[] } {
    const where = q ? `WHERE nick LIKE ? OR sec_uid LIKE ?` : '';
    const params = q ? [`%${q}%`, `%${q}%`] : [];
    const total = (this.db.prepare(
      `SELECT COUNT(*) c FROM users ${where}`).get(...params) as any).c;
    const orderMap: Record<string, string> = {
      total_likes: 'total_likes DESC', champion: 'champion DESC, total_likes DESC',
      runner: 'runner DESC, total_likes DESC', third: 'third DESC, total_likes DESC',
      best_speed: 'best_speed DESC', last_seen: 'last_seen DESC', first_seen: 'first_seen ASC',
    };
    const order = orderMap[sort] ?? 'total_likes DESC';
    const rows = this.db.prepare(
      `SELECT * FROM users ${where} ORDER BY ${order} LIMIT ? OFFSET ?`).all(...params, limit, offset) as UserRow[];
    return { total, rows };
  }

  // ── 会话 / 轮次 ──
  openSession(webRid: string, anchor: string | null): number {
    const r = this.db.prepare(
      `INSERT INTO sessions (web_rid, anchor, started_at, ended_at, total_likes, likers) VALUES (?,?,?,0,0,0)`)
      .run(webRid, anchor, Date.now());
    return Number(r.lastInsertRowid);
  }
  closeSession(id: number, totalLikes: number, likers: number) {
    this.db.prepare(`UPDATE sessions SET ended_at=?, total_likes=?, likers=? WHERE id=?`)
      .run(Date.now(), totalLikes, likers, id);
  }
  openRound(sessionId: number, idx: number): number {
    const r = this.db.prepare(
      `INSERT INTO rounds (session_id, idx, started_at) VALUES (?,?,?)`).run(sessionId, idx, Date.now());
    return Number(r.lastInsertRowid);
  }

  /** 轮内 checkpoint：增量 upsert 当前轮各用户点赞（崩溃恢复点，rank 留空） */
  checkpointRound(roundId: number, rows: { secUid: string; likes: number }[]) {
    const st = this.db.prepare(`
      INSERT INTO round_users (round_id, sec_uid, likes) VALUES (?,?,?)
      ON CONFLICT(round_id, sec_uid) DO UPDATE SET likes=excluded.likes`);
    const tx = this.db.transaction(() => { for (const r of rows) st.run(roundId, r.secUid, r.likes); });
    tx();
  }

  /** 结算：写终 rank、结束轮、更新用户累计与勋章、标记 session 参与场数 */
  settleRound(roundId: number, sessionId: number, rows: { secUid: string; likes: number; rank: number }[],
    opts: { top1: string | null; settleType: string }) {
    const now = Date.now();
    // upsert：未跑过 checkpoint 的轮次无行可 UPDATE，结算必须自足写入
    const updRu = this.db.prepare(`
      INSERT INTO round_users (round_id, sec_uid, likes, rank) VALUES (?,?,?,?)
      ON CONFLICT(round_id, sec_uid) DO UPDATE SET likes=excluded.likes, rank=excluded.rank`);
    const updUser = this.db.prepare(`
      UPDATE users SET total_likes=total_likes+?, champion=champion+?, runner=runner+?, third=third+?,
        rounds_seen=rounds_seen+1, last_seen=?
      WHERE sec_uid=?`);
    const tx = this.db.transaction(() => {
      this.db.prepare(`UPDATE rounds SET ended_at=?, settle_type=?, top1_sec_uid=? WHERE id=?`)
        .run(now, opts.settleType, opts.top1, roundId);
      for (const r of rows) {
        updRu.run(roundId, r.secUid, r.likes, r.rank);
        updUser.run(r.likes, r.rank === 1 ? 1 : 0, r.rank === 2 ? 1 : 0, r.rank === 3 ? 1 : 0, now, r.secUid);
      }
    });
    tx();
  }

  /** 场内新参与用户 sessions_seen+1（每场一次，由聚合层标记后调用） */
  bumpSessionsSeen(secUids: string[]) {
    if (!secUids.length) return;
    const st = this.db.prepare(`UPDATE users SET sessions_seen=sessions_seen+1 WHERE sec_uid=?`);
    const tx = this.db.transaction(() => { for (const u of secUids) st.run(u); }); tx();
  }

  /** 连霸语义（验证 P1-② 修正）：连续轮冠军——缺轮即断。先给本轮冠军 +1，再清零其余全部用户 */
  updateStreaks(champions: string[]) {
    const up = this.db.prepare(`UPDATE users SET streak=streak+1 WHERE sec_uid=?`);
    const down = this.db.prepare(`UPDATE users SET streak=0 WHERE sec_uid NOT IN (${champions.map(() => '?').join(',') || "''"})`);
    const tx = this.db.transaction(() => {
      for (const c of champions) up.run(c);
      down.run(...champions);
    }); tx();
  }
  updateBestSpeeds(rows: { secUid: string; speed: number }[]) {
    if (!rows.length) return;
    const st = this.db.prepare(`UPDATE users SET best_speed=MAX(best_speed, ?) WHERE sec_uid=?`);
    const tx = this.db.transaction(() => { for (const r of rows) st.run(r.speed, r.secUid); }); tx();
  }
  setBadges(rows: { secUid: string; badge: string | null }[]) {
    const st = this.db.prepare(`UPDATE users SET badge=? WHERE sec_uid=?`);
    const tx = this.db.transaction(() => { for (const r of rows) st.run(r.badge, r.secUid); }); tx();
  }

  roundsHistory(limit: number, offset: number): { total: number; rows: (RoundRow & { top1_nick: string | null; web_rid: string | null })[] } {
    const total = (this.db.prepare(`SELECT COUNT(*) c FROM rounds WHERE ended_at IS NOT NULL`).get() as any).c;
    const rows = this.db.prepare(`
      SELECT r.*, u.nick AS top1_nick, s.web_rid,
        (SELECT likes FROM round_users WHERE round_id = r.id AND rank = 1 ORDER BY likes DESC LIMIT 1) AS top1_likes
      FROM rounds r
      LEFT JOIN users u ON u.sec_uid = r.top1_sec_uid
      LEFT JOIN sessions s ON s.id = r.session_id
      WHERE r.ended_at IS NOT NULL ORDER BY r.ended_at DESC LIMIT ? OFFSET ?`)
      .all(limit, offset) as any[];
    return { total, rows };
  }
  roundDetail(roundId: number): { round: RoundRow; top: { sec_uid: string; nick: string; likes: number; rank: number; avatar: string | null }[] } | null {
    const round = this.db.prepare(`SELECT * FROM rounds WHERE id=?`).get(roundId) as RoundRow | undefined;
    if (!round) return null;
    const top = this.db.prepare(`
      SELECT ru.sec_uid, u.nick, u.avatar, ru.likes, ru.rank FROM round_users ru
      LEFT JOIN users u ON u.sec_uid = ru.sec_uid
      WHERE ru.round_id=? AND ru.rank IS NOT NULL ORDER BY ru.rank ASC, ru.likes DESC LIMIT 20`)
      .all(roundId) as any[];
    return { round, top };
  }

  // ── 全局纪录（kv）──
  getRecord<T>(key: string): T | null {
    const r = this.db.prepare(`SELECT value FROM kv WHERE key=?`).get(key) as { value: string } | undefined;
    if (!r) return null;
    try { return JSON.parse(r.value) as T; } catch { return null; }
  }
  setRecord(key: string, value: unknown) {
    this.db.prepare(`INSERT INTO kv (key, value) VALUES (?,?)
      ON CONFLICT(key) DO UPDATE SET value=excluded.value`).run(key, JSON.stringify(value));
  }

  /** 轮换框"全库之最"持有者（昵称取 nick_clean 优先） */
  topHolders(): { champion: Holder | null; runner: Holder | null; third: Holder | null } {
    const q = (sql: string) => this.db.prepare(sql).get() as Holder | undefined;
    return {
      champion: q(`SELECT sec_uid AS secUid, COALESCE(nick_clean, nick) AS nick, champion AS v FROM users WHERE champion > 0 ORDER BY champion DESC, total_likes DESC LIMIT 1`) ?? null,
      runner: q(`SELECT sec_uid AS secUid, COALESCE(nick_clean, nick) AS nick, runner AS v FROM users WHERE runner >= 2 ORDER BY runner DESC, total_likes DESC LIMIT 1`) ?? null,
      third: q(`SELECT sec_uid AS secUid, COALESCE(nick_clean, nick) AS nick, third AS v FROM users WHERE third >= 2 ORDER BY third DESC, total_likes DESC LIMIT 1`) ?? null,
    };
  }

  /** 徽章计算所需的"全库之最" */
  globalFirsts(): { totalLikes: { secUid: string; v: number } | null; runner: { secUid: string; v: number } | null; third: { secUid: string; v: number } | null } {
    const q = (sql: string) => this.db.prepare(sql).get() as any;
    return {
      totalLikes: q(`SELECT sec_uid AS secUid, total_likes AS v FROM users WHERE total_likes > 0 ORDER BY total_likes DESC, first_seen ASC LIMIT 1`) ?? null,
      runner: q(`SELECT sec_uid AS secUid, runner AS v FROM users WHERE runner >= 2 ORDER BY runner DESC, first_seen ASC LIMIT 1`) ?? null,
      third: q(`SELECT sec_uid AS secUid, third AS v FROM users WHERE third >= 2 ORDER BY third DESC, first_seen ASC LIMIT 1`) ?? null,
    };
  }
  statsSummary(): { users: number; totalLikes: number; rounds: number; sessions: number } {
    const u = this.db.prepare(`SELECT COUNT(*) c, COALESCE(SUM(total_likes),0) s FROM users`).get() as any;
    const r = (this.db.prepare(`SELECT COUNT(*) c FROM rounds WHERE ended_at IS NOT NULL`).get() as any).c;
    const s = (this.db.prepare(`SELECT COUNT(*) c FROM sessions WHERE ended_at > 0`).get() as any).c;
    return { users: u.c, totalLikes: u.s, rounds: r, sessions: s };
  }

  /** 清空用户库（用户/昵称/场次/轮次/明细/纪录）；保留设置、登录态与程序文件。
   *  只清用户数据，不删 config.json / runtime-token / chrome-profile。 */
  wipeUsers(): { users: number; nicknames: number; sessions: number; rounds: number } {
    const count = (t: string) => (this.db.prepare(`SELECT COUNT(*) c FROM ${t}`).get() as any).c as number;
    const counts = {
      users: count('users'), nicknames: count('nicknames'),
      sessions: count('sessions'), rounds: count('rounds'),
    };
    const tx = this.db.transaction(() => {
      this.db.exec(`
        DELETE FROM round_users;
        DELETE FROM rounds;
        DELETE FROM sessions;
        DELETE FROM nicknames;
        DELETE FROM users;
        DELETE FROM kv;
        DELETE FROM sqlite_sequence WHERE name IN ('sessions','rounds');
      `);
    });
    tx();
    try { this.db.pragma('wal_checkpoint(TRUNCATE)'); } catch {}
    return counts;
  }

  exportAll(): unknown {
    return {
      users: this.db.prepare(`SELECT * FROM users ORDER BY total_likes DESC`).all(),
      nicknames: this.db.prepare(`SELECT * FROM nicknames`).all(),
      sessions: this.db.prepare(`SELECT * FROM sessions`).all(),
      rounds: this.db.prepare(`SELECT * FROM rounds`).all(),
      round_users: this.db.prepare(`SELECT * FROM round_users`).all(),
      kv: this.db.prepare(`SELECT * FROM kv`).all(),
    };
  }

  close() { this.db.close(); }
}
