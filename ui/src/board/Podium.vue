<script setup lang="ts">
// 冠亚季军领奖台：中央冠军高台 + 皇冠 + 徽章冠名 + 实时数字滚动
import { computed } from 'vue';
import type { BoardRow, SpeedSurge } from '../shared/types';
import AvatarBubble from './AvatarBubble.vue';
import MarqueeText from './MarqueeText.vue';
import SurgeParticles from './SurgeParticles.vue';
import GemFacets from './GemFacets.vue';
import { useCountUp, fmtNum, isAuthor } from '../shared/format';

const props = defineProps<{ rows: BoardRow[]; compact?: boolean; surge?: SpeedSurge | null; big?: boolean }>();

// 视觉顺序：亚军 | 冠军 | 季军（并列时按数组序取前三）
const cells = computed(() => {
  // 按榜单顺序取前 3 行（competition ranking 下可能出现 1/2/2 并列，
  // 若按名次过滤会空出季军台；这里用展示位 1/2/3，底层名次仍以数据为准）
  const first = props.rows[0] ?? null;
  const second = props.rows[1] ?? null;
  const third = props.rows[2] ?? null;
  const big = !!props.big;
  return [
    // grow：亚军 : 冠军 : 季军 = 0.9 : 1 : 0.8，用宽度比区分台位（不再固定等宽）
    { row: second, rank: 2, grow: 0.9, h: big ? 104 : 76, ring: 'avatar-ring-2', pedestal: 'pedestal-2', label: '亚军', color: 'text-slate-200' },
    { row: first, rank: 1, grow: 1, h: big ? 148 : 108, ring: 'avatar-ring-1', pedestal: 'pedestal-1', label: '冠军', color: 'text-amber-300' },
    { row: third, rank: 3, grow: 0.8, h: big ? 82 : 60, ring: 'avatar-ring-3', pedestal: 'pedestal-3', label: '季军', color: 'text-orange-300' },
  ];
});
const avatarSize = (rank: number) => rank === 1 ? (props.big ? 108 : 76) : (props.big ? 84 : 58);

// 奖台水晶：作者/星守用他们的宝石色（作者=彩虹），其他名次用金/银/铜晶台
const RANK_GEM = ['#f5c542', '#cbd5e1', '#d97706'];
const pedestalGem = (cell: { row: BoardRow | null; rank: number }) =>
  cell.row?.gemColor ?? RANK_GEM[cell.rank - 1];

// 冠军数字放大展示
const champLikes = computed(() => props.rows[0]?.likes ?? 0);
const champDisplay = useCountUp(champLikes);
</script>

<template>
  <div class="relative flex items-end justify-center gap-3 sm:gap-5 w-full px-2" v-if="rows.length">
    <div v-for="cell in cells" :key="cell.rank" class="flex flex-col items-center"
      :style="{ flexGrow: cell.grow, flexShrink: 1, flexBasis: 0, minWidth: 0 }">
      <template v-if="cell.row">
        <!-- 冠军皇冠 -->
        <div v-if="cell.rank === 1" class="crown-float mb-[-6px] z-10">
          <svg :width="big ? 46 : 34" :height="big ? 32 : 24" viewBox="0 0 34 24" fill="none">
            <path d="M3 20 L1 6 L10 12 L17 2 L24 12 L33 6 L31 20 Z" fill="url(#g1)" stroke="rgba(255,235,150,.9)" stroke-width="1.2"/>
            <circle cx="17" cy="16" r="2" fill="#fff8dc"/>
            <defs><linearGradient id="g1" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stop-color="#ffe9a3"/><stop offset="1" stop-color="#d9a514"/>
            </linearGradient></defs>
          </svg>
        </div>
        <!-- 徽章冠名（头像上方） -->
        <div v-if="cell.row.badge" class="mb-1 px-2 py-[1px] rounded-full text-[11px] font-bold whitespace-nowrap z-10"
          :class="cell.rank === 1 ? 'bg-amber-400/20 text-amber-200 border border-amber-300/40' : 'bg-white/10 text-white/80 border border-white/15'">
          {{ cell.row.badge }}
        </div>
        <div class="relative rounded-full" :class="{ 'surge-halo': !!surge }">
          <AvatarBubble :secUid="cell.row.secUid" :nick="cell.row.nick" :size="avatarSize(cell.rank)" :ring="cell.ring" :avatar="cell.row.avatar" />
        </div>
        <div v-if="cell.rank === 1" class="mt-1.5 w-full max-w-[200px] relative overflow-hidden rounded-md px-1.5"
          :class="{ 'surge-shimmer': surge?.secUid === cell.row.secUid }">
          <MarqueeText :text="cell.row.nick" class="text-[17px] font-bold text-amber-100"
            :class="{ 'author-rainbow': isAuthor(cell.row.secUid) }" />
        </div>
        <div v-else class="mt-1.5 w-full relative overflow-hidden rounded-md px-1"
          :class="{ 'surge-shimmer': surge?.secUid === cell.row.secUid }">
          <MarqueeText :text="cell.row.nick" class="font-semibold w-full text-center"
            :class="[big ? 'text-[16px]' : 'text-[14px]', { 'author-rainbow': isAuthor(cell.row.secUid) }]" />
        </div>
        <div v-if="cell.row.capped" class="capped-mark text-[11px] text-amber-300/90 mt-0.5">⚖️ 已封顶</div>
        <!-- 冠军大数字 -->
        <div v-if="cell.rank === 1" class="mt-1 flex items-baseline gap-1">
          <span class="num-go font-black text-amber-300 drop-shadow-[0_0_14px_rgba(255,215,106,0.45)]"
            :class="big ? 'text-[40px]' : 'text-[30px]'">
            {{ fmtNum(Math.round(champDisplay)) }}
          </span>
          <span class="text-[12px] text-amber-200/70">赞</span>
          <span v-if="cell.row.speed > 0" class="ml-1 text-[12px] text-sky-300/90">⚡{{ fmtNum(cell.row.speed) }}/分</span>
        </div>
        <div v-else class="num-go font-extrabold" :class="[cell.color, big ? 'text-[20px]' : 'text-[18px]']">
          {{ fmtNum(cell.row.likes) }}
          <span class="text-[10px] opacity-60" v-if="cell.row.speed > 0">⚡{{ fmtNum(cell.row.speed) }}</span>
        </div>
        <!-- 奖台（水晶质感：金/银/铜，作者/星守用其宝石色） -->
        <div class="pedestal w-full mt-2 flex items-start justify-center pt-1.5 relative overflow-hidden"
          :class="[cell.pedestal, 'pedestal-gem']" :style="{ height: cell.h + 'px' }">
          <GemFacets :seed="`podium-${cell.rank}-${cell.row.secUid}`" :color="pedestalGem(cell)" />
          <span class="relative z-10 font-black opacity-70" :class="[cell.color, big ? 'text-[34px]' : 'text-[26px]']">{{ cell.rank }}</span>
        </div>
      </template>
      <template v-else>
        <div class="w-full mt-2 pedestal opacity-30 flex items-start justify-center pt-1.5" :class="cell.pedestal" :style="{ height: cell.h + 'px' }">
          <span class="text-[22px] font-black text-white/40">{{ cell.rank }}</span>
        </div>
      </template>
    </div>
    <SurgeParticles v-if="surge" />
  </div>
</template>
