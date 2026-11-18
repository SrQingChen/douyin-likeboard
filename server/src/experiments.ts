// ─── 实验性功能框架：开关元信息 / 独立日志 / 遥测评分 / 自适应决策器 ──
// 设计（docs/开发策划书-实验性功能-2026-11-18.md v2）：
//  - 全部实验默认关闭，关闭时系统行为与既有版本一致；
//  - 每实验独立日志 data/experimental/<key>.log（懒创建 + 5MB 轮转）+ hub 日志前缀；
//  - 每实验多维评分（0-100）+ 对照数值表（未开启口径 vs 开启口径），随 1s 快照下发；
//  - EXP-3 决策器为纯函数（可测），适配状态由 ExpTelemetry 持有。

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Engine } from './engine.js';
import { getConfig, type ExperimentalFlags } from './config.js';

export const EXP_KEYS = ['totalAuthoritative', 'fetchBackfill', 'adaptiveTabs', 'dualBufferRoom'] as const;
export type ExpKey = typeof EXP_KEYS[number];

export const EXP_META: Record<ExpKey, { title: string; short: string }> = {
  totalAuthoritative: { title: '权威总量口径', short: '总量' },
  fetchBackfill: { title: '进房补帧', short: '补帧' },
  adaptiveTabs: { title: '自适应并发', short: '并发' },
  dualBufferRoom: { title: '双缓冲换房', short: '换房' },
};

export interface ExpDim { key: string; label: string; value: number; unit: string }
export interface ExpMetric {
  running: boolean; since: number;          // 本次开启时刻（ms）；关闭后保留末次数据
  dims: ExpDim[];                           // 归一化 0-100 评分维度
  score: number;                            // 总评 = 维度均值
  compare: Record<string, string | number>; // 对照数值表（未开启口径 vs 开启口径）
  lastEvents: string[];                     // 最近 ≤3 条事件摘要
}

// ── 独立日志：懒创建（首次写入才建目录/文件），>5MB 轮转为 .old ──
const EXP_LOG_DIR = path.join(path.dirname(path.dirname(fileURLToPath(import.meta.url))), '..', 'data', 'experimental');
const EXP_LOG_MAX = 5 * 1024 * 1024;

function expLogPath(key: ExpKey): string { return path.join(EXP_LOG_DIR, `${key}.log`); }

export function writeExpLog(key: ExpKey, line: string): void {
  try {
    const p = expLogPath(key);
    if (!fs.existsSync(EXP_LOG_DIR)) fs.mkdirSync(EXP_LOG_DIR, { recursive: true });
    if (!fs.existsSync(p) && fs.readdirSync(EXP_LOG_DIR).length === 0) { /* 目录刚建 */ }
    try {
      if (fs.existsSync(p) && fs.statSync(p).size > EXP_LOG_MAX) fs.renameSync(p, p + '.old');
    } catch { /* 轮转失败继续 append */ }
    fs.appendFileSync(p, line + '\n', 'utf-8');
  } catch { /* 日志失败不影响主流程 */ }
}

// ── EXP-3 决策器（纯函数，可测）──
export interface TabsState {
  effective: number;          // 当前生效路数
  baseline: number;           // 基线（用户 captureTabs）
  belowSince: number | null;  // 窗口 coverage < 97% 起始时刻
  aboveSince: number | null;  // > 99.5% 起始时刻
  lastChangeAt: number;       // 上次升降时刻（60s 冷却）
  changes: number[];          // 升降时刻记录（30min 滑窗 ≤8 次防振荡）
}
export interface TabsInput { cov: number | null; ratePerMin: number }

/** 纯函数决策：返回 {tab, reason} 表示应调整路数；null = 不动作。
 *  输入 cov 为 60s 窗口完整度（0-150，>100 为 total 噪声），null = 近期无数据（挂起）。 */
