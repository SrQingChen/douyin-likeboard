// ━━━ 格式化 + 数字滚动（rAF 指数平滑，快照 1s 一次 → 视觉丝滑实时）━━━
import { ref, watch, onScopeDispose, type Ref } from 'vue';

export function fmtNum(n: number): string {
  if (n >= 100_000_000) return (n / 100_000_000).toFixed(2) + '亿';
  if (n >= 10_000) return (n / 10_000).toFixed(n >= 100_000 ? 0 : 1) + '万';
  return String(Math.round(n));
}
export function fmtTime(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const mm = String(Math.floor(s / 60)).padStart(2, '0');
  const ss = String(s % 60).padStart(2, '0');
  return `${mm}:${ss}`;
}
export function fmtClock(ts: number): string {
  return new Date(ts).toLocaleTimeString('zh-CN', { hour12: false });
}

/** 数字滚动：target 变化时 rAF 平滑趋近（指数平滑，~0.12/frame） */
export function useCountUp(target: Ref<number>, opts: { dur?: number } = {}) {
  const display = ref(target.value);
  let raf = 0;
  const smooth = opts.dur ?? 0.12;
  const step = () => {
    const t = target.value, d = display.value;
    const diff = t - d;
    if (Math.abs(diff) < 0.6) { display.value = t; raf = 0; return; }
    display.value = d + diff * smooth;
    raf = requestAnimationFrame(step);
  };
  watch(target, () => { if (!raf) raf = requestAnimationFrame(step); }, { immediate: true });
  onScopeDispose(() => { if (raf) cancelAnimationFrame(raf); });
  return display;
}

/** 头像 URL（本地缓存；404 由 <img onerror> 兜底占位） */
export function avatarUrl(secUid: string): string { return `/api/avatar/${encodeURIComponent(secUid)}`; }

/** 作者账号（Sr_青尘）的稳定身份：f46 secUid（账号级，不随昵称/头像/场次变化）。
 *  数字 uid 97905874098 仅作备注；f73 是轮换令牌，不能用于身份判定。 */
export const AUTHOR_SEC_UID = 'MS4wLjABAAAAhs9HSVhGCISlyr4RzfOhVsF24VwtOg_SfIx3xGlFVm8';
export const AUTHOR_UID = '97905874098';
export const isAuthor = (secUid?: string | null): boolean =>
  !!secUid && secUid === AUTHOR_SEC_UID;
