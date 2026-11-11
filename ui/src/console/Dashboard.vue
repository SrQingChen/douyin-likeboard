<script setup lang="ts">
// 概览：捕获控制 / 房间状态 / 本场数据 / 内嵌榜单预览 / 日志流
import { ref, computed, onMounted, onBeforeUnmount } from 'vue';
import { roState } from '../shared/store';
import { api, post } from './api';
import { fmtNum, fmtClock, isAuthor } from '../shared/format';
import AvatarBubble from '../board/AvatarBubble.vue';

const roomInput = ref('');
const status = ref<any>(null);
const busy = ref<string | null>(null);
const flash = ref<string | null>(null);

async function refresh() { try { status.value = await api('/api/status'); } catch {} }
onMounted(() => { refresh(); setInterval(refresh, 3000); });

// 榜单预览展开：全屏 overlay 里用 ?max=100 展示完整排行（快照已含最多 100 人）
const previewOpen = ref(false);
const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') previewOpen.value = false; };
onMounted(() => window.addEventListener('keydown', onKey));
onBeforeUnmount(() => window.removeEventListener('keydown', onKey));

async function watch() {
  if (!roomInput.value.trim()) return;
  busy.value = 'watch';
  try {
    const r = await post('/api/watch', { url: roomInput.value });
    flash.value = r.ok
      ? (r.queued ? `已记录房间：${r.url}（捕获进程启动中，接入后自动进入）` : `已切换房间：${r.url}`)
      : r.error;
  } catch (e: any) { flash.value = e.message; }
  busy.value = null;
  setTimeout(() => (flash.value = null), 5000);
}
async function settle() {
  busy.value = 'settle';
  try { await post('/api/settle'); flash.value = '已结算，新一轮开始'; } catch (e: any) { flash.value = e.message; }
  busy.value = null; refresh();
  setTimeout(() => (flash.value = null), 4000);
}
async function reload() {
  busy.value = 'reload';
  try { await post('/api/reload'); flash.value = '已发送刷新指令'; } catch (e: any) { flash.value = e.message; }
  busy.value = null;
}
async function restartCapture() {
  busy.value = 'cap';
  try { await post('/api/capture/stop'); await new Promise(r => setTimeout(r, 1500)); await post('/api/capture/start'); flash.value = '捕获进程已重启'; }
  catch (e: any) { flash.value = e.message; }
  busy.value = null;
}

const snap = computed(() => roState.snap);
// 房间实时数优先用 1s WS 快照（比 3s 轮询的 /api/status 快）；未就绪显示 — 而不是 0
const liveOnline = computed(() => snap.value?.room.online ?? status.value?.room?.online ?? 0);
const liveRoomTotal = computed(() => snap.value?.room.roomTotal ?? status.value?.room?.roomTotal ?? -1);
// 完整排行：快照最多 100 人（服务端固定推送 max(100, boardCount)）
const rankRows = computed(() => {
  const s = roState.snap;
  return s ? [...s.podium, ...s.list].slice(0, 100) : [];
});
const roomUrl = computed(() => status.value?.room?.webRid ? `https://live.douyin.com/${status.value.room.webRid}` : null);
const roundLeft = computed(() => {
  const s = status.value; if (!s?.round?.endsAt) return null;
  return Math.max(0, Math.floor((s.round.endsAt - Date.now()) / 1000));
});
// 速率迷你图：WS 快照序列
const rateHistory = ref<number[]>([]);
let lastRateAt = 0;
const histTimer = setInterval(() => {
  const r = snap.value?.room.ratePerMin ?? 0;
  const t = Date.now();
  if (t - lastRateAt > 1500) { rateHistory.value.push(r); if (rateHistory.value.length > 60) rateHistory.value.shift(); lastRateAt = t; }
}, 1000);
const sparkPath = computed(() => {
  const h = rateHistory.value; if (h.length < 2) return '';
  const max = Math.max(10, ...h);
  return h.map((v, i) => `${(i / (h.length - 1)) * 100},${28 - (v / max) * 26}`).join(' ');
});
</script>