export function decideTabs(s: TabsState, input: TabsInput, nowMs: number): { tab: number; reason: string } | null {
  if (input.cov == null) { s.belowSince = null; s.aboveSince = null; return null; } // 安静房间挂起（防误判）
  if (nowMs - s.lastChangeAt < 60_000) return null;                                  // 升降冷却
  s.changes = s.changes.filter(t => nowMs - t < 30 * 60_000);
  if (s.changes.length >= 8) return null;                                            // 30min ≤8 次防振荡
  const fast = input.ratePerMin > 600;                                               // 洪峰快速通道（报告 B 4.2-3）
  const belowNeed = (fast ? 15 : 30) * 1000;
  if (input.cov < 97) {
    s.aboveSince = null;
    if (s.belowSince == null) s.belowSince = nowMs;
    const held = nowMs - s.belowSince;
    if (s.effective < 4 && held >= belowNeed) {
      return { tab: s.effective + 1, reason: `60s 窗口完整度 ${input.cov.toFixed(1)}% < 97% 已 ${Math.round(held / 1000)}s${fast ? '（洪峰快速通道）' : ''}` };
    }
    return null;
  }
  s.belowSince = null;
  if (input.cov > 99.5) {
    if (s.aboveSince == null) s.aboveSince = nowMs;
    const held = nowMs - s.aboveSince;
    if (s.effective > s.baseline && held >= 5 * 60_000) {
      return { tab: s.effective - 1, reason: `60s 窗口完整度 ${input.cov.toFixed(1)}% > 99.5% 已 ${Math.round(held / 1000)}s，回落基线` };
    }
  } else {
    s.aboveSince = null;
  }
  return null;
}

// ── EXP-4 换房导航计划（纯函数，可测）：flag 关 = 并行（现状），开 = 两阶段 ──
export function planGoto(dualBuffer: boolean, pageCount: number): 'parallel' | 'serial' {
  return dualBuffer && pageCount > 1 ? 'serial' : 'parallel';
}

const clamp = (v: number, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, v));
const pct = (n: number, d: number) => (d > 0 ? (n / d) * 100 : 0);

// ═══ 遥测器 ═══
export class ExpTelemetry {
  private hub: { log: (line: string) => void } | null = null;
  /** 当前实验开关（setRunning 注入并同步；metrics/tick 以此为准，与全局 config 解耦） */
  private flags: ExperimentalFlags;
  constructor() { this.flags = { ...getConfig().experimental }; }
  attachHub(h: { log: (line: string) => void }) { this.hub = h; }

  // 每实验计量状态
  private st = new Map<ExpKey, {
    running: boolean; since: number;
    events: string[];
    // EXP-1
    elapsedSec: number; availableSec: number; fallbacks: number;
    lastSumCounted: number; lastSumAuth: number;   // 增量一致性采样基点
    consistency: number;                            // 最近一次 60s 增量比 ×100
    // EXP-2
    decodeOk: number; decodeFail: number;
    bfAccepted: number; bfRejected: number; bfLikes: number; bfUsers: Set<string>;
    firstWsAt: number; firstBfAt: number; sessionAt: number;
    // EXP-3
    covSamples: { t: number; v: number }[];         // 60s 窗口 coverage 采样（30min）
    tabs: TabsState;
    preMeanCov: number | null;                      // 升路前 5min 均值快照
    preMeanAt: number;
    postMeanSum: number; postMeanN: number;
    lastResponseMs: number | null;                  // 跌破→升路完成延迟
    overlapTotal: number; overlapHits: number;
    // EXP-4
    switches: { at: number; firstDataMs: number | null; keptFrames: number; totalMs: number | null }[];
    crossRoomDropped: number;
  }>();

  private state(key: ExpKey) {
    let s = this.st.get(key);
    if (!s) {
      s = {
        running: false, since: 0, events: [],
        elapsedSec: 0, availableSec: 0, fallbacks: 0,
        lastSumCounted: -1, lastSumAuth: -1, consistency: 100,
        decodeOk: 0, decodeFail: 0, bfAccepted: 0, bfRejected: 0, bfLikes: 0, bfUsers: new Set(),
        firstWsAt: 0, firstBfAt: 0, sessionAt: 0,
        covSamples: [], tabs: { effective: getConfig().captureTabs, baseline: getConfig().captureTabs, belowSince: null, aboveSince: null, lastChangeAt: 0, changes: [] },
        preMeanCov: null, preMeanAt: 0, postMeanSum: 0, postMeanN: 0, lastResponseMs: null,
        overlapTotal: 0, overlapHits: 0,
        switches: [], crossRoomDropped: 0,
      };
      this.st.set(key, s);
    }
    return s;
  }

