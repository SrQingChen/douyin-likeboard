<script setup lang="ts">
// 用户库：搜索/排序/详情抽屉（昵称历史时间线 + 全量数据）
import { ref, computed, onMounted, onScopeDispose } from 'vue';
import { api, post, patch } from './api';
import { fmtNum, fmtClock, isAuthor } from '../shared/format';
import AvatarBubble from '../board/AvatarBubble.vue';
import GemFacets from '../board/GemFacets.vue';
import { roState } from '../shared/store';

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

// 用户库条目与榜单 4+ 同款：作者/星守显示宝石行。
// 优先用库里的手动色 → 当前榜单的实时色（每场随机）→ 作者彩虹 → 星守按 secUid 稳定取色。
const GEM_FALLBACK = ['#f43f5e', '#3b82f6', '#10b981', '#8b5cf6', '#f59e0b', '#06b6d4', '#ec4899', '#84cc16', '#e2e8f0'];
const liveGem = computed(() => {
  const m = new Map<string, string>();
  const s = roState.snap;
  if (s) for (const r of [...s.podium, ...s.list]) if (r.gemColor) m.set(r.secUid, r.gemColor);
  return m;
});
function gemOf(u: any): string | null {
  if (u.gem_color) return u.gem_color;
  const live = liveGem.value.get(u.sec_uid);
  if (live) return live;
  if (isAuthor(u.sec_uid)) return 'rainbow';
  if (u.star_guard) {
    let h = 0;
    for (const ch of String(u.sec_uid)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    return GEM_FALLBACK[h % GEM_FALLBACK.length];
  }
  return null;
}

// ── 宝石行配色（仅作者/星守护）：null=跟随默认，rainbow=彩虹流光，#RRGGBB=指定色 ──
const GEM_COLORS = ['#f43f5e', '#3b82f6', '#10b981', '#8b5cf6', '#f59e0b', '#06b6d4', '#ec4899', '#84cc16', '#e2e8f0'];
const gemBusy = ref(false);
const gemMsg = ref<string | null>(null);
async function setGem(color: string | null) {
  if (!detail.value || gemBusy.value) return;
  gemBusy.value = true; gemMsg.value = null;
  try {
    const r = await patch(`/api/user/${encodeURIComponent(detail.value.user.sec_uid)}/gem`, { color });
    detail.value.user.gem_color = r.color;
    const target = rows.value.find(x => x.sec_uid === detail.value.user.sec_uid);
    if (target) target.gem_color = r.color;
    gemMsg.value = r.color == null ? '已恢复默认' : r.color === 'rainbow' ? '已设为彩虹流光' : '已保存';
    setTimeout(() => (gemMsg.value = null), 2500);
  } catch (e: any) { gemMsg.value = '设置失败：' + (e.message ?? e); }
  finally { gemBusy.value = false; }
}

// ── 一键清空用户库：红色弹窗 + 3 秒倒计时（防手滑）──
const wipeOpen = ref(false);
const wipeCount = ref(3);
const wipeBusy = ref(false);
const wipeErr = ref<string | null>(null);
const wipeFlash = ref<string | null>(null);
let wipeTimer = 0;
let flashTimer = 0;

function openWipe() {
  wipeOpen.value = true;
  wipeCount.value = 3;
  wipeErr.value = null;
  clearInterval(wipeTimer);
  wipeTimer = window.setInterval(() => {
    if (wipeCount.value > 0) wipeCount.value--;
    if (wipeCount.value <= 0) clearInterval(wipeTimer);
  }, 1000);
}
function closeWipe() {
  wipeOpen.value = false;
  clearInterval(wipeTimer);
}
async function doWipe() {
  if (wipeCount.value > 0 || wipeBusy.value) return;
  wipeBusy.value = true;
  wipeErr.value = null;
  try {
    const r = await post('/api/users/wipe', { confirm: 'CLEAR_USERS' });
    wipeOpen.value = false;
    detail.value = null;
    page.value = 0;
    await load();
    wipeFlash.value = `✓ 已清空 ${r.users} 位赞友 / ${r.rounds} 轮 / ${r.sessions} 场`;
    clearTimeout(flashTimer);
    flashTimer = window.setTimeout(() => (wipeFlash.value = null), 6000);
  } catch (e: any) {
    wipeErr.value = e.message ?? String(e);
  } finally { wipeBusy.value = false; }
}
onScopeDispose(() => { clearInterval(wipeTimer); clearTimeout(flashTimer); });
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
      <Transition name="banner"><span v-if="wipeFlash" class="text-[12px] text-emerald-300">{{ wipeFlash }}</span></Transition>
      <span class="text-[12px] text-white/45">共 {{ total }} 位赞友</span>
      <button class="btn btn-danger" @click="openWipe">🧹 清空用户库</button>
    </div>

    <!-- 与榜单第 4 名之后同款的条目列表（作者/星守为宝石行） -->
    <div class="flex flex-col gap-1.5">
      <div v-for="(u, i) in rows" :key="u.sec_uid" @click="open(u.sec_uid)"
        class="glass rounded-xl px-3 py-2 flex items-center gap-3 relative overflow-hidden cursor-pointer transition-colors hover:border-white/25"
        :class="{ 'gem-row': !!gemOf(u) }">
        <GemFacets v-if="gemOf(u)" :seed="u.sec_uid" :color="gemOf(u)!" />
        <div class="relative z-10 flex items-center gap-3 w-full min-w-0">
          <span class="num w-8 text-center text-[13px] font-black shrink-0 text-white/40">{{ page * PAGE + i + 1 }}</span>
          <AvatarBubble :secUid="u.sec_uid" :nick="u.nick" :size="34" :avatar="u.avatar" />
          <div class="min-w-0 flex-1">
            <div class="flex items-center gap-1.5">
              <span class="truncate text-[13.5px] font-semibold text-white/90 max-w-[46%]"
                :class="{ 'author-rainbow': isAuthor(u.sec_uid) }"
                :title="isAuthor(u.sec_uid) ? '作者彩蛋 · Sr_青尘' : undefined">{{ u.nick }}</span>
              <span v-if="u.badge" class="px-1.5 rounded-full text-[10px] font-bold shrink-0 bg-white/10 text-white/70 border border-white/10">{{ u.badge }}</span>
              <span v-if="u.star_guard" class="shrink-0 text-[10px] font-bold text-cyan-300/85" title="星守护 · 榜单第 4 名及之后显示宝石行">✦星守</span>
            </div>
            <div class="text-[11px] text-white/45 truncate">
              🥇 {{ u.champion }} · 🥈 {{ u.runner }} · 🥉 {{ u.third }}
              · 出场 {{ u.sessions_seen }} 场 · 最近 {{ fmtClock(u.last_seen) }}
            </div>
          </div>
          <div class="text-right shrink-0">
            <div class="num-go text-[17px] font-extrabold text-white">{{ fmtNum(u.total_likes) }}</div>
            <div class="text-[10px] text-sky-300/80">{{ u.best_speed ? '⚡ ' + fmtNum(u.best_speed) + '/分' : '—' }}</div>
          </div>
        </div>
      </div>
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
            <AvatarBubble :secUid="detail.user.sec_uid" :nick="detail.user.nick" :size="56" ring="avatar-ring-1" :avatar="detail.user.avatar" />
            <div class="min-w-0">
              <div class="font-bold text-[16px] truncate" :class="{ 'author-rainbow': isAuthor(detail.user.sec_uid) }">{{ detail.user.nick }}
                <span v-if="detail.user.star_guard" class="ml-1 align-middle text-[10px] font-bold text-cyan-300/90" title="星守护：第 4 名及之后显示宝石行">✦星守</span>
              </div>
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
          <!-- 宝石行配色：作者默认彩虹流光；星守默认每场随机一色，手动指定后固定 -->
          <section v-if="detail.user.star_guard || isAuthor(detail.user.sec_uid)" class="mb-4">
            <div class="flex items-center justify-between mb-2">
              <h3 class="font-bold text-[13px] text-white/70">💎 宝石行配色
                <span v-if="detail.user.star_guard" class="ml-1 text-[10px] font-bold text-cyan-300/90">✦星守</span>
              </h3>
              <span class="text-[11px] text-white/40">
                {{ detail.user.gem_color === 'rainbow' ? '彩虹流光'
                  : detail.user.gem_color ? detail.user.gem_color
                  : (isAuthor(detail.user.sec_uid) ? '默认：彩虹流光' : '默认：每场随机') }}
              </span>
            </div>
            <div class="flex flex-wrap items-center gap-2">
              <button v-for="c in GEM_COLORS" :key="c" :disabled="gemBusy" @click="setGem(c)"
                class="w-7 h-7 rounded-full border-2 transition-transform hover:scale-110 disabled:opacity-50"
                :class="detail.user.gem_color === c ? 'border-white' : 'border-white/20'"
                :style="{ background: c }" :title="`使用 ${c}`" />
              <button class="btn" style="padding: 4px 10px; font-size: 11px" :disabled="gemBusy"
                :class="detail.user.gem_color === 'rainbow' ? 'ring-1 ring-amber-300' : ''"
                @click="setGem('rainbow')">🌈 彩虹流光</button>
              <button class="btn" style="padding: 4px 10px; font-size: 11px" :disabled="gemBusy" @click="setGem(null)">跟随默认</button>
            </div>
            <div v-if="gemMsg" class="text-[11.5px] text-emerald-300 mt-1.5">{{ gemMsg }}</div>
            <p class="text-[11px] text-white/35 mt-1.5">仅第 4 名及之后的星守/作者行生效，其余保持普通玻璃条。</p>
          </section>
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

    <!-- 清空用户库：红色弹窗 + 3 秒倒计时二次确认 -->
    <Teleport to="body">
      <div v-if="wipeOpen" class="fixed inset-0 z-[60] flex items-center justify-center p-4">
        <div class="absolute inset-0 bg-black/80" @click="closeWipe" />
        <div class="relative rounded-2xl w-[460px] max-w-full p-6"
          style="background: linear-gradient(160deg, rgba(26, 13, 20, 0.985), rgba(12, 8, 14, 0.99)); border: 1px solid rgba(244, 63, 94, 0.45); box-shadow: 0 20px 70px rgba(244, 63, 94, 0.18); backdrop-filter: blur(12px)">
          <div class="flex items-center gap-2 text-[18px] font-black text-rose-300">⚠️ 清空用户库</div>
          <p class="text-[12.5px] text-white/65 leading-6 mt-3">
            将删除：<b class="text-white/85">全部用户档案、昵称历史、场次/轮次/排名明细、全局纪录、头像缓存</b>。<br />
            保留：设置、登录态、程序文件。此操作<b class="text-rose-300">不可撤销</b>。
          </p>
          <p class="text-[11.5px] text-amber-200/85 mt-2 leading-5">
            建议先导出备份；若正在直播，清空后会从 0 开始重新积累，不会中断捕获。
          </p>
          <div class="flex items-center gap-2 mt-4">
            <a href="/api/export" class="btn" download>⬇ 先导出备份</a>
            <div class="flex-1" />
            <span v-if="wipeCount > 0" class="text-[12px] text-white/45">请等待 {{ wipeCount }} 秒…</span>
          </div>
          <div v-if="wipeErr" class="mt-3 text-[12px] text-rose-300">{{ wipeErr }}</div>
          <div class="mt-5 flex justify-end gap-2">
            <button class="btn" @click="closeWipe">取消</button>
            <button class="btn btn-danger" :disabled="wipeCount > 0 || wipeBusy" @click="doWipe">
              {{ wipeBusy ? '清空中…' : wipeCount > 0 ? `确认清空（${wipeCount}s）` : '确认清空（不可撤销）' }}
            </button>
          </div>
        </div>
      </div>
    </Teleport>
  </div>
</template>
