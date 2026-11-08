// ─── WS hub：/ws 榜单快照广播（1s）+ toast 播报 ────────────────────
import type { WebSocket } from 'ws';

export interface BoardSnapshot {
  t: 'board'; at: number;
  room: {
    webRid: string; anchor: string; online: number; roomTotal: number;
    sessionLikes: number; ratePerMin: number; peakRate: number; coverage: number;
  };
  round: { idx: number; startedAt: number; endsAt: number | null; basis: 'round' | 'session' };
  capture: string;
  podium: unknown[]; list: unknown[];
  stats: { likers: number; global: Record<string, number> };
  records: Record<string, unknown>;
}

export class Hub {
  clients = new Set<WebSocket>();

  add(ws: WebSocket) {
    this.clients.add(ws);
    ws.on('close', () => this.clients.delete(ws));
    ws.on('error', () => this.clients.delete(ws));
  }

  broadcast(msg: unknown) {
    const s = JSON.stringify(msg);
    for (const ws of this.clients) {
      if (ws.readyState === ws.OPEN) { try { ws.send(s); } catch { this.clients.delete(ws); } }
    }
  }

  toast(kind: string, data: unknown) {
    this.broadcast({ t: 'toast', kind, data });
  }

  log(line: string) {
    this.broadcast({ t: 'log', line, at: Date.now() });
  }

  get size() { return this.clients.size; }
}