  /** 开关切换：开启时重开计量（清零），关闭时仅置 running=false（保留末次数据供查看） */
  setRunning(flags: ExperimentalFlags, nowMs = Date.now()) {
    this.flags = { ...flags };
    for (const k of EXP_KEYS) {
      const on = flags[k];
      const s = this.state(k);
      if (on && !s.running) {
        s.running = true; s.since = nowMs; s.events = [];
        s.elapsedSec = 0; s.availableSec = 0; s.fallbacks = 0;
        s.lastSumCounted = -1; s.lastSumAuth = -1; s.consistency = 100;
        s.decodeOk = 0; s.decodeFail = 0; s.bfAccepted = 0; s.bfRejected = 0; s.bfLikes = 0; s.bfUsers = new Set();
        s.firstWsAt = 0; s.firstBfAt = 0; s.sessionAt = 0;
        s.covSamples = [];
        s.tabs = { effective: getConfig().captureTabs, baseline: getConfig().captureTabs, belowSince: null, aboveSince: null, lastChangeAt: 0, changes: [] };
        s.preMeanCov = null; s.preMeanAt = 0; s.postMeanSum = 0; s.postMeanN = 0; s.lastResponseMs = null;
        s.overlapTotal = 0; s.overlapHits = 0;
        s.switches = []; s.crossRoomDropped = 0;
        this.pendingTab = null; this.retries = 0; this.lastChangeMark = 0;
        this.log(k, 'experiment-enabled', {});
      } else if (!on && s.running) {
        s.running = false;
        this.log(k, 'experiment-disabled', {});
      }
    }
  }
  private retries = 0;
  private lastChangeMark = 0;

  /** 实验事件日志：独立文件 + hub 前缀 + 摘要进快照 */
  log(key: ExpKey, event: string, detail: Record<string, unknown> = {}) {
    const line = `${new Date().toISOString()} ${event} ${JSON.stringify(detail)}`;
    writeExpLog(key, line);
    const d = Object.keys(detail).length ? ' ' + JSON.stringify(detail) : '';
    this.hub?.log(`[实验:${EXP_META[key].short}] ${event}${d}`);
    const s = this.state(key);
    s.events.unshift(`${new Date().toISOString().slice(11, 19)} ${event}${d}`);
    if (s.events.length > 3) s.events.length = 3;
  }

  // ── core 侧数据入口 ──

  /** 点赞入账回执（agent 转发）：统计补帧接受/拒绝、首条 WS/补帧到达时刻 */
  noteLike(src: 'ws' | 'bf', applied: boolean, count: number, secUid: string, atMs: number) {
    const s = this.state('fetchBackfill');
    if (src === 'bf') {
      if (applied) { s.bfAccepted++; s.bfLikes += count; s.bfUsers.add(secUid); if (!s.firstBfAt) s.firstBfAt = atMs; }
      else s.bfRejected++;
    } else if (applied && !s.firstWsAt) s.firstWsAt = atMs;
  }

  /** 会话边界（engine.onRoom / startSession） */
  noteSession(atMs: number) {
    const s = this.state('fetchBackfill');
    s.firstWsAt = 0; s.firstBfAt = 0; s.sessionAt = atMs;
  }

  /** capture 上报（agent exp-metrics 转发） */
  noteCapture(key: ExpKey, m: Record<string, unknown>) {
    const s = this.state(key);
    if (key === 'fetchBackfill') {
      if (typeof m.decoded === 'number') s.decodeOk += m.decoded;
      if (typeof m.failed === 'number') s.decodeFail += m.failed;
    } else if (key === 'adaptiveTabs') {
      if (typeof m.overlapTotal === 'number') s.overlapTotal += m.overlapTotal;
      if (typeof m.overlapHits === 'number') s.overlapHits += m.overlapHits;
    } else if (key === 'dualBufferRoom') {
      const ev = String(m.ev ?? '');
      if (ev === 'switch-start') {
        s.switches.push({ at: Date.now(), firstDataMs: null, keptFrames: 0, totalMs: null });
        if (s.switches.length > 20) s.switches.shift();
      } else if (ev === 'first-data' && typeof m.ms === 'number') {
        // 新房首数据延迟（capture 以 key='dualBufferRoom' 打点，此处才是正确路由）
        const cur = s.switches[s.switches.length - 1];
        if (cur && cur.firstDataMs == null) cur.firstDataMs = m.ms;
      } else if (ev === 'phase-b-done') {
        // 两阶段完成：记录全程耗时与切换期间旧房保留帧数（平滑度证据）
        const cur = s.switches[s.switches.length - 1];
        if (cur) {
          if (typeof m.totalMs === 'number') cur.totalMs = m.totalMs;
          if (typeof m.keptFrames === 'number') cur.keptFrames = m.keptFrames;
        }
      }
    }
  }

