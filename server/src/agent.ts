// ─── /agent：捕获子进程接入端（token 鉴权，docs §9）────────────────
import type { FastifyInstance } from 'fastify';
import type { WebSocket } from 'ws';
import type { Engine } from './engine.js';
import type { Hub } from './hub.js';
import { ensureAvatar } from './avatars.js';
import { getConfig } from './config.js';

export interface AgentHooks {
  /** 捕获进程 hello 时返回应恢复观看的房间 URL（无则 null） */
  getResumeUrl?: () => string | null;
}

export interface LikeBatchItem { i: string; c: number; u: string; t?: number; r?: string; bf?: number }

/** 点赞批量入账（抽为可测函数）：
 *  - 消息房间归属（实验特性）：报文带 r 且与当前会话不符 → 丢弃并计数
 *    （双缓冲换房期旧房页消息 / 换房时序窗内跨房消息，防止污染新会话与 total 基线）；
 *  - bf（进房补帧）标记透传给引擎与实验遥测。 */
export function applyLikeBatch(engine: Engine, batch: LikeBatchItem[], at: number): void {
  for (const b of batch) {
    if (!b?.u || !b.c) continue;
    if (b.r && b.r !== engine.agg.room.webRid) {
      engine.exp?.noteCrossRoomDrop();
      continue;
    }
    const src = b.bf === 1 ? 'bf' : 'ws';
    const ok = engine.addLike(b.u, Math.max(0, b.c | 0), b.i ?? '', b.t ?? 0, at, src);
    engine.exp?.noteLike(src, ok, Math.max(0, b.c | 0), b.u, at);
  }
}

/** 活跃 agent 连接数：sim-event 等短连接不能把主捕获挤成 disconnected */
let liveAgents = 0;

export function registerAgent(app: FastifyInstance, engine: Engine, hub: Hub, token: string, hooks: AgentHooks) {
  app.get('/agent', { websocket: true }, (socket: WebSocket, req) => {
    const q = (req.query as Record<string, string>) ?? {};
    if (q.token !== token) { socket.close(4001, 'bad token'); return; }
    liveAgents++;
    if (liveAgents === 1) {
      engine.setCaptureState('connected');
      hub.log('捕获进程已接入');
    }
    let lastAnchorSent = '';

    socket.on('message', (raw: Buffer) => {
      let m: any;
      try { m = JSON.parse(raw.toString('utf-8')); } catch { return; }
      try {
        switch (m.t) {
          case 'hello': {
            engine.setCaptureState('starting');
            const resume = hooks.getResumeUrl?.() ?? null;
            if (resume) send({ t: 'watch', url: resume });
            // 实验状态重同步（进程/浏览器重启后不丢）：任一实验开启才下发（全关态保持零指令，
            // 与"默认关闭时 capture 不收到任何新指令"的字面承诺一致）
            const flags = getConfig().experimental;
            if (Object.values(flags).some(Boolean)) send({ t: 'exp-flags', flags });
            const eff = engine.exp?.effectiveTabsOf();
            if (eff && eff > getConfig().captureTabs) send({ t: 'set-tabs', n: eff });
            break;
          }
          case 'profiles': {
            const list: { u: string; nick: string; av: string | null; sg?: boolean }[] = m.list ?? [];
            for (const p of list) {
              if (!p?.u || !p.nick) continue;
              engine.applyProfile(p.u, p.nick, p.av ?? null, p.sg === true);
              if (p.av) ensureAvatar(p.u, p.av);
            }
            break;
          }
          case 'likes': {
            const batch: LikeBatchItem[] = m.batch ?? [];
            applyLikeBatch(engine, batch, m.at ?? Date.now());
            engine.captureState = 'watching';
            break;
          }
          case 'chat': {
            // 评论播报：{ t:'chat', u, nick?, text }
            engine.onChat(String(m.u ?? ''), String(m.nick ?? ''), String(m.text ?? m.content ?? ''));
            break;
          }
          case 'room': {
            const anchor: string | null = m.anchor && m.anchor !== lastAnchorSent ? m.anchor : null;
            if (anchor) lastAnchorSent = m.anchor;
            engine.onRoom(String(m.webRid ?? ''), m.anchor ?? null, Number(m.online ?? 0), Number(m.likeTotal ?? 0));
            break;
          }
          case 'status': {
            // starting|watching|room-left|offline|risk|failed
            if (m.state === 'room-left') engine.setCaptureState('starting', m.reason);
            else if (m.state === 'offline') engine.setCaptureState('offline', m.reason);
            else if (m.state === 'risk') engine.setCaptureState('risk', m.reason);
            else engine.setCaptureState(m.state ?? 'starting', m.reason);
            break;
          }
          case 'exp-metrics': {
            // 捕获层实验打点：{ t:'exp-metrics', key, ...fields }
            if (typeof m.key === 'string') engine.exp?.noteCapture(m.key as any, m as Record<string, unknown>);
            break;
          }
          case 'tabs-ack': {
            // set-tabs 回执：{ t:'tabs-ack', n }
            if (typeof m.n === 'number') engine.exp?.confirmTabs(m.n);
            break;
          }
        }
      } catch (e) { hub.log(`agent 消息处理异常: ${e}`); }
    });

    socket.on('close', () => {
      liveAgents = Math.max(0, liveAgents - 1);
      if (liveAgents === 0) {
        engine.setCaptureState('disconnected');
        hub.log('捕获进程连接断开');
      }
    });

    socket.on('error', () => { try { socket.close(); } catch {} });

    const send = (o: unknown) => { try { if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(o)); } catch {} };
    // 控制通道挂载（capture-ctl 通过 agentCtl 转发指令）
    agentCtl.senders.add(send);
    socket.on('close', () => agentCtl.senders.delete(send));
  });
}

/** 向捕获进程广播指令（watch/reload/shutdown/exp-flags/set-tabs） */
export const agentCtl = {
  senders: new Set<(o: unknown) => void>(),
  watch(url: string) { this.broadcast({ t: 'watch', url }); },
  reload() { this.broadcast({ t: 'reload' }); },
  shutdown() { this.broadcast({ t: 'shutdown' }); },
  expFlags(flags: unknown) { this.broadcast({ t: 'exp-flags', flags }); },
  setTabs(n: number) { this.broadcast({ t: 'set-tabs', n }); },
  broadcast(o: unknown) { for (const s of this.senders) s(o); },
};
