// ─── /agent：捕获子进程接入端（token 鉴权，docs §9）────────────────
import type { FastifyInstance } from 'fastify';
import type { WebSocket } from 'ws';
import type { Engine } from './engine.js';
import type { Hub } from './hub.js';
import { ensureAvatar } from './avatars.js';

export interface AgentHooks {
  /** 捕获进程 hello 时返回应恢复观看的房间 URL（无则 null） */
  getResumeUrl?: () => string | null;
}

export function registerAgent(app: FastifyInstance, engine: Engine, hub: Hub, token: string, hooks: AgentHooks) {
  app.get('/agent', { websocket: true }, (socket: WebSocket, req) => {
    const q = (req.query as Record<string, string>) ?? {};
    if (q.token !== token) { socket.close(4001, 'bad token'); return; }
    engine.setCaptureState('connected');
    hub.log('捕获进程已接入');
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
            break;
          }
          case 'profiles': {
            const list: { u: string; nick: string; av: string | null }[] = m.list ?? [];
            for (const p of list) {
              if (!p?.u || !p.nick) continue;
              engine.applyProfile(p.u, p.nick, p.av ?? null);
              if (p.av) ensureAvatar(p.u, p.av);
            }
            break;
          }
          case 'likes': {
            const batch: { i: string; c: number; u: string; t?: number }[] = m.batch ?? [];
            const at = m.at ?? Date.now();
            let applied = 0;
            for (const b of batch) {
              if (!b?.u || !b.c) continue;
              if (engine.addLike(b.u, Math.max(0, b.c | 0), b.i ?? '', b.t ?? 0, at)) applied++;
            }
            engine.captureState = 'watching';
            void applied;
            break;
          }
          case 'room': {
            const anchor: string | null = m.anchor && m.anchor !== lastAnchorSent ? m.anchor : null;
            if (anchor) lastAnchorSent = m.anchor;
            engine.onRoom(String(m.webRid ?? ''), m.anchor ?? null, Number(m.online ?? 0));
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
        }
      } catch (e) { hub.log(`agent 消息处理异常: ${e}`); }
    });

    socket.on('close', () => {
      engine.setCaptureState('disconnected');
      hub.log('捕获进程连接断开');
    });

    socket.on('error', () => { try { socket.close(); } catch {} });

    const send = (o: unknown) => { try { if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(o)); } catch {} };
    // 控制通道挂载（capture-ctl 通过 agentCtl 转发指令）
    agentCtl.senders.add(send);
    socket.on('close', () => agentCtl.senders.delete(send));
  });
}

/** 向捕获进程广播指令（watch/reload/shutdown） */
export const agentCtl = {
  senders: new Set<(o: unknown) => void>(),
  watch(url: string) { this.broadcast({ t: 'watch', url }); },
  reload() { this.broadcast({ t: 'reload' }); },
  shutdown() { this.broadcast({ t: 'shutdown' }); },
  broadcast(o: unknown) { for (const s of this.senders) s(o); },
};
