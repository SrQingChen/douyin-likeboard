<script setup lang="ts">
// 设置：热更新配置 / 榜单窗口指南 / 数据导出 / 使用说明
import { ref, onMounted } from 'vue';
import { api, patch, post } from './api';
import { fmtNum } from '../shared/format';

const cfg = ref<any>(null);
const saved = ref(false);
const stats = ref<any>(null);
const wipeArmed = ref(false);
const wipeText = ref('');
const wiping = ref(false);
const autostart = ref(false);
const autostartBusy = ref(false);

onMounted(async () => { try { autostart.value = (await api('/api/autostart')).enabled; } catch {} });
async function toggleAutostart() {
  autostartBusy.value = true;
  try {
    const r = await post('/api/autostart', { enable: !autostart.value });
    autostart.value = r.enabled;
  } catch (e: any) { alert('设置失败：' + e.message); }
  autostartBusy.value = false;
}

function wipeStep1() { wipeArmed.value = true; wipeText.value = ''; }
async function wipe() {
  if (wipeText.value !== 'DELETE') return;
  wiping.value = true;
  try {
    await post('/api/data/wipe', { confirm: 'DELETE' });
    document.title = '数据已清空 · 点赞排行榜小助手';
  } catch (e: any) { alert('清空失败：' + e.message); wiping.value = false; }
}

onMounted(async () => {
  cfg.value = await api('/api/config');
  stats.value = (await api('/api/status')).stats;
});

async function save() {
  cfg.value = await patch('/api/config', {
    roundMinutes: Number(cfg.value.roundMinutes),
    rankBasis: cfg.value.rankBasis,
    boardCount: Number(cfg.value.boardCount),
    cappedThreshold: Number(cfg.value.cappedThreshold),
    autostartCapture: !!cfg.value.autostartCapture,
  });
  saved.value = true; setTimeout(() => (saved.value = false), 2500);
}

const boardMsg = ref<string | null>(null);
async function openBoard(mode: string) {
  const u = { obs: '/board?transparent=1&layout=vertical', vertical: '/board?layout=vertical', normal: '/board' }[mode] ?? '/board';
  if (mode === 'normal') {
    // 独立窗口：优先 Electron 透明桌面窗口
    try {
      const r = await post('/api/board-window');
      boardMsg.value = '✓ 桌面透明窗口已打开（可拖动、置顶、鼠标穿透）';
    } catch (e: any) {
      window.open(u, '_blank', 'width=560,height=960');
      boardMsg.value = '桌面窗口未安装，已用浏览器窗口代替';
    }
    setTimeout(() => (boardMsg.value = null), 5000);
  } else {
    window.open(u, '_blank', 'width=560,height=960');
  }
}
</script>

