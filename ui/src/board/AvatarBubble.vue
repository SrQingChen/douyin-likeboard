<script setup lang="ts">
import { computed, ref } from 'vue';
import { avatarUrl } from '../shared/format';

const props = defineProps<{ secUid: string; nick: string; size: number; ring?: string }>();
const failed = ref(false);
const initials = computed(() => (props.nick || '赞')[0]);
// 渐变占位色：由 secUid 派生稳定色相
const hue = computed(() => {
  let h = 0; for (const c of props.secUid) h = (h * 31 + c.charCodeAt(0)) % 360;
  return h;
});
</script>

<template>
  <div class="relative inline-flex items-center justify-center rounded-full overflow-hidden select-none"
    :class="ring" :style="{ width: size + 'px', height: size + 'px' }">
    <img v-if="!failed" :src="avatarUrl(secUid)" :alt="nick" class="w-full h-full object-cover"
      loading="lazy" referrerpolicy="no-referrer" @error="failed = true" />
    <div v-else class="w-full h-full flex items-center justify-center font-bold text-white"
      :style="{ background: `linear-gradient(135deg, hsl(${hue} 65% 42%), hsl(${(hue + 60) % 360} 65% 32%))`, fontSize: size * 0.42 + 'px' }">
      {{ initials }}
    </div>
    <div class="absolute inset-0 rounded-full ring-1 ring-white/20 pointer-events-none" />
  </div>
</template>
