<script setup lang="ts">
// 概览：捕获控制 / 房间状态 / 本场数据 / 内嵌榜单预览 / 日志流
import { ref, computed, onMounted } from 'vue';
import { roState } from '../shared/store';
import { api, post } from './api';
import { fmtNum, fmtClock } from '../shared/format';

const roomInput = ref('');
const status = ref<any>(null);
const busy = ref<string | null>(null);
const flash = ref<string | null>(null);

async function refresh() { try { status.value = await api('/api/status'); } catch {} }
onMounted(() => { refresh(); setInterval(refresh, 3000); });

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
        <div class="flex justify-between"><span class="text-white/45">在线人数</span><span class="num">{{ fmtNum(status?.room?.online ?? 0) }}</span></div>
        <div class="flex justify-between"><span class="text-white/45">房间累计赞</span><span class="num">{{ fmtNum(status?.room?.roomTotal ?? 0) }}</span></div>
      </div>
    </section>

    <!-- 本场数据 -->
    <section class="glass rounded-2xl p-4 col-span-12 lg:col-span-7 flex flex-col gap-3">
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
      <div class="glass rounded-xl p-2 h-[46px] relative">
        <svg viewBox="0 0 100 30" preserveAspectRatio="none" class="w-full h-full">
          <defs><linearGradient id="rg" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stop-color="rgba(56,189,248,.5)" /><stop offset="1" stop-color="rgba(56,189,248,0)" />
          </linearGradient></defs>
          <polyline :points="sparkPath" fill="none" stroke="#38bdf8" stroke-width="1" vector-effect="non-scaling-stroke" />
          <polygon :points="sparkPath + ' 100,30 0,30'" fill="url(#rg)" />
        </svg>
        <span class="absolute top-1 right-2 text-[10px] text-white/40">速率趋势（近 60s）· 峰值 {{ fmtNum(snap?.room.peakRate ?? 0) }}/分</span>
      </div>
    </section>

    <!-- 榜单预览 -->
    <section class="glass rounded-2xl p-4 col-span-12 lg:col-span-7 overflow-hidden" style="height: 460px">
      <h2 class="font-bold text-[14px] mb-2">👑 榜单预览 <span class="text-[11px] font-normal text-white/45">（正式窗口请用右上角"打开榜单"，OBS 用 /board?transparent=1）</span></h2>
      <iframe src="/board" class="w-full rounded-xl border border-white/10" style="height: 408px; background: #070b18" />
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
  </div>
</template>