  /** 跨房归属拦截（agent r 校验丢弃） */
  noteCrossRoomDrop() { this.state('dualBufferRoom').crossRoomDropped++; }

  /** set-tabs 回执 */
  confirmTabs(n: number, nowMs = Date.now()) {
    const s = this.state('adaptiveTabs');
    if (s.tabs.effective !== n) { s.tabs.effective = n; }
    if (this.pendingTab != null) { this.lastResponseMs = nowMs - this.pendingTabAt; this.pendingTab = null; }
    this.log('adaptiveTabs', 'tabs-ack', { n });
  }

  /** 当前生效采集路数（engine.effectiveTabs 用） */
  effectiveTabsOf(): number { return this.state('adaptiveTabs').tabs.effective; }
  pendingTab: number | null = null;
  pendingFrom: number | null = null;
  pendingTabAt = 0;
  lastResponseMs: number | null = null;

  /** 决策器执行（index 1s tick 调用）；返回应下发的 set-tabs n 或 null */
  tickAdaptive(engine: Engine, nowMs = Date.now(), send: (n: number) => void): void {
    const flags = this.flags;
    const s = this.state('adaptiveTabs');
    if (!flags.adaptiveTabs) return;
    // 同步基线（用户可能改 captureTabs）
    s.tabs.baseline = getConfig().captureTabs;
    if (!s.running) { s.running = true; if (!s.since) s.since = nowMs; }
    const cov = engine.agg.windowCoveragePct(nowMs);
    const rate = engine.agg.roomRatePerMin(nowMs);
    if (cov != null) {
      s.covSamples.push({ t: nowMs, v: cov });
      const cutoff = nowMs - 30 * 60_000;
      while (s.covSamples.length && s.covSamples[0].t < cutoff) s.covSamples.shift();
      if (s.preMeanCov != null) { s.postMeanSum += cov; s.postMeanN++; }
    }
    // 未确认重发（≤3 次；超限放弃并回滚乐观值，core 与 capture 路数不至漂移）
    if (this.pendingTab != null && nowMs - this.pendingTabAt > 60_000) {
      if (this.retries < 3) { this.retries++; send(this.pendingTab); this.pendingTabAt = nowMs; }
      else {
        s.tabs.effective = this.pendingFrom ?? s.tabs.effective;
        this.pendingTab = null; this.pendingFrom = null; this.retries = 0;
        this.log('adaptiveTabs', 'set-tabs-timeout', { rollbackTo: s.tabs.effective });
      }
    }
    if (this.pendingTab != null) return; // 等确认期间不再决策
    const r = decideTabs(s.tabs, { cov, ratePerMin: rate }, nowMs);
    if (r) {
      const prev = s.tabs.effective;
      s.tabs.effective = r.tab; s.tabs.lastChangeAt = nowMs; s.tabs.changes.push(nowMs);
      s.lastResponseMs = null;
      // 升路前 5min 窗口均值快照（对照）
      if (r.tab > prev) {
        const past = s.covSamples.filter(x => nowMs - x.t <= 5 * 60_000);
        const base = past.length ? past.reduce((a, b) => a + b.v, 0) / past.length : null;
        s.preMeanCov = base; s.preMeanAt = nowMs; s.postMeanSum = 0; s.postMeanN = 0;
      }
      this.lastChangeMark = nowMs;
      this.pendingTab = r.tab; this.pendingFrom = prev; this.pendingTabAt = nowMs; this.retries = 0;
      send(r.tab);
      this.log('adaptiveTabs', 'set-tabs-sent', { from: prev, to: r.tab, reason: r.reason });
    }
  }

