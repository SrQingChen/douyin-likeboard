<script setup lang="ts">
import { computed, ref, onMounted, onScopeDispose, watch } from 'vue';
import type { SpeedSurge } from '../shared/types';
import { roState, connectWs, clearMilestone } from '../shared/store';
import { useCountUp, fmtNum, fmtTime, isAuthor } from '../shared/format';
import { APP_VERSION } from '../shared/version';
import RotatingBox from './RotatingBox.vue';
import Podium from './Podium.vue';
import RankList from './RankList.vue';
import Confetti from './Confetti.vue';

// ── 窗口参数：?transparent=1（OBS）&layout=vertical（竖屏）&max=50 ──
const qs = new URLSearchParams(location.search);
const transparent = qs.get('transparent') === '1';
const vertical = qs.get('layout') === 'vertical';
const wide = qs.get('layout') === 'wide';
const chroma = qs.get('chroma') === '1';
// 展示条数：?max= 显式指定（控制台展开预览用 100），否则跟随设置里的 boardCount
const maxRows = computed(() => {
  const raw = qs.get('max');
  const n = Number(raw);
  if (raw && Number.isFinite(n) && n > 0) return n;
  return roState.snap?.boardCount ?? 50;
});
if (transparent) document.body.classList.add('transparent-mode');
if (chroma) document.body.classList.add('chroma-mode');

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

// ── 高能冲刺状态（快照为权威源；1s 时钟驱动倒计时）──
const surgeWave = computed<SpeedSurge | null>(() => {
  const g = roState.surge; void nowTick.value;
  return g && Date.now() < g.endsAt ? g : null;
});
const surgeRemain = computed(() => surgeWave.value
  ? Math.max(0, Math.ceil((surgeWave.value.endsAt - nowTick.value) / 1000)) : 0);
const surgeThreshold = computed(() => snap.value?.surgeThreshold ?? 300);
const roundMinutes = computed(() => {
  const r = snap.value?.round;
  if (!r?.endsAt) return null;
  return Math.max(1, Math.round((r.endsAt - r.startedAt) / 60_000));
});

// ── 结算横幅 + 彩带分级 ──
const confetti = ref<InstanceType<typeof Confetti> | null>(null);
const showBanner = ref(false);
// 结算瞬间关闭列表 FLIP：整榜重置时逐行飞太乱，定格后直接切到新轮
const settling = ref(false);
let confettiTimer = 0;
let settleTimer = 0;
watch(() => roState.settleBanner?.id, (id) => {
  if (!id) return;
  const d = roState.settleBanner!.data;
  settling.value = true;
  clearTimeout(settleTimer);
  settleTimer = window.setTimeout(() => (settling.value = false), 2200);
  if (d.ceremony === 'record' || d.ceremony === 'champion') {
    confetti.value?.burst();
    // 1.6s 后再补一发，让彩带覆盖整个结算镜头
    clearTimeout(confettiTimer);
    confettiTimer = window.setTimeout(() => confetti.value?.burst(), 1600);
  }
  showBanner.value = true;
  setTimeout(() => (showBanner.value = false), 9000);
});
watch(() => roState.milestone?.id, () => {
  setTimeout(clearMilestone, 3200);
});

onMounted(() => connectWs());
onScopeDispose(() => { clearInterval(clock); clearTimeout(confettiTimer); clearTimeout(settleTimer); });

