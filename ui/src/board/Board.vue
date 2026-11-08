<script setup lang="ts">
import { computed, ref, onMounted, onScopeDispose, watch } from 'vue';
import { roState, connectWs, clearMilestone } from '../shared/store';
import { useCountUp, fmtNum, fmtTime } from '../shared/format';
import RotatingBox from './RotatingBox.vue';
import Podium from './Podium.vue';
import RankList from './RankList.vue';
import Confetti from './Confetti.vue';

// ── 窗口参数：?transparent=1（OBS）&layout=vertical（竖屏）&max=50 ──
const qs = new URLSearchParams(location.search);
const transparent = qs.get('transparent') === '1';
const vertical = qs.get('layout') === 'vertical';
const maxRows = Number(qs.get('max') ?? 50);
if (transparent) document.body.classList.add('transparent-mode');

// ── 桌面透明窗口（Electron）控件 ──
const eb = (window as unknown as { electronBoard?: {
  setPin: (v: boolean) => void; setThrough: (v: boolean) => void; close: () => void;
  onThroughChanged: (cb: (v: boolean) => void) => void;
} }).electronBoard ?? null;
const pinned = ref(false);
const through = ref(false);
if (eb) eb.onThroughChanged((v: boolean) => { through.value = v; });
function toggleThrough() { if (eb) { through.value = true; eb.setThrough(true); } }
function unlock() { if (eb) { through.value = false; eb.setThrough(false); } }
function togglePin() { if (eb) { pinned.value = !pinned.value; eb.setPin(pinned.value); } }

const snap = computed(() => roState.snap);

// 本地 1s 时钟（倒计时/已进行时间平滑）
const nowTick = ref(Date.now());
const clock = setInterval(() => (nowTick.value = Date.now()), 1000);

const roundSecsLeft = computed(() => {
  const s = snap.value; if (!s?.round.endsAt) return -1;
  return Math.max(0, Math.floor((s.round.endsAt - nowTick.value) / 1000));
});

// 本场总赞滚动
const sessionLikes = computed(() => snap.value?.room.sessionLikes ?? 0);
const sessionDisplay = useCountUp(sessionLikes);

// ── 结算横幅 + 彩带分级 ──
const confetti = ref<InstanceType<typeof Confetti> | null>(null);
const showBanner = ref(false);
watch(() => roState.settleBanner?.id, (id) => {
  if (!id) return;
  const d = roState.settleBanner!.data;
  if (d.ceremony === 'record' || d.ceremony === 'champion') confetti.value?.burst();
  showBanner.value = true;
  setTimeout(() => (showBanner.value = false), 9000);
});
watch(() => roState.milestone?.id, () => {
  setTimeout(clearMilestone, 3200);
});

onMounted(() => connectWs());
onScopeDispose(() => clearInterval(clock));

const coverageWarn = computed(() => {
  const c = snap.value?.room.coverage ?? 100;
  return c < 99 ? c : null;
});
const captureDown = computed(() => ['disconnected', 'offline', 'failed'].includes(snap.value?.capture ?? 'disconnected'));
</script>

