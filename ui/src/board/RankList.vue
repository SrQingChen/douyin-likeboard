<script setup lang="ts">
// 4~N 名列表：FLIP 位次动画 + 速度火花 + 限额封顶标记
import { computed } from 'vue';
import type { BoardRow } from '../shared/types';
import RankRow from './RankRow.vue';

const props = defineProps<{ rows: BoardRow[]; max?: number; settling?: boolean }>();
// rows 已是服务端切好的「第 4 名之后」列表（含并列导致的名次跳号）
const shown = computed(() => props.rows.slice(0, props.max ?? 50));
</script>

<template>
  <div class="relative w-full overflow-hidden">
    <TransitionGroup name="rank" tag="div" class="flex flex-col gap-1.5" :class="{ 'rank-reset': settling }">
      <RankRow v-for="row in shown" :key="row.secUid" :row="row" />
    </TransitionGroup>
    <div v-if="!shown.length" class="text-center text-white/35 text-sm py-8">
      榜单蓄力中 · 等待第一波点赞…
    </div>
  </div>
</template>