const coverage = computed(() => Math.round(snap.value?.room.coverage ?? 100));
const coverageWarn = computed(() => {
  const c = coverage.value;
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

    <div class="relative z-10 flex flex-col h-full px-3.5 pt-3 gap-2.5"
      :class="[vertical ? 'text-[15px]' : '', wide ? 'max-w-[1560px] w-full mx-auto px-6 pt-4 gap-3' : '']">

      <!-- 顶行：轮换框 + 标头 -->
      <div class="flex items-center gap-3">
        <RotatingBox :roundSecs="roundSecsLeft" />
        <div class="flex-1 min-w-0 flex flex-col gap-2">
          <div class="glass rounded-2xl px-4 py-2.5 flex items-center justify-between gap-2">
            <div class="min-w-0">
              <div class="flex items-center gap-2">
                <span class="text-[10px] px-1.5 py-px rounded bg-amber-400/15 text-amber-200 border border-amber-300/30 font-bold shrink-0">点赞统计</span>
                <span class="text-[15px] font-bold truncate">{{ snap?.room.anchor || '多功能点赞统计助手' }}</span>
                <span class="text-[10px] px-1.5 py-px rounded bg-white/10 text-white/60 shrink-0">{{ snap?.round.basis === 'session' ? '本场榜' : `第 ${snap?.round.idx ?? 1} 轮` }}</span>
              </div>
              <div class="text-[11px] text-white/50 mt-0.5">
                房间 {{ snap?.room.webRid || '—' }} · <span class="num-go">{{ snap?.room.online ? fmtNum(snap.room.online) : '—' }}</span> 在线
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
                <span class="ml-1" :class="coverageWarn != null ? 'text-amber-300' : 'text-white/35'"
                  :title="`全局捕获完整度 ${coverage}%（抽样下发，缺口如实展示不虚补）`">
                  · 完整度 {{ coverage }}%<template v-if="coverageWarn != null"> ⚠</template>
                </span>
              </div>
            </div>
          </div>
          <div v-if="captureDown" class="glass rounded-xl px-3 py-1.5 text-[12px] text-amber-200/90 flex items-center gap-2">
            <span class="w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
            {{ snap?.capture === 'offline' ? '直播已下播，等待新场次…' : '捕获连接中断，自动恢复中…' }}
          </div>
        </div>
      </div>

      <!-- ── 16:9 宽屏布局（demo / PC 直播伴侣）── -->
      <template v-if="wide">
        <div class="flex-1 min-h-0 flex gap-4">
          <!-- 左：领奖台 + 本场速览 + 玩法说明 -->
          <div class="w-[640px] shrink-0 flex flex-col gap-3 min-h-0">
            <Podium big :rows="snap?.podium ?? []" :surge="surgeWave" />

            <div class="grid grid-cols-3 gap-2">
              <div class="glass rounded-xl px-3 py-2">
                <div class="text-[10px] text-white/45">本场点赞</div>
                <div class="num-go text-[19px] font-black text-rose-200">{{ fmtNum(Math.round(sessionDisplay)) }}</div>
              </div>
              <div class="glass rounded-xl px-3 py-2">
                <div class="text-[10px] text-white/45">参与赞友</div>
                <div class="num-go text-[19px] font-black text-sky-200">{{ fmtNum(snap?.stats.likers ?? 0) }}</div>
              </div>
              <div class="glass rounded-xl px-3 py-2">
                <div class="text-[10px] text-white/45">全场速率</div>
                <div class="num-go text-[19px] font-black text-amber-200">{{ fmtNum(snap?.room.ratePerMin ?? 0) }}<span class="text-[11px] font-semibold opacity-70">/分</span></div>
              </div>
            </div>

            <div class="glass rounded-2xl p-4 flex-1 min-h-0 flex flex-col justify-start gap-3.5">
              <div class="flex items-center justify-between">
                <span class="text-[14px] font-bold text-amber-200 tracking-wide">功能说明</span>
                <span class="text-[10px] text-white/40">多功能点赞统计助手 · 纯点赞维度</span>
              </div>
              <div class="flex items-center gap-3">
                <span class="rule-icon">❤️</span>
                <div><div class="text-[13.5px] font-semibold">点赞即参与</div>
                  <div class="text-[11.5px] text-white/50">纯点赞参与，完全免费</div></div>
              </div>
              <div class="flex items-center gap-3">
                <span class="rule-icon">🏆</span>
                <div><div class="text-[13.5px] font-semibold">{{ roundMinutes ? `每 ${roundMinutes} 分钟结算 · 前三登台` : '实时结算 · 前三登台' }}</div>
                  <div class="text-[11.5px] text-white/50">冠军皇冠 + 冠亚季军领奖台</div></div>
              </div>
              <div class="flex items-center gap-3">
                <span class="rule-icon">⚡</span>
                <div><div class="text-[13.5px] font-semibold">高能冲刺 · 近 10 秒 ≥{{ fmtNum(surgeThreshold) }} 赞/分</div>
                  <div class="text-[11.5px] text-white/50">冲榜用户鎏金流光 + 前三金色光环粒子</div></div>
              </div>
              <div class="flex items-center gap-3">
                <span class="rule-icon">💬</span>
                <div><div class="text-[13.5px] font-semibold">评论「加入」</div>
                  <div class="text-[11.5px] text-white/50">全场欢迎播报</div></div>
              </div>
              <div class="flex items-center gap-3">
                <span class="rule-icon">👑</span>
                <div><div class="text-[13.5px] font-semibold">纪录与徽章</div>
                  <div class="text-[11.5px] text-white/50">N 冠王 · 连霸纪录 · 单轮纪录轮换展示</div></div>
              </div>
              <div class="mt-auto pt-3 border-t border-white/10 text-[11px] text-white/45">
                ⚖️ 公平性：榜单只按点赞数排名，无任何付费加成
              </div>
            </div>
          </div>

          <!-- 右：实时榜单 -->
          <div class="flex-1 min-w-0 min-h-0 flex flex-col">
            <div class="flex items-center justify-between px-1 mb-1.5">
              <div class="flex items-baseline gap-2">
                <span class="text-[14px] font-bold">实时榜单</span>
                <span class="text-[11px] text-white/40">TOP {{ maxRows }} · 每秒刷新</span>
              </div>
              <div class="text-[11px] text-white/45">参与 <span class="text-white/80">{{ fmtNum(snap?.stats.likers ?? 0) }}</span> 人</div>
            </div>
            <div class="flex-1 min-h-0 overflow-hidden relative">
              <RankList :rows="snap?.list ?? []" :max="maxRows" :settling="settling" />
              <div class="pointer-events-none absolute bottom-0 left-0 right-0 h-14 bg-gradient-to-t from-[#070b18] to-transparent" v-if="!transparent" />
            </div>
          </div>
        </div>
      </template>

      <!-- ── 竖屏/默认布局（直播叠加）── -->
      <template v-else>
        <!-- 领奖台 -->
        <Podium :rows="snap?.podium ?? []" :surge="surgeWave" />

        <!-- 榜单列表 -->
        <div class="flex-1 min-h-0 overflow-hidden relative">
          <RankList :rows="snap?.list ?? []" :max="maxRows" :settling="settling" />
          <div class="pointer-events-none absolute bottom-0 left-0 right-0 h-8 bg-gradient-to-t from-[#070b18] to-transparent" v-if="!transparent" />
        </div>
      </template>
    </div>

    <!-- 高能冲刺鎏金横幅（4s 续期） -->
    <Transition name="surge">
      <div v-if="surgeWave" class="absolute bottom-4 left-1/2 -translate-x-1/2 z-50 glass rounded-2xl px-5 py-2.5 flex items-center gap-3"
        style="border-color: rgba(255, 215, 106, 0.45)">
        <span class="text-[26px] surge-mark">⚡</span>
        <div>
          <div class="text-[13.5px] font-bold text-amber-200" :class="{ 'author-rainbow': isAuthor(surgeWave.secUid) }">{{ surgeWave.nick }} 高能冲刺中</div>
          <div class="text-[11px] text-amber-100/70">近 10 秒 {{ fmtNum(surgeWave.speed) }} 赞/分 · 鎏金流光 {{ surgeRemain }}s</div>
        </div>
      </div>
    </Transition>

    <!-- 评论「加入」播报（3.5s） -->
    <Transition name="chat">
      <div v-if="roState.chat" class="absolute left-1/2 -translate-x-1/2 z-50 glass rounded-xl px-4 py-2 flex items-center gap-2"
        :class="wide ? 'top-[142px]' : 'bottom-16'"
        style="border-color: rgba(125, 211, 252, 0.32)">
        <span class="text-[16px]">💬</span>
        <span class="text-[13px] text-white/85"><b class="text-sky-200" :class="{ 'author-rainbow': isAuthor(roState.chat.secUid) }">{{ roState.chat.nick }}</b> 评论「加入」 · 欢迎来到直播间</span>
      </div>
    </Transition>

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
              <span :class="t.rank === 1 ? 'text-amber-300 font-bold' : ''">{{ ['🥇', '🥈', '🥉'][t.rank - 1] }}
                <span :class="{ 'author-rainbow': isAuthor(t.secUid) }">{{ t.nick }}</span> {{ fmtNum(t.likes) }}</span>
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
      多功能点赞统计助手 v{{ APP_VERSION }}
    </div>

    <Confetti ref="confetti" />
  </div>
</template>
