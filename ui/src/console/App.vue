<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { roState, connectWs } from '../shared/store';
import Dashboard from './Dashboard.vue';
import Users from './Users.vue';
import Rounds from './Rounds.vue';
import Settings from './Settings.vue';

const tab = ref<'dashboard' | 'users' | 'rounds' | 'settings'>('dashboard');
const tabs = [
  { key: 'dashboard', label: '概览' },
  { key: 'users', label: '用户库' },
  { key: 'rounds', label: '轮次' },
  { key: 'settings', label: '设置' },
] as const;

import { APP_VERSION } from '../shared/version';

const snap = computed(() => roState.snap);
const captureLabel = computed(() => ({
  disconnected: ['未连接', 'bg-slate-500'],
  starting: ['启动中', 'bg-amber-400 animate-pulse'],
  connected: ['已连接', 'bg-sky-400'],
  watching: ['监听中', 'bg-emerald-400'],
  restarting: ['重启中', 'bg-amber-400 animate-pulse'],
  offline: ['已下播', 'bg-violet-400'],
  risk: ['⚠风控信号', 'bg-rose-500 animate-pulse'],
  failed: ['失败', 'bg-rose-500'],
} as Record<string, [string, string]>)[snap.value?.capture ?? 'disconnected'] ?? ['未知', 'bg-slate-500']);

const shuttingDown = ref(false);
const closed = ref(false);
async function shutdown() {
  if (!confirm('确认关闭系统？将结算当前轮次，并关闭捕获浏览器和榜单窗口。')) return;
  shuttingDown.value = true;
  try { await fetch('/api/shutdown', { method: 'POST' }); } catch {}
  document.title = '已关闭 · 多功能点赞统计助手';
  closed.value = true;
}
function closeTab() { try { window.close(); } catch {} }
onMounted(() => connectWs());
</script>

<template>
  <div class="h-full flex flex-col">
    <header class="glass flex items-center gap-4 px-5 py-3 shrink-0" style="border-width:0 0 1px 0">
      <div class="flex items-center gap-2.5">
        <div class="w-8 h-8 rounded-xl bg-gradient-to-br from-amber-300 to-rose-400 flex items-center justify-center text-[16px]">👑</div>
        <div>
          <div class="font-bold text-[15px] leading-tight">多功能点赞统计助手 <span class="text-[10px] font-mono text-amber-300/70 align-middle">v{{ APP_VERSION }}</span></div>
          <div class="text-[11px] text-white/45">抖音直播间 · 被动旁听 · SrQingChen</div>
        </div>
      </div>
      <nav class="flex gap-1.5 ml-4">
        <button v-for="t in tabs" :key="t.key" class="btn" :class="{ 'tab-active': tab === t.key }" @click="tab = t.key">
          {{ t.label }}
        </button>
      </nav>
      <div class="flex-1" />
      <div class="flex items-center gap-3 text-[12px] text-white/60">
        <span class="flex items-center gap-1.5">
          <span class="w-2 h-2 rounded-full" :class="roState.connected ? 'bg-emerald-400' : 'bg-rose-400'" />
          实时{{ roState.connected ? '' : '断开' }}
        </span>
        <span class="flex items-center gap-1.5">
          <span class="w-2 h-2 rounded-full" :class="captureLabel[1]" />
          捕获·{{ captureLabel[0] }}
        </span>
        <a href="/board" target="_blank" class="btn">打开榜单 ↗</a>
        <button class="btn btn-danger" :disabled="shuttingDown" @click="shutdown">
          {{ shuttingDown ? '关闭中…' : '⏻ 关闭系统' }}
        </button>
      </div>
    </header>
    <main class="flex-1 min-h-0 overflow-auto p-5">
      <Dashboard v-if="tab === 'dashboard'" />
      <Users v-else-if="tab === 'users'" />
      <Rounds v-else-if="tab === 'rounds'" />
      <Settings v-else />
    </main>
    <footer class="shrink-0 text-center text-[10.5px] text-white/25 py-1.5 border-t border-white/5">
      多功能点赞统计助手 v{{ APP_VERSION }} · GPL-3.0 · SrQingChen · 纯被动旁听，不发送任何数据
    </footer>

    <!-- 关闭完成页：明确告知已结算、捕获浏览器与榜单窗口已关闭 -->
    <div v-if="closed" class="fixed inset-0 z-[100] flex flex-col items-center justify-center gap-4 px-6"
      style="background: #060914">
      <div class="text-[46px]">👋</div>
      <div class="text-[20px] font-bold">系统已关闭</div>
      <p class="text-[13px] text-white/55 text-center leading-6">
        当前轮次已结算，数据已落盘；捕获浏览器与独立榜单窗口已自动关闭。<br />
        此标签页可以关闭了。
      </p>
      <button class="btn" @click="closeTab">关闭此标签页</button>
    </div>
  </div>
</template>