<template>
  <div class="grid grid-cols-12 gap-4 max-w-[1280px] mx-auto">
    <!-- 捕获控制 -->
    <section class="glass rounded-2xl p-4 col-span-12 lg:col-span-5 flex flex-col gap-3">
      <h2 class="font-bold text-[14px] flex items-center gap-2">🎯 捕获控制
        <span class="text-[11px] font-normal text-white/45">（Chrome 捕获窗口独立运行）</span>
      </h2>
      <div class="flex gap-2">
        <input v-model="roomInput" placeholder="房间号或直播间链接" class="flex-1" @keyup.enter="watch" />
        <button class="btn btn-primary" :disabled="busy === 'watch'" @click="watch">进入房间</button>
      </div>
      <div class="text-[12px] text-white/50" v-if="roomUrl">
        当前：<a :href="roomUrl" target="_blank" class="text-sky-300 hover:underline">{{ roomUrl }}</a>
        <span v-if="status?.room?.anchor"> · {{ status.room.anchor }}</span>
      </div>
      <div class="flex gap-2 flex-wrap">
        <button class="btn" :disabled="busy === 'settle'" @click="settle">🏁 立即结算</button>
        <button class="btn" :disabled="busy === 'reload'" @click="reload">↻ 刷新页面</button>
        <button class="btn" :disabled="busy === 'cap'" @click="restartCapture">⟳ 重启捕获</button>
        <span v-if="roundLeft != null" class="btn pointer-events-none opacity-70">⏱ {{ Math.floor(roundLeft / 60) }}:{{ String(roundLeft % 60).padStart(2, '0') }} 自动结算</span>
      </div>
      <Transition name="banner"><div v-if="flash" class="text-[12.5px] px-3 py-2 rounded-lg bg-amber-400/10 text-amber-200 border border-amber-300/25">{{ flash }}</div></Transition>
      <div class="grid grid-cols-2 gap-2 text-[12px] mt-1">
        <div class="flex justify-between"><span class="text-white/45">捕获状态</span><span>{{ status?.capture ?? '—' }}</span></div>
        <div class="flex justify-between"><span class="text-white/45">捕获完整度</span>
          <span :class="(status?.room?.coverage ?? 100) < 99 ? 'text-amber-300' : ''">{{ status?.room?.coverage ?? '—' }}%</span></div>
        <div class="flex justify-between"><span class="text-white/45">在线人数</span>
          <span class="num" :title="liveOnline > 0 ? '' : '捕获中，等待房间数据'">{{ liveOnline > 0 ? fmtNum(liveOnline) : '—' }}</span></div>
        <div class="flex justify-between"><span class="text-white/45">房间累计赞</span>
          <span class="num" :title="liveRoomTotal > 0 ? '' : '捕获中，等待房间数据'">{{ liveRoomTotal > 0 ? fmtNum(liveRoomTotal) : '—' }}</span></div>
      </div>
    </section>

    <!-- 本场数据 -->
    <section class="glass rounded-2xl p-4 col-span-12 lg:col-span-7 flex flex-col gap-3 h-full">
      <h2 class="font-bold text-[14px]">📊 本场实况 <span class="text-[11px] font-normal text-white/45">（第 {{ status?.round?.idx ?? 1 }} 轮 · {{ snap?.round.basis === 'session' ? '按本场排序' : '按本轮排序' }}）</span></h2>
      <div class="grid grid-cols-4 gap-3">
        <div class="glass rounded-xl p-3 text-center">
          <div class="num text-[22px] font-black text-rose-300">{{ fmtNum(snap?.room.sessionLikes ?? 0) }}</div>
          <div class="text-[11px] text-white/50 mt-0.5">本场总赞</div>
        </div>
        <div class="glass rounded-xl p-3 text-center">
          <div class="num text-[22px] font-black text-sky-300">{{ fmtNum(snap?.room.ratePerMin ?? 0) }}</div>
          <div class="text-[11px] text-white/50 mt-0.5">实时 赞/分</div>
        </div>
        <div class="glass rounded-xl p-3 text-center">
          <div class="num text-[22px] font-black text-amber-300">{{ fmtNum(snap?.stats.likers ?? 0) }}</div>
          <div class="text-[11px] text-white/50 mt-0.5">点赞人数</div>
        </div>
        <div class="glass rounded-xl p-3 text-center">
          <div class="num text-[22px] font-black text-violet-300">{{ fmtNum(snap?.stats.global?.totalLikes ?? 0) }}</div>
          <div class="text-[11px] text-white/50 mt-0.5">全库累计</div>
        </div>
      </div>
      <!-- 速率趋势：自适应父卡片剩余高度（不再写死 46px） -->
      <div class="glass rounded-xl p-2 relative flex-1 min-h-[150px]">
        <svg viewBox="0 0 100 30" preserveAspectRatio="none" class="w-full h-full">
          <defs><linearGradient id="rg" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stop-color="rgba(56,189,248,.34)" /><stop offset="1" stop-color="rgba(56,189,248,0)" />
          </linearGradient></defs>
          <line x1="0" y1="10" x2="100" y2="10" stroke="rgba(255,255,255,.07)" stroke-width="1" vector-effect="non-scaling-stroke" />
          <line x1="0" y1="20" x2="100" y2="20" stroke="rgba(255,255,255,.07)" stroke-width="1" vector-effect="non-scaling-stroke" />
          <polygon :points="sparkPath + ' 100,30 0,30'" fill="url(#rg)" />
          <polyline :points="sparkPath" fill="none" stroke="#38bdf8" stroke-width="1.4" vector-effect="non-scaling-stroke" />
        </svg>
        <span class="absolute top-1 right-2 text-[10px] text-white/40">速率趋势（近 60s）· 峰值 {{ fmtNum(snap?.room.peakRate ?? 0) }}/分</span>
      </div>
    </section>

    <!-- 榜单预览 -->
    <section class="glass rounded-2xl p-4 col-span-12 lg:col-span-7 overflow-hidden" style="height: 460px">
      <div class="flex items-start justify-between gap-3 mb-2">
        <h2 class="font-bold text-[14px]">👑 榜单预览 <span class="text-[11px] font-normal text-white/45">（正式窗口请用右上角"打开榜单"，OBS 用 /board?transparent=1）</span></h2>
        <button class="btn shrink-0" @click="previewOpen = true">⤢ 展开完整排行（TOP 100）</button>
      </div>
      <iframe src="/board" class="w-full rounded-xl border border-white/10" style="height: 396px; background: #070b18" />
    </section>

    <!-- 日志 -->
    <section class="glass rounded-2xl p-4 col-span-12 lg:col-span-5 overflow-hidden" style="height: 460px">
      <h2 class="font-bold text-[14px] mb-2">📜 运行日志</h2>
      <div class="overflow-auto h-[408px] text-[12px] leading-5 font-mono">
        <div v-for="(l, i) in [...roState.logs].reverse()" :key="i" class="text-white/65">
          <span class="text-white/35 mr-2">{{ fmtClock(l.at) }}</span>{{ l.line }}
        </div>
        <div v-if="!roState.logs.length" class="text-white/30">暂无日志</div>
      </div>
    </section>

    <!-- 完整排行展开：可滚动表格（最多 100 人），Esc / 点击背景 / ✕ 收起 -->
    <Teleport to="body">
      <div v-if="previewOpen" class="fixed inset-0 z-[80] flex flex-col p-4"
        style="background: #060914" @click.self="previewOpen = false">
        <div class="flex items-center justify-between gap-3 mb-2 shrink-0">
          <div class="font-bold text-[15px] text-amber-200">👑 完整排行
            <span class="text-[12px] font-normal text-white/55">· {{ rankRows.length }} / 100 人 · 每秒刷新</span>
          </div>
          <button class="btn" @click="previewOpen = false">✕ 收起（Esc）</button>
        </div>
        <div class="flex-1 min-h-0 glass rounded-2xl overflow-auto">
          <table>
            <thead class="sticky top-0 z-10" style="background: #0d1424">
              <tr>
                <th class="w-[52px] text-center">#</th>
                <th>赞友</th>
                <th class="text-right w-[110px]">本轮赞</th>
                <th class="text-right w-[110px]">速度</th>
                <th class="text-right w-[110px]">累计</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="r in rankRows" :key="r.secUid"
                :class="r.rank === 1 ? 'bg-amber-400/[0.07]' : r.rank === 2 || r.rank === 3 ? 'bg-white/[0.03]' : ''">
                <td class="num text-center font-black"
                  :class="r.rank === 1 ? 'text-amber-300' : r.rank === 2 ? 'text-slate-200' : r.rank === 3 ? 'text-orange-300' : 'text-white/40'">
                  {{ r.rank }}
                </td>
                <td>
                  <div class="flex items-center gap-2 min-w-0">
                    <AvatarBubble :secUid="r.secUid" :nick="r.nick" :size="26" :avatar="r.avatar" />
                    <span class="truncate font-semibold" :class="{ 'author-rainbow': isAuthor(r.secUid) }">{{ r.nick }}</span>
                    <span v-if="r.badge" class="px-1.5 rounded-full text-[10px] font-bold shrink-0 bg-white/10 text-white/70 border border-white/10">{{ r.badge }}</span>
                    <span v-if="r.starGuard" class="shrink-0 text-[10px] font-bold text-cyan-300/85" title="星守护">✦星守</span>
                    <span v-if="r.surge" class="shrink-0 text-[11px]" title="高能冲刺">⚡</span>
                    <span v-if="r.capped" class="shrink-0 text-[10px] text-amber-300/85" title="推断：已触达点赞限额">⚖️封顶</span>
                  </div>
                </td>
                <td class="num text-right font-bold">{{ fmtNum(r.likes) }}</td>
                <td class="num text-right text-sky-300/85">{{ r.speed > 0 ? fmtNum(r.speed) + '/分' : '—' }}</td>
                <td class="num text-right text-white/50">{{ fmtNum(r.storeTotalLikes) }}</td>
              </tr>
              <tr v-if="!rankRows.length"><td colspan="5" class="text-center text-white/40 py-10">暂无数据 —— 进入直播间后自动累积</td></tr>
            </tbody>
          </table>
        </div>
      </div>
    </Teleport>
  </div>
</template>