  /** EXP-1/2 每秒采样（index tick） */
  tickSamples(engine: Engine, nowMs = Date.now()) {
    const flags = this.flags;
    if (flags.totalAuthoritative) {
      const s = this.state('totalAuthoritative');
      if (engine.sessionId) {
        s.elapsedSec++;
        if (engine.agg.authoritativeLikes() >= 0) s.availableSec++;
      }
      // 增量一致性（60s 窗口重算，滑动基点）
      const auth = engine.agg.authoritativeLikes();
      const counted = engine.agg.room.counted;
      if (auth >= 0 && s.lastSumAuth >= 0 && auth > s.lastSumAuth) {
        const dc = counted - s.lastSumCounted, da = auth - s.lastSumAuth;
        if (da > 0 && dc >= 0) s.consistency = clamp(100 - Math.abs(dc - da) / da * 100);
      }
      if (auth >= 0) { s.lastSumAuth = auth; s.lastSumCounted = counted; }
    }
    if (!flags.fetchBackfill) {
      // 关闭时维持 running=false（setRunning 已处理）
    }
  }

  /** 组装快照 metrics */
  metrics(): { flags: ExperimentalFlags; effectiveTabs: number; baselineTabs: number; metrics: Partial<Record<ExpKey, ExpMetric>> } {
    const flags = this.flags;
    const out: Partial<Record<ExpKey, ExpMetric>> = {};

    { // EXP-1
      const s = this.state('totalAuthoritative');
      if (s.running || s.since) {
        const avail = s.elapsedSec > 0 ? clamp(pct(s.availableSec, s.elapsedSec)) : 100;
        out.totalAuthoritative = {
          running: s.running, since: s.since, dims: [
            { key: 'avail', label: '口径可用率', value: avail, unit: '%' },
            { key: 'consistency', label: '增量一致性', value: clamp(s.consistency), unit: '%' },
          ], score: 0, compare: {}, lastEvents: [...s.events],
        };
      }
    }
    { // EXP-3
      const s = this.state('adaptiveTabs');
      if (s.running || s.since) {
        const changes = s.tabs.changes.length;
        const postMean = s.postMeanN > 0 ? s.postMeanSum / s.postMeanN : null;
        const uplift = (s.preMeanCov != null && postMean != null) ? clamp(postMean - s.preMeanCov) : 0;
        const overlapPct = s.overlapTotal > 0 ? pct(s.overlapHits, s.overlapTotal) : 0;
        out.adaptiveTabs = {
          running: s.running, since: s.since, dims: [
            { key: 'uplift', label: '完整度提升', value: clamp(uplift * 20), unit: `+${uplift.toFixed(1)}pp` },
            { key: 'stability', label: '稳定性', value: clamp(100 - changes * 12.5), unit: `${changes} 次调整` },
            { key: 'resource', label: '资源代价', value: clamp(100 - (s.tabs.effective / Math.max(1, s.tabs.baseline) - 1) * 100), unit: `${s.tabs.effective}/${s.tabs.baseline} 路` },
          ], score: 0, compare: {
            升路前完整度: s.preMeanCov != null ? `${s.preMeanCov.toFixed(1)}%` : '—',
            当前窗口完整度: postMean != null ? `${postMean.toFixed(1)}%` : '—',
            当前路数: s.tabs.effective, 基线路数: s.tabs.baseline,
            多路重叠率: `${overlapPct.toFixed(1)}%`,
            升路响应延迟: s.lastResponseMs != null ? `${(s.lastResponseMs / 1000).toFixed(1)}s` : '—',
          }, lastEvents: [...s.events],
        };
      }
    }
    { // EXP-4
      const s = this.state('dualBufferRoom');
      if (s.running || s.since) {
        const done = s.switches.filter(x => x.firstDataMs != null);
        const avgFirst = done.length ? done.reduce((a, b) => a + (b.firstDataMs ?? 0), 0) / done.length : null;
        const kept = s.switches.filter(x => x.keptFrames > 0).length;
        const smooth = s.switches.length ? pct(kept, s.switches.length) : 100;
        const totals = s.switches.filter(x => x.totalMs != null);
        const avgTotal = totals.length ? totals.reduce((a, b) => a + (b.totalMs ?? 0), 0) / totals.length : null;
        out.dualBufferRoom = {
          running: s.running, since: s.since, dims: [
            { key: 'first', label: '新房首数据', value: avgFirst != null ? clamp(100 - (avgFirst / 1000) * 10) : 100, unit: avgFirst != null ? `${(avgFirst / 1000).toFixed(1)}s` : '—' },
            { key: 'smooth', label: '切换平滑度', value: clamp(smooth), unit: `${kept}/${s.switches.length}` },
            { key: 'total', label: '切换全程', value: avgTotal != null ? clamp(100 - (avgTotal / 1000) * 20) : 100, unit: avgTotal != null ? `${(avgTotal / 1000).toFixed(1)}s` : '—' },
          ], score: 0, compare: {
            最近换房首数据: done.length && done[done.length - 1].firstDataMs != null ? `${((done[done.length - 1].firstDataMs ?? 0) / 1000).toFixed(1)}s` : '—',
            平均首数据: avgFirst != null ? `${(avgFirst / 1000).toFixed(1)}s` : '—',
            平滑换房占比: `${smooth.toFixed(0)}%`,
            跨房拦截: s.crossRoomDropped,
          }, lastEvents: [...s.events],
        };
      }
    }
    // 总评
    for (const k of EXP_KEYS) {
      const m = out[k];
      if (m) m.score = m.dims.length ? Math.round(m.dims.reduce((a, b) => a + b.value, 0) / m.dims.length) : 0;
    }
    const s3 = this.state('adaptiveTabs');
    return { flags, effectiveTabs: s3.tabs.effective, baselineTabs: s3.tabs.baseline, metrics: out };
  }