<template>
  <div class="max-w-[860px] mx-auto grid grid-cols-1 lg:grid-cols-2 gap-4">
    <section class="glass rounded-2xl p-5">
      <h2 class="font-bold text-[14px] mb-4">⚙️ 排行与结算</h2>
      <div class="flex flex-col gap-4 text-[13px]" v-if="cfg">
        <label class="flex items-center justify-between gap-4">
          <span>轮次时长（自动结算）<span class="text-white/40 block text-[11px]">结算时记录冠亚季军与纪录</span></span>
          <select v-model="cfg.roundMinutes" style="width: 130px">
            <option :value="10">10 分钟</option><option :value="15">15 分钟</option>
            <option :value="30">30 分钟（推荐）</option><option :value="60">60 分钟</option>
            <option :value="0">不自动（仅手动）</option>
          </select>
        </label>
        <label class="flex items-center justify-between gap-4">
          <span>榜单排序依据</span>
          <select v-model="cfg.rankBasis" style="width: 130px">
            <option value="round">本轮（竞技感）</option><option value="session">本场累计</option>
          </select>
        </label>
        <label class="flex items-center justify-between gap-4">
          <span>榜单显示条数</span>
          <input v-model.number="cfg.boardCount" type="number" min="10" max="100" style="width: 130px" />
        </label>
        <label class="flex items-center justify-between gap-4">
          <span>限额推断阈值（赞/时）<span class="text-white/40 block text-[11px]">滚动 1h 达到该值后停滞 → 显示"⚖️封顶"（推断性标注）</span></span>
          <input v-model.number="cfg.cappedThreshold" type="number" min="500" max="3000" step="20" style="width: 130px" />
        </label>
        <label class="flex items-center justify-between gap-4">
          <span>core 启动时自动拉起捕获窗口</span>
          <input v-model="cfg.autostartCapture" type="checkbox" class="w-4 h-4" style="width: auto" />
        </label>
        <label class="flex items-center justify-between gap-4">
          <span>开机自启<span class="text-white/40 block text-[11px]">写入当前用户注册表（HKCU Run，无需管理员），登录 Windows 后自动启动小助手</span></span>
          <button class="btn" :class="{ 'tab-active': autostart }" :disabled="autostartBusy" @click="toggleAutostart">
            {{ autostart ? '✓ 已开启（点此关闭）' : '已关闭（点此开启）' }}
          </button>
        </label>
        <div class="flex items-center gap-3">
          <button class="btn btn-primary" @click="save">保存（热生效）</button>
          <Transition name="banner"><span v-if="saved" class="text-emerald-300 text-[12.5px]">✓ 已保存</span></Transition>
        </div>
      </div>
    </section>

    <section class="glass rounded-2xl p-5">
      <h2 class="font-bold text-[14px] mb-3">🪟 榜单窗口</h2>
      <p class="text-[12.5px] text-white/55 leading-6 mb-3">
        榜单窗口三种用法：<br />
        1. <b class="text-white/80">桌面透明窗口（推荐）</b>：无边框 + 背景透明通道 + 置顶 + 可鼠标穿透的
        Windows 独立窗口（顶部细条可拖动，📌置顶 / 🖱穿透 / ✕关闭；穿透后按 Ctrl+Alt+B 解锁）；
        也可双击项目里的「打开榜单窗口.bat」；<br />
        2. <b class="text-white/80">OBS 采集</b>：来源 → 浏览器，URL 填
        <code class="px-1 rounded bg-white/10 text-amber-200">http://127.0.0.1:17730/board?transparent=1</code>（推荐 560×960）；<br />
        3. <b class="text-white/80">浏览器窗口</b>：普通页面，无透明通道。
      </p>
      <div class="flex gap-2 flex-wrap items-center">
        <button class="btn btn-primary" @click="openBoard('normal')">开桌面透明窗口</button>
        <button class="btn" @click="openBoard('vertical')">竖屏版</button>
        <button class="btn" @click="openBoard('obs')">OBS 透明版</button>
        <Transition name="banner"><span v-if="boardMsg" class="text-[12px] text-emerald-300">{{ boardMsg }}</span></Transition>
      </div>
      <div class="mt-5 pt-4 border-t border-white/10 text-[12.5px] text-white/55 leading-6">
        <b class="text-white/80">捕获窗口说明</b>：系统会打开一个 Chrome 小窗播放直播间（必须保持打开，
        被误关会自动重开）。它是数据来源，不会发送任何点赞或弹幕——纯被动旁听。<br />
        <b class="text-amber-200">提高完整度</b>：抖音对点赞广播是抽样下发（匿名约 3~5 成）。
        在捕获 Chrome 窗口内<b class="text-white/85">登录一个抖音小号</b>可提升到约 8 成
        （一次登录长期有效）。多标签采集（默认 2 路）已自动开启。
      </div>
    </section>

    <section class="glass rounded-2xl p-5">
      <h2 class="font-bold text-[14px] mb-3">💾 数据</h2>
      <div v-if="stats" class="grid grid-cols-2 gap-2 text-[12.5px] mb-3">
        <div class="flex justify-between"><span class="text-white/45">用户档案</span><span class="num">{{ fmtNum(stats.users) }} 人</span></div>
        <div class="flex justify-between"><span class="text-white/45">累计点赞</span><span class="num">{{ fmtNum(stats.totalLikes) }}</span></div>
        <div class="flex justify-between"><span class="text-white/45">结算轮次</span><span class="num">{{ stats.rounds }}</span></div>
        <div class="flex justify-between"><span class="text-white/45">场次</span><span class="num">{{ stats.sessions }}</span></div>
      </div>
      <a href="/api/export" class="btn inline-block" download>⬇ 导出全量 JSON</a>
      <p class="text-[11.5px] text-white/40 mt-3">数据存于 data/likeboard.db（SQLite）。只存聚合与结算结果，不存原始事件流，体量长期可控。</p>
    </section>

    <section class="glass rounded-2xl p-5">
      <h2 class="font-bold text-[14px] mb-3">📖 关于点赞限额（3000/时）</h2>
      <p class="text-[12.5px] text-white/55 leading-6">
        抖音无公开文档；社区与实测观察：<b class="text-white/80">自首次点赞起 1 小时窗口，名义约 3000 赞</b>，
        实际触发点有浮动（2999/2998 甚至 2880），触发后提示"休息一下"、点赞不再计数。
        本工具统计的是<b class="text-white/80">服务端计入的有效赞</b>（与直播间页面显示一致）——被限额吞掉的点击本就不计入，
        因此连点器场景下计数依然准确。详见项目 docs/点赞限额机制.md。
      </p>
    </section>

    <section class="glass rounded-2xl p-5" style="border-color: rgba(244, 63, 94, 0.3)">
      <h2 class="font-bold text-[14px] mb-3 text-rose-300">⚠️ 危险区</h2>
      <p class="text-[12.5px] text-white/55 leading-6 mb-3">
        清空全部数据：删除排行榜数据库、用户档案、昵称历史、头像缓存与全部纪录（<b class="text-white/80">登录态保留</b>，无需重新扫码）。
        清空后服务自动退出，需重新运行「一键启动.bat」。此操作<b class="text-rose-300">不可撤销</b>——建议先在上方导出备份。
      </p>
      <div class="flex gap-2 items-center flex-wrap">
        <button class="btn btn-danger" @click="wipeStep1">🗑 清空全部数据</button>
        <Transition name="banner">
          <span v-if="wipeArmed" class="text-[12px] text-amber-200">再次确认：请输入 DELETE</span>
        </Transition>
        <input v-if="wipeArmed" v-model="wipeText" placeholder="输入 DELETE" style="width: 120px" />
        <button v-if="wipeArmed" class="btn btn-danger" :disabled="wipeText !== 'DELETE' || wiping" @click="wipe">
          {{ wiping ? '清空中…' : '确认清空（不可撤销）' }}
        </button>
        <button v-if="wipeArmed" class="btn" @click="wipeArmed = false; wipeText = ''">取消</button>
      </div>
    </section>
  </div>
</template>
