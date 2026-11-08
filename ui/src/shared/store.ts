// ━━━ 共享 reactive 状态：WS 连接 + 快照 + 插值（榜单/控制台共用）━━━
import { reactive, readonly } from 'vue';
import type { Snapshot, SettleToast } from './types';

interface UiState {
  connected: boolean;
  snap: Snapshot | null;
  logs: { at: number; line: string }[];
  toasts: { id: number; kind: string; data: any }[];
  settleBanner: { id: number; data: SettleToast } | null;
  milestone: { id: number; value: number } | null;
}

export const state = reactive<UiState>({
  connected: false, snap: null, logs: [], toasts: [], settleBanner: null, milestone: null,
});
export const roState = readonly(state);

let toastSeq = 0;
export function dismissToast(id: number) {
  state.toasts = state.toasts.filter(t => t.id !== id);
}
export function clearMilestone() { state.milestone = null; }
export function clearSettleBanner() { state.settleBanner = null; }

export function connectWs() {
  let closed = false;
  let backoff = 1000;
  const open = () => {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const ws = new WebSocket(`${proto}://${location.host}/ws`);
    ws.onopen = () => { state.connected = true; backoff = 1000; };
    ws.onmessage = ev => {
      let m: any; try { m = JSON.parse(ev.data); } catch { return; }
      switch (m.t) {
        case 'board': state.snap = m as Snapshot; break;
        case 'log':
          state.logs.push({ at: m.at ?? Date.now(), line: String(m.line) });
          if (state.logs.length > 300) state.logs.splice(0, state.logs.length - 300);
          break;
        case 'toast':
          if (m.kind === 'settle') {
            state.settleBanner = { id: ++toastSeq, data: m.data };
            if (state.settleBanner && !state.settleBanner.id) state.settleBanner = null;
          } else if (m.kind === 'milestone') {
            state.milestone = { id: ++toastSeq, value: m.data.value };
          } else if (m.kind === 'session') {
            state.toasts.push({ id: ++toastSeq, kind: m.kind, data: m.data });
          }
          break;
      }
    };
    ws.onclose = () => {
      state.connected = false;
      if (!closed) setTimeout(open, backoff), backoff = Math.min(8000, backoff * 1.6);
    };
    ws.onerror = () => { try { ws.close(); } catch {} };
  };
  open();
}