  /** 填入需要引擎实时值的 compare（EXP-1/EXP-2 与快照同帧计算，保证口径一致） */
  fillEngineCompare(engine: Engine) {
    const flags = this.flags;
    const m = this.metrics();
    const ma = m.metrics.totalAuthoritative;
    if (ma) {
      const auth = engine.agg.authoritativeLikes();
      const counted = engine.agg.room.counted;
      const ratio = auth > 0 ? clamp(pct(counted, auth)) : 100;
      ma.dims.splice(1, 0, { key: 'ratio', label: '抽样偏差可见度', value: ratio, unit: `${ratio.toFixed(1)}%` });
      ma.compare = {
        未开启口径_本地计数: counted,
        开启口径_官方累计: auth >= 0 ? auth : '—',
        差异: auth > 0 ? `${(pct(auth - counted, auth)).toFixed(1)}%` : '—',
        进房基线: engine.agg.room.baselineTotal >= 0 ? engine.agg.room.baselineTotal : '—',
        基线来源: engine.agg.room.baselineSource || '—',
        口径回退次数: this.state('totalAuthoritative').fallbacks,
      };
      ma.score = Math.round(ma.dims.reduce((a, b) => a + b.value, 0) / ma.dims.length);
    }
    if (this.state('fetchBackfill').running || this.state('fetchBackfill').since) {
      const s = this.state('fetchBackfill');
      const counted = engine.agg.room.counted;
      const contrib = pct(s.bfLikes, Math.max(1, counted));
      const accel = (() => {
        if (!s.sessionAt || !s.firstWsAt) return null;
        const wsLat = s.firstWsAt - s.sessionAt;
        if (!s.firstBfAt) return { v: 0, ws: wsLat, bf: 0 };
        const bfLat = s.firstBfAt - s.sessionAt;
        return { v: clamp(wsLat > 0 ? ((wsLat - bfLat) / wsLat) * 100 : 0), ws: wsLat, bf: bfLat };
      })();
      m.metrics.fetchBackfill = {
        running: s.running, since: s.since || Date.now(),
        dims: [
          { key: 'accel', label: '首数据加速', value: accel ? accel.v : 0, unit: accel ? `补帧 ${(accel.bf / 1000).toFixed(1)}s vs WS ${(accel.ws / 1000).toFixed(1)}s` : '—' },
          { key: 'contrib', label: '回补贡献', value: clamp(contrib * 10), unit: `${contrib.toFixed(1)}%` },
          { key: 'decode', label: '解码稳定性', value: s.decodeOk + s.decodeFail > 0 ? clamp(pct(s.decodeOk, s.decodeOk + s.decodeFail)) : 100, unit: `${s.decodeFail} 次失败` },
        ], score: 0, compare: {
          仅WS口径_本地计数: counted - s.bfLikes,
          含补帧总计数: counted,
          补帧回补: s.bfLikes,
          补帧消息_入账: s.bfAccepted, 补帧消息_去重拦截: s.bfRejected,
          补帧覆盖用户: s.bfUsers.size,
        }, lastEvents: [...s.events],
      };
      const mf = m.metrics.fetchBackfill;
      mf.score = Math.round(mf.dims.reduce((a, b) => a + b.value, 0) / mf.dims.length);
    }
    return m;
  }
}
