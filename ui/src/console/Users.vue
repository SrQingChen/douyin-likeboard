<script setup lang="ts">
// 用户库：搜索/排序/详情抽屉（昵称历史时间线 + 全量数据）
import { ref, onMounted } from 'vue';
import { api } from './api';
import { fmtNum, avatarUrl, fmtClock } from '../shared/format';
import AvatarBubble from '../board/AvatarBubble.vue';

const q = ref('');
const sort = ref('total_likes');
const page = ref(0);
const total = ref(0);
const rows = ref<any[]>([]);
const detail = ref<any>(null);
const loading = ref(false);

const sorts = [
  ['total_likes', '累计点赞'], ['champion', '冠军数'], ['runner', '亚军数'],
  ['third', '季军数'], ['best_speed', '峰值速度'], ['last_seen', '最近活跃'], ['first_seen', '初见'],
] as const;
const PAGE = 30;

async function load() {
  loading.value = true;
  try {
    const r = await api(`/api/users?q=${encodeURIComponent(q.value)}&sort=${sort.value}&limit=${PAGE}&offset=${page.value * PAGE}`);
    rows.value = r.rows; total.value = r.total;
  } finally { loading.value = false; }
}
onMounted(load);
function search() { page.value = 0; load(); }

async function open(secUid: string) {
  try { detail.value = await api(`/api/user/${encodeURIComponent(secUid)}`); } catch {}
}
const pages = () => Math.max(1, Math.ceil(total.value / PAGE));
</script>

<template>
  <div class="max-w-[1100px] mx-auto">
    <div class="flex gap-2 items-center mb-4">
      <input v-model="q" placeholder="搜索昵称 / ID" style="width: 240px" @keyup.enter="search" />
      <select v-model="sort" @change="search">
        <option v-for="[k, label] in sorts" :key="k" :value="k">按{{ label }}</option>
      </select>
      <button class="btn btn-primary" @click="search">搜索</button>
      <div class="flex-1" />
      <span class="text-[12px] text-white/45">共 {{ total }} 位赞友</span>
    </div>

    <div class="glass rounded-2xl overflow-hidden">
      <table>
        <thead><tr>
          <th style="width:36px"></th><th>昵称</th><th>徽章</th><th class="num">累计赞</th>
          <th class="num">🥇</th><th class="num">🥈</th><th class="num">🥉</th>
          <th class="num">峰值速度</th><th>初见</th><th>最近</th>
        </tr></thead>
        <tbody>
          <tr v-for="u in rows" :key="u.sec_uid" class="cursor-pointer" @click="open(u.sec_uid)">
            <td><AvatarBubble :secUid="u.sec_uid" :nick="u.nick" :size="28" /></td>
            <td class="max-w-[180px] truncate font-semibold">{{ u.nick }}</td>
            <td><span v-if="u.badge" class="px-1.5 py-px rounded-full text-[11px] bg-amber-400/15 text-amber-200 border border-amber-300/30">{{ u.badge }}</span>
                <span v-else class="text-white/25">—</span></td>
            <td class="num font-bold">{{ fmtNum(u.total_likes) }}</td>
            <td class="num">{{ u.champion || '' }}</td>
            <td class="num">{{ u.runner || '' }}</td>
            <td class="num">{{ u.third || '' }}</td>
            <td class="num text-sky-300/90">{{ u.best_speed ? fmtNum(u.best_speed) + '/分' : '—' }}</td>
            <td class="text-white/45 text-[12px]">{{ fmtClock(u.first_seen) }}</td>
            <td class="text-white/45 text-[12px]">{{ fmtClock(u.last_seen) }}</td>
          </tr>
        </tbody>
      </table>
      <div v-if="loading" class="p-4 text-center text-white/40 text-[13px]">加载中…</div>
      <div v-else-if="!rows.length" class="p-8 text-center text-white/35 text-[13px]">暂无数据 —— 打开一个直播间开始收集</div>
    </div>

    <div class="flex items-center justify-center gap-3 mt-4" v-if="pages() > 1">
      <button class="btn" :disabled="page === 0" @click="page--; load()">← 上一页</button>
      <span class="text-[12px] text-white/50">{{ page + 1 }} / {{ pages() }}</span>
      <button class="btn" :disabled="page >= pages() - 1" @click="page++; load()">下一页 →</button>
    </div>

    <!-- 详情抽屉 -->
    <Teleport to="body">
      <div v-if="detail" class="fixed inset-0 z-50 flex justify-end" @click.self="detail = null">
        <div class="absolute inset-0 bg-black/50" @click="detail = null" />
        <div class="relative glass w-[400px] h-full overflow-auto p-5" style="border-radius: 18px 0 0 18px; border-right: none">
          <div class="flex items-center gap-3 mb-4">
            <AvatarBubble :secUid="detail.user.sec_uid" :nick="detail.user.nick" :size="56" ring="avatar-ring-1" />
            <div class="min-w-0">
              <div class="font-bold text-[16px] truncate">{{ detail.user.nick }}</div>
              <div class="text-[11px] text-white/40 font-mono truncate">{{ detail.user.sec_uid }}</div>
            </div>
            <div class="flex-1" />
            <button class="btn" @click="detail = null">✕</button>
          </div>
          <div v-if="detail.live" class="mb-4 px-3 py-2 rounded-xl bg-emerald-400/10 border border-emerald-300/25 text-[12.5px] text-emerald-200">
            🟢 本场在线 · 已点 {{ fmtNum(detail.live.sessionLikes) }} 赞
          </div>
          <div class="grid grid-cols-2 gap-2 mb-4">
            <div class="glass rounded-xl p-3"><div class="num text-[18px] font-black text-amber-300">{{ fmtNum(detail.user.total_likes) }}</div><div class="text-[11px] text-white/50">累计点赞</div></div>
            <div class="glass rounded-xl p-3"><div class="num text-[18px] font-black">{{ detail.user.champion }}冠 {{ detail.user.runner }}亚 {{ detail.user.third }}季</div><div class="text-[11px] text-white/50">奖台次数</div></div>
            <div class="glass rounded-xl p-3"><div class="num text-[18px] font-black text-sky-300">{{ detail.user.best_speed ? fmtNum(detail.user.best_speed) + '/分' : '—' }}</div><div class="text-[11px] text-white/50">峰值手速</div></div>
            <div class="glass rounded-xl p-3"><div class="num text-[18px] font-black text-violet-300">{{ detail.user.sessions_seen }} 场 / {{ detail.user.rounds_seen }} 轮</div><div class="text-[11px] text-white/50">出场</div></div>
          </div>
          <h3 class="font-bold text-[13px] mb-2 text-white/70">🏷️ 昵称历史（{{ detail.nicknames.length }}）</h3>
          <div class="flex flex-col gap-1.5 mb-4">
            <div v-for="n in detail.nicknames" :key="n.nick" class="glass rounded-lg px-3 py-2 flex items-center justify-between text-[12.5px]">
              <span class="truncate">{{ n.nick }} <span v-if="n.masked" class="text-white/35">（打码）</span></span>
              <span class="text-white/40 shrink-0 ml-2 text-[11px]">{{ fmtClock(n.first_at) }} ~ {{ fmtClock(n.last_at) }} · {{ n.hits }} 次</span>
            </div>
          </div>
        </div>
      </div>
    </Teleport>
  </div>
</template>
