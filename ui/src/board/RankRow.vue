<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import type { BoardRow } from '../shared/types';
import AvatarBubble from './AvatarBubble.vue';
import GemFacets from './GemFacets.vue';
import { useCountUp, fmtNum, isAuthor } from '../shared/format';

const props = defineProps<{ row: BoardRow }>();
const target = computed(() => props.row.likes);
const disp = useCountUp(target);
const flashing = ref(false);
let lastSpeed = props.row.speed;
watch(() => props.row.speed, (v) => {
  if (v > lastSpeed + 40) { flashing.value = false; requestAnimationFrame(() => (flashing.value = true)); }
  lastSpeed = v;
});
</script>

<template>
  <div class="glass rounded-xl px-2.5 py-2 flex items-center gap-2.5 w-full relative overflow-hidden"
    :class="{ 'surge-shimmer': row.surge, 'gem-row': !!row.gemColor }">
    <!-- 作者 / 星守护：透明宝石质感（晶面 + 色散 + 流动高光；作者默认彩虹流光） -->
    <GemFacets v-if="row.gemColor" :seed="row.secUid" :color="row.gemColor" />
    <div class="relative z-10 flex items-center gap-2.5 w-full">
      <span class="num w-7 text-center text-[15px] font-black shrink-0"
        :class="row.rank <= 9 ? 'text-amber-200/90' : 'text-white/45'">{{ row.rank }}</span>
      <AvatarBubble :secUid="row.secUid" :nick="row.nick" :size="34" :avatar="row.avatar" />
      <div class="min-w-0 flex-1">
        <div class="flex items-center gap-1.5">
          <span class="truncate text-[13.5px] font-semibold text-white/90 max-w-[46%]"
            :class="{ 'author-rainbow': isAuthor(row.secUid) }"
            :title="isAuthor(row.secUid) ? '作者彩蛋 · Sr_青尘' : undefined">{{ row.nick }}</span>
          <span v-if="row.badge" class="px-1.5 rounded-full text-[10px] font-bold shrink-0 bg-white/10 text-white/70 border border-white/10">{{ row.badge }}</span>
          <span v-if="row.surge" class="surge-mark text-[12px] shrink-0" title="高能冲刺 · 近 10 秒点赞速度达标">⚡</span>
          <span v-if="row.capped" class="capped-mark text-[11px] shrink-0" title="推断：已触达点赞限额（休息一下）">⚖️封顶</span>
        </div>
        <div class="text-[11px] text-sky-300/80 h-4">
          <span v-if="row.speed > 0" :class="{ 'speed-pulse inline-block': flashing }">⚡ {{ fmtNum(row.speed) }} 赞/分</span>
        </div>
      </div>
      <div class="text-right shrink-0">
        <div class="num-go text-[17px] font-extrabold text-white">{{ fmtNum(Math.round(disp)) }}</div>
        <div class="text-[10px] text-white/40">累计 {{ fmtNum(row.storeTotalLikes) }}</div>
      </div>
    </div>
  </div>
</template>
