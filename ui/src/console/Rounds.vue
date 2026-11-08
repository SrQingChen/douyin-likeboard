<script setup lang="ts">
// 轮次历史：结算记录 + 单轮详情（前三甲高亮 + Top20）
import { ref, onMounted } from 'vue';
import { api } from './api';
import { fmtNum, fmtClock } from '../shared/format';

const rows = ref<any[]>([]);
const total = ref(0);
const page = ref(0);
const detail = ref<any>(null);
const PAGE = 20;

const typeLabel: Record<string, string> = {
  auto: '自动', manual: '手动', 'session-end': '终场', offline: '下播',
  'room-switch': '换房', shutdown: '关机', interrupted: '中断存档', empty: '空轮',
};

async function load() {
  const r = await api(`/api/rounds?limit=${PAGE}&offset=${page.value * PAGE}`);
  rows.value = r.rows; total.value = r.total;
}
onMounted(load);

async function open(id: number) {
  try { detail.value = await api(`/api/rounds/${id}`); } catch {}
}
const pages = () => Math.max(1, Math.ceil(total.value / PAGE));
</script>

<template>
  <div class="max-w-[900px] mx-auto">
    <div class="glass rounded-2xl overflow-hidden">
      <table>
        <thead><tr>
          <th>轮次</th><th>冠军</th><th class="num">冠军赞数</th><th>结算方式</th><th>开始</th><th>结束</th><th></th>
        </tr></thead>
        <tbody>
          <tr v-for="r in rows" :key="r.id" class="cursor-pointer" @click="open(r.id)">
            <td class="font-bold">#{{ r.idx }}</td>
            <td class="font-semibold text-amber-200">{{ r.top1_nick ?? '—' }}</td>
            <td class="num font-bold">{{ r.top1_likes != null ? fmtNum(r.top1_likes) : '—' }}</td>
            <td><span class="px-2 py-px rounded-full text-[11px] bg-white/8 border border-white/10">{{ typeLabel[r.settle_type] ?? r.settle_type }}</span></td>
            <td class="text-white/45 text-[12px]">{{ fmtClock(r.started_at) }}</td>
            <td class="text-white/45 text-[12px]">{{ r.ended_at ? fmtClock(r.ended_at) : '进行中' }}</td>
            <td class="text-sky-300/80 text-[12px]">详情 →</td>
          </tr>
        </tbody>
      </table>
      <div v-if="!rows.length" class="p-8 text-center text-white/35 text-[13px]">暂无结算记录</div>
    </div>
    <div class="flex items-center justify-center gap-3 mt-4" v-if="pages() > 1">
      <button class="btn" :disabled="page === 0" @click="page--; load()">← 上一页</button>
      <span class="text-[12px] text-white/50">{{ page + 1 }} / {{ pages() }}</span>
      <button class="btn" :disabled="page >= pages() - 1" @click="page++; load()">下一页 →</button>
    </div>

    <Teleport to="body">
      <div v-if="detail" class="fixed inset-0 z-50 flex items-center justify-center p-6" @click.self="detail = null">
        <div class="absolute inset-0 bg-black/55" @click="detail = null" />
        <div class="relative glass rounded-2xl w-[520px] max-h-[80vh] overflow-auto p-5">
          <div class="flex items-center justify-between mb-3">
            <h3 class="font-bold">第 {{ detail.round.idx }} 轮 · Top 20</h3>
            <button class="btn" @click="detail = null">✕</button>
          </div>
          <table>
            <thead><tr><th>名次</th><th>昵称</th><th class="num">本轮点赞</th></tr></thead>
            <tbody>
              <tr v-for="t in detail.top" :key="t.sec_uid">
                <td class="font-black" :class="t.rank === 1 ? 'text-amber-300' : t.rank <= 3 ? 'text-white/80' : 'text-white/40'">
                  {{ ['🥇', '🥈', '🥉'][t.rank - 1] ?? t.rank }}
                </td>
                <td class="font-semibold">{{ t.nick ?? '（档案缺失）' }}</td>
                <td class="num font-bold">{{ fmtNum(t.likes) }}</td>
              </tr>
            </tbody>
          </table>
          <div v-if="!detail.top.length" class="p-6 text-center text-white/35 text-[13px]">该轮无有效点赞（中断存档）</div>
        </div>
      </div>
    </Teleport>
  </div>
</template>
