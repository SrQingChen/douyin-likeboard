<script setup lang="ts">
// 溢出才滚动的走马灯：短文本静止居中（修复"虚位以待"右移问题），
// 长文本滚动位移按实际宽度精确计算（不再写死容器宽度）。
import { ref, watch, nextTick, onMounted } from 'vue';

const props = defineProps<{ text: string }>();
const el = ref<HTMLElement | null>(null);
const overflow = ref(false);

async function measure() {
  await nextTick();
  const e = el.value;
  if (!e) return;
  const delta = e.scrollWidth - e.clientWidth;
  overflow.value = delta > 2;
  if (overflow.value) e.style.setProperty('--mq-shift', `-${delta + 8}px`);
}
watch(() => props.text, measure, { immediate: true, flush: 'post' });
onMounted(measure);
</script>

<template>
  <div ref="el" class="mq w-full" :class="{ 'mq-run': overflow }" :title="text">
    <span class="mq-inner">{{ text }}</span>
  </div>
</template>

<style scoped>
.mq { white-space: nowrap; overflow: hidden; text-align: center; }
.mq-run { text-align: left; }
.mq-inner { display: inline-block; padding: 0 4px; }
.mq-run .mq-inner { animation: mqScroll 9s linear infinite; }
@keyframes mqScroll {
  0%, 12% { transform: translateX(0); }
  86%, 100% { transform: translateX(var(--mq-shift, 0px)); }
}
</style>
