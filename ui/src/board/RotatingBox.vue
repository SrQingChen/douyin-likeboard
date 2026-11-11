<script setup lang="ts">
// 方形轮换框：纪录池 + 实时动态项，6s 轮换（点击立即切换）
import { computed, ref, onMounted, onScopeDispose } from 'vue';
import { roState } from '../shared/store';
import { fmtNum } from '../shared/format';
import MarqueeText from './MarqueeText.vue';

const props = defineProps<{ roundSecs: number }>();

interface Item { key: string; icon: string; label: string; value: string; sub: string }

const idx = ref(0);
const paused = ref(false);

const items = computed<Item[]>(() => {
  const s = roState.snap;
  if (!s) return [];
  const r = s.records;
  const list: Item[] = [
    { key: 'championMost', icon: '👑', label: '登顶之王', value: r.holders?.champion ? `${r.holders.champion.v} 冠` : '—',
      sub: r.holders?.champion?.nick ?? '虚位以待' },
    { key: 'sessionMost', icon: '🔥', label: '本场之最', value: r.sessionMost ? fmtNum(r.sessionMost.likes) + ' 赞' : '—',
      sub: r.sessionMost?.nick ?? '虚位以待' },
    { key: 'fastest', icon: '⚡', label: '手速之王', value: r.fastest ? fmtNum(r.fastest.speed) + ' 赞/分' : '—',
      sub: r.fastest?.nick ?? '虚位以待' },
    { key: 'roundRecord', icon: '🏅', label: '单轮纪录', value: r.roundRecord ? fmtNum(r.roundRecord.v) + ' 赞' : '—',
      sub: r.roundRecord ? `${r.roundRecord.nick || '无名英雄'}` : '虚位以待' },
    { key: 'streak', icon: '🔗', label: '连霸纪录', value: r.streakRecord ? `${r.streakRecord.v} 连冠` : '—',
      sub: r.streakRecord?.nick || '虚位以待' },
    { key: 'runnerMost', icon: '🥈', label: '亚军专业户', value: r.holders?.runner ? `${r.holders.runner.v} 次` : '—',
      sub: r.holders?.runner?.nick ?? '虚位以待' },
    { key: 'thirdMost', icon: '🥉', label: '季军常客', value: r.holders?.third ? `${r.holders.third.v} 次` : '—',
      sub: r.holders?.third?.nick ?? '虚位以待' },
    { key: 'globalTotal', icon: '🏦', label: '累计之最', value: fmtNum(r.global.totalLikes) + ' 赞', sub: `全库 ${fmtNum(r.global.users)} 位赞友` },
    { key: 'likers', icon: '👥', label: '舰队规模', value: fmtNum(s.stats.likers) + ' 人', sub: `本场已出手点赞` },
    { key: 'rate', icon: '💨', label: '全房实时速率', value: fmtNum(s.room.ratePerMin) + ' 赞/分', sub: `峰值 ${fmtNum(s.room.peakRate)}` },
  ];
  if (props.roundSecs >= 0) {
    const mm = String(Math.floor(props.roundSecs / 60)).padStart(2, '0');
    const ss = String(props.roundSecs % 60).padStart(2, '0');
    const top = s.podium.find(p => p.rank === 1);
    list.splice(2, 0, { key: 'countdown', icon: '⏱', label: '决战倒计时', value: `${mm}:${ss}`,
      sub: top ? `轮王 ${top.nick}` : '群雄逐鹿' });
  }
  return list;
});

const current = computed(() => items.value[idx.value % Math.max(1, items.value.length)] ?? null);

let timer = 0;
onMounted(() => {
  timer = window.setInterval(() => { if (!paused.value && items.value.length) idx.value = (idx.value + 1) % items.value.length; }, 6000);
});
onScopeDispose(() => clearInterval(timer));
const next = () => { idx.value = (idx.value + 1) % Math.max(1, items.value.length); };
</script>

<template>
  <div v-if="current" class="glass rounded-2xl w-[172px] h-[172px] relative overflow-hidden cursor-pointer shrink-0"
    :title="`轮换中 · 共 ${items.length} 项（点击切换）`" @click="next" @mouseenter="paused = true" @mouseleave="paused = false">
    <div class="absolute top-0 left-0 right-0 h-[3px] bg-gradient-to-r from-amber-300/0 via-amber-300/70 to-amber-300/0" />
    <Transition name="rb">
      <div :key="current.key" class="absolute inset-0 flex flex-col items-center justify-center gap-1.5 px-4 text-center">
        <div class="text-[30px] leading-none drop-shadow">{{ current.icon }}</div>
        <div class="text-[13px] tracking-[0.22em] text-white/55 font-medium">{{ current.label }}</div>
        <div class="num-go text-[26px] font-extrabold bg-gradient-to-b from-white to-white/70 bg-clip-text text-transparent leading-tight">
          {{ current.value }}
        </div>
        <MarqueeText :text="current.sub" class="w-full text-[13px] text-amber-200/90" />
      </div>
    </Transition>
    <div class="absolute bottom-1.5 left-0 right-0 flex justify-center gap-1">
      <span v-for="(it, i) in items" :key="it.key" class="w-1 h-1 rounded-full transition-all duration-300"
        :class="i === idx % items.length ? 'bg-amber-300 w-2.5' : 'bg-white/20'" />
    </div>
  </div>
</template>