<template>
  <div class="relative w-full h-full flex flex-col overflow-hidden"
    :class="[vertical ? 'max-w-[560px] mx-auto' : '']">
    <div v-if="!transparent" class="aurora" />
    <div v-if="!transparent" class="grain" />

    <!-- Electron 桌面窗口：拖动条 + 窗口控件 -->
    <div v-if="eb" class="eb-dragbar h-[26px] shrink-0 flex items-center justify-end gap-1.5 px-2 select-none">
      <button class="eb-btn w-[24px] h-[20px] rounded-md text-[11px] transition-colors"
        :class="pinned ? 'bg-amber-400/25 text-amber-200' : 'bg-white/10 text-white/55'"
        title="置顶开关" @click="togglePin">📌</button>
      <button v-if="!through" class="eb-btn w-[24px] h-[20px] rounded-md text-[11px] bg-white/10 text-white/55 hover:bg-white/20"
        title="鼠标穿透（点击落到下层窗口）· Ctrl+Alt+B 解锁" @click="toggleThrough">🖱</button>
      <button v-else class="eb-btn w-[24px] h-[20px] rounded-md text-[11px] bg-rose-400/30 text-rose-200"
        title="已鼠标穿透 · 点此解锁" @click="unlock">🔓</button>
      <button class="eb-btn w-[24px] h-[20px] rounded-md text-[11px] bg-white/10 text-white/55 hover:bg-rose-400/40"
        title="关闭窗口" @click="eb.close()">✕</button>
    </div>
    <div v-if="eb && through" class="glass rounded-lg px-3 py-1 text-[11px] text-amber-200/90 text-center shrink-0 mx-2">
      已鼠标穿透 · 按 Ctrl+Alt+B 解锁
    </div>

    <div class="relative z-10 flex flex-col h-full px-3.5 pt-3 gap-2.5" :class="vertical ? 'text-[15px]' : ''">

      <!-- 顶行：轮换框 + 标头 -->
      <div class="flex items-center gap-3">
        <RotatingBox :roundSecs="roundSecsLeft" />
        <div class="flex-1 min-w-0 flex flex-col gap-2">
          <div class="glass rounded-2xl px-4 py-2.5 flex items-center justify-between gap-2">
            <div class="min-w-0">
              <div class="flex items-center gap-2">
                <span class="text-[15px] font-bold truncate">{{ snap?.room.anchor || '点赞排行榜' }}</span>
                <span class="text-[10px] px-1.5 py-px rounded bg-white/10 text-white/60 shrink-0">{{ snap?.round.basis === 'session' ? '本场榜' : `第 ${snap?.round.idx ?? 1} 轮` }}</span>
              </div>
              <div class="text-[11px] text-white/50 mt-0.5">
                房间 {{ snap?.room.webRid || '—' }} · <span class="num-go">{{ fmtNum(snap?.room.online ?? 0) }}</span> 在线
                <span v-if="roundSecsLeft >= 0" class="ml-1.5 text-amber-200/80">· ⏱ {{ fmtTime(roundSecsLeft * 1000) }} 后结算</span>
              </div>
            </div>
            <div class="text-right shrink-0">
              <div class="flex items-baseline gap-1 justify-end">
                <span class="num-go text-[24px] font-black bg-gradient-to-b from-rose-200 to-rose-400 bg-clip-text text-transparent">
                  {{ fmtNum(Math.round(sessionDisplay)) }}
                </span>
                <span class="text-[11px] text-rose-200/70">本场赞</span>
              </div>
              <div class="text-[11px] text-white/45">
                💨 {{ fmtNum(snap?.room.ratePerMin ?? 0) }}/分
                <span v-if="coverageWarn != null" class="ml-1 text-amber-300" :title="`捕获完整度 ${coverageWarn}%（断连缺口，不虚补）`">⚠ {{ coverageWarn }}%</span>
              </div>
            </div>
          </div>
          <div v-if="captureDown" class="glass rounded-xl px-3 py-1.5 text-[12px] text-amber-200/90 flex items-center gap-2">
            <span class="w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
            {{ snap?.capture === 'offline' ? '直播已下播，等待新场次…' : '捕获连接中断，自动恢复中…' }}
          </div>
        </div>
      </div>

      <!-- 领奖台 -->
      <Podium :rows="snap?.podium ?? []" />

      <!-- 榜单列表 -->
      <div class="flex-1 min-h-0 overflow-hidden relative">
        <RankList :rows="snap?.list ?? []" :max="maxRows" />
        <div class="pointer-events-none absolute bottom-0 left-0 right-0 h-8 bg-gradient-to-t from-[#070b18] to-transparent" v-if="!transparent" />
      </div>
    </div>

    <!-- 结算横幅 -->
    <Transition name="banner">
      <div v-if="showBanner && roState.settleBanner" class="absolute top-2 left-1/2 -translate-x-1/2 z-50 glass rounded-2xl px-6 py-3 flex items-center gap-4"
        style="border-color: rgba(255, 215, 106, 0.35)">
        <span class="text-[30px]">{{ roState.settleBanner.data.ceremony === 'record' ? '🏆' : '👑' }}</span>
        <div>
          <div class="text-[14px] font-bold">
            第 {{ roState.settleBanner.data.roundIdx }} 轮结算
            <span v-if="roState.settleBanner.data.recordBroken" class="ml-1 text-amber-300">· 新纪录！</span>
          </div>
          <div class="text-[12px] text-white/70 mt-0.5">
            <template v-for="(t, i) in roState.settleBanner.data.top.filter(x => x.rank <= 3)" :key="t.secUid">
              <span :class="t.rank === 1 ? 'text-amber-300 font-bold' : ''">{{ ['🥇', '🥈', '🥉'][t.rank - 1] }} {{ t.nick }} {{ fmtNum(t.likes) }}</span>
              <span v-if="i < 2" class="mx-1 text-white/30">|</span>
            </template>
          </div>
        </div>
      </div>
    </Transition>

    <!-- 里程碑闪屏 -->
    <Transition name="mile">
      <div v-if="roState.milestone" class="absolute inset-0 z-50 flex items-center justify-center pointer-events-none">
        <div class="text-center">
          <div class="text-[42px] font-black bg-gradient-to-b from-amber-200 via-rose-300 to-purple-400 bg-clip-text text-transparent drop-shadow-lg">
            🎉 {{ fmtNum(roState.milestone.value) }} 赞！
          </div>
          <div class="text-[15px] text-white/70 mt-1 tracking-widest">全场点赞里程碑达成</div>
        </div>
      </div>
    </Transition>

    <!-- 水印（低调，主播可忽略；观众侧不显眼） -->
    <div class="absolute bottom-0.5 right-2 text-[10px] text-white/25 select-none pointer-events-none z-30 tracking-wide">
      LikeBoard v0.1.1
    </div>

    <Confetti ref="confetti" />
  </div>
</template>
