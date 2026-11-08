<script setup lang="ts">
// 冠亚季军领奖台：中央冠军高台 + 皇冠 + 徽章冠名 + 实时数字滚动
import { computed, ref, watch } from 'vue';
import type { BoardRow } from '../shared/types';
import AvatarBubble from './AvatarBubble.vue';
import MarqueeText from './MarqueeText.vue';
import { useCountUp, fmtNum } from '../shared/format';

const props = defineProps<{ rows: BoardRow[]; compact?: boolean }>();

// 视觉顺序：亚军 | 冠军 | 季军（并列时按数组序取前三）
const cells = computed(() => {
  const byRank = (r: number) => props.rows.filter(x => x.rank === r);
  const first = byRank(1)[0] ?? null;
  const second = byRank(2)[0] ?? null;
  const third = byRank(3)[0] ?? null;
  return [
    { row: second, rank: 2, h: 76, ring: 'avatar-ring-2', pedestal: 'pedestal-2', label: '亚军', color: 'text-slate-200' },
    { row: first, rank: 1, h: 108, ring: 'avatar-ring-1', pedestal: 'pedestal-1', label: '冠军', color: 'text-amber-300' },
    { row: third, rank: 3, h: 60, ring: 'avatar-ring-3', pedestal: 'pedestal-3', label: '季军', color: 'text-orange-300' },
  ];
});

// 冠军数字放大展示
const champLikes = computed(() => props.rows.find(x => x.rank === 1)?.likes ?? 0);
const champDisplay = useCountUp(champLikes);
</script>

<template>
  <div class="flex items-end justify-center gap-3 sm:gap-5 w-full px-2" v-if="rows.length">
    <div v-for="cell in cells" :key="cell.rank" class="flex flex-col items-center" style="flex:1;max-width:190px">
      <template v-if="cell.row">
        <!-- 冠军皇冠 -->
        <div v-if="cell.rank === 1" class="crown-float mb-[-6px] z-10">
          <svg width="34" height="24" viewBox="0 0 34 24" fill="none">
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
        <AvatarBubble :secUid="cell.row.secUid" :nick="cell.row.nick" :size="cell.rank === 1 ? 76 : 58" :ring="cell.ring" />
        <MarqueeText v-if="cell.rank !== 1" :text="cell.row.nick" class="mt-1.5 text-[14px] font-semibold w-full text-center" />
        <div v-if="cell.row.capped" class="capped-mark text-[11px] text-amber-300/90 mt-0.5">⚖️ 已封顶</div>
        <!-- 冠军大数字 -->
        <div v-if="cell.rank === 1" class="mt-1 flex items-baseline gap-1">
          <span class="num-go text-[30px] font-black text-amber-300 drop-shadow-[0_0_14px_rgba(255,215,106,0.45)]">
            {{ fmtNum(Math.round(champDisplay)) }}
          </span>
          <span class="text-[12px] text-amber-200/70">赞</span>
          <span v-if="cell.row.speed > 0" class="ml-1 text-[12px] text-sky-300/90">⚡{{ fmtNum(cell.row.speed) }}/分</span>
        </div>
        <div v-else class="num-go text-[18px] font-extrabold" :class="cell.color">
          {{ fmtNum(cell.row.likes) }}
          <span class="text-[10px] opacity-60" v-if="cell.row.speed > 0">⚡{{ fmtNum(cell.row.speed) }}</span>
        </div>
        <!-- 奖台 -->
        <div class="pedestal w-full mt-2 flex items-start justify-center pt-1.5" :class="cell.pedestal" :style="{ height: cell.h + 'px' }">
          <span class="text-[26px] font-black opacity-70" :class="cell.color">{{ cell.rank }}</span>
        </div>
      </template>
      <template v-else>
        <div class="w-full mt-2 pedestal opacity-30 flex items-start justify-center pt-1.5" :class="cell.pedestal" :style="{ height: cell.h + 'px' }">
          <span class="text-[22px] font-black text-white/40">{{ cell.rank }}</span>
        </div>
      </template>
    </div>
  </div>
</template>
