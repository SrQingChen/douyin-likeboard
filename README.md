<div align="center">

# 多功能点赞统计助手

_👑 实时点赞统计 · 冠亚季军榜单 · 高能冲刺特效 · 纯被动旁听_

<a href="https://github.com/SrQingChen/douyin-likeboard/releases/latest"><img src="https://img.shields.io/github/v/release/SrQingChen/douyin-likeboard?style=flat-square&color=7c3aed&label=release" alt="Release"></a>
<a href="https://github.com/SrQingChen/douyin-likeboard/blob/main/LICENSE"><img src="https://img.shields.io/github/license/SrQingChen/douyin-likeboard?style=flat-square&color=3fb950&label=license" alt="GPL-3.0"></a>
<a href="https://github.com/SrQingChen/douyin-likeboard/actions/workflows/ci.yml"><img src="https://img.shields.io/github/actions/workflow/status/SrQingChen/douyin-likeboard/ci.yml?style=flat-square&color=f97316&label=CI" alt="CI"></a>
<a href="https://github.com/SrQingChen/douyin-likeboard/releases"><img src="https://img.shields.io/github/downloads/SrQingChen/douyin-likeboard/total?style=flat-square&color=34d399&label=downloads" alt="Downloads"></a>
<a href="https://github.com/SrQingChen/douyin-likeboard/commits/main"><img src="https://img.shields.io/github/last-commit/SrQingChen/douyin-likeboard/main?style=flat-square&color=22d3ee&label=last%20commit" alt="Last commit"></a>
<br>
<img src="https://img.shields.io/badge/platform-Windows%2010%20%2F%2011-0078D6?style=flat-square&logo=windows11&logoColor=white" alt="Platform">
<img src="https://img.shields.io/badge/Node-24-339933?style=flat-square&logo=nodedotjs&logoColor=white" alt="Node 24">
<img src="https://img.shields.io/badge/Vue-3.5-42B883?style=flat-square&logo=vuedotjs&logoColor=white" alt="Vue 3.5">
<img src="https://img.shields.io/badge/Tailwind-4-06B6D4?style=flat-square&logo=tailwindcss&logoColor=white" alt="Tailwind 4">
<img src="https://img.shields.io/badge/Electron-透明窗口-47848F?style=flat-square&logo=electron&logoColor=white" alt="Electron">
<img src="https://img.shields.io/badge/SQLite-WAL-003B57?style=flat-square&logo=sqlite&logoColor=white" alt="SQLite">

*Multi-purpose Douyin live like statistics assistant — passive sniffing, podium & records, surge effects, transparent desktop window.*

</div>

<br>

**多功能点赞统计助手**旁听抖音直播间的点赞推送流，把**每一位观众**的点赞数实时排成一张统计榜：冠亚季军领奖台、N冠王徽章、纪录轮换框、里程碑播报 —— 全部实时呈现。以不变的账号 secUid 聚合，昵称换了照样认得；全量数据落 SQLite，历史可回溯可导出。

> 全部功能免费，**无任何付费效果**：高能冲刺的鎏金流光只由「近 10 秒点赞速度」触发，不改变任何排名数值。

> 不发送任何点赞 / 弹幕 / 请求，不登录也能用 —— 风险等级 ≈ 开一个浏览器页面看直播。*Passive-only: we listen, we never send.*

---

## ✨ 亮点

| | 能力 | 说明 |
|:--:|---|---|
| 🎯 | **准确计数** | 逐条累加协议 count 字段，msgId **int64 无损去重**（BigInt 解析）；连点器高速连击照常统计 |
| 🛡️ | **诚实完整度** | 与房间总数比对得出 coverage%，缺口如实展示**不虚补**；断连自动恢复 |
| ⚡ | **高能冲刺** | 最近 10 秒点赞速度 ≥ 阈值（默认 300 赞/分）→ 冲榜用户鎏金流光 + 前三金色光环与粒子；纯免费视觉反馈，可调阈值 |
| 💎 | **星守护宝石行** | 从粉丝团勋章识别星守护（`star_guard_*`）；**第 4 名及之后**的作者/星守护行换成透明宝石质感（随机晶面 + 折射色散 + 流动高光）；作者默认彩虹流光，星守每场随机一色、可在用户库手动指定 |
| 🏆 | **领奖台 & 徽章** | 冠亚季军实时单独展示（皇冠浮动 + 奖台高度动画 + 数字滚动）；头像上方冠名：N冠王 / 累计点赞王 / 亚军×N / 季军×N / 老友·N场 |
| 🔄 | **纪录轮换框** | 登顶之王 · 本场之最 · 手速之王 · 单轮纪录 · 连霸 · 亚军专业户 · 季军常客 · 累计之最 · 舰队规模 · 实时速率 · 决战倒计时，里程碑自动插播 |
| ⚖️ | **限额可视化** | 单人滚动 1h 赞数 ≥2800 且停滞 → "⚖️已封顶" 推断标记（3000/时限额机制，见 [docs/点赞限额机制.md](docs/点赞限额机制.md)） |
| 🪟 | **桌面透明窗口** | Electron 无边框 + **背景透明通道** + 可拖动 + 鼠标穿透（Ctrl+Alt+B 解锁）；OBS 采集另有浏览器源透明版；窗口捕获可用 OBS 兼容绿幕窗口 |
| 💾 | **全量持久化** | SQLite(WAL)：用户档案 / 昵称变更全历史 / 场次轮次 / 全局纪录；30s 轮内 checkpoint，崩溃最多丢 30s，重启不发虚奖 |
| 🧊 | **防呆设计** | 单实例锁、浏览器自动兜底（无 Chrome 用内置 Chromium）、重复启动语义化提示、危险操作二次确认、捕获崩溃自动复活 |
| 🌙 | **长跑自愈（v0.1.1）** | WS 静默看门狗（刷新→重建递进自愈，覆盖断网/睡眠唤醒）· **core↔capture 互为守护**（任一方崩溃另一方自动拉起，限流防抖）· 日志自动轮转 · 异常兜底不致崩 · 残留 Chrome 防呆清理 · 开机自启开关 |
| 📦 | **零部署便携包** | 内置 Node 运行时 + 内置 Chromium + Electron —— **空白机解压即用**，首次启动带 5 步部署进度窗 |

---

## 🏗️ 架构

```
┌────────────── 捕获进程（patchright 有头 Chrome / 内置 Chromium）──────────────┐
│  live.douyin.com → WS 推送流（被动收帧，从不发送）                              │
│  PushFrame(f8 gzip) → Response → LikeMessage / Member / Chat                  │
│  200ms 批量上报 + 用户档案分离（token 鉴权 /agent）                             │
└──────────────────────────┬───────────────────────────────────────────────┘
┌──────────────────────────┴───────────────────────────────────────────────┐
│                 核心服务 core（Fastify 5 · 127.0.0.1:17730）               │
│  聚合引擎：60s/1h 时间戳环形桶滑窗 · msgId LRU 去重 · coverage 校准         │
│  轮次结算：competition ranking 并列 · 冠亚季军 · 纪录 · 徽章               │
│  持久层：SQLite WAL（users/nicknames/sessions/rounds/round_users/kv）      │
│  守护：捕获崩溃自动重启（10min/5 次限流）· 单实例锁                         │
└────────┬─────────────────────────────────────────────┬───────────────────┘
┌────────▼────────────────┐                ┌───────────▼───────────────────┐
│  控制台 /（Vue 3.5）     │                │  榜单 /board（Vue 3.5）        │
│  概览 · 用户库 · 轮次 ·  │                │  领奖台 · 轮换框 · FLIP 列表   │
│  设置 · 危险区           │                │  浏览器 / OBS / Electron 均可  │
└─────────────────────────┘                └───────────────────────────────┘
```

**为什么计数准**：服务端下发的每条 `WebcastLikeMessage` 携带 `count`（本次点赞数）与 `total`（房间累计）——count 直接累加即真实增量，连点器一次 10 连也只是 count=10 的一条消息，语义天然覆盖；`secUid`（用户唯一不变标识）做聚合主键，昵称打码/改名都不影响归属。字段级实测记录见 [docs/调研报告-抖音红包项目.md](docs/调研报告-抖音红包项目.md)。

---

## 🚀 快速开始

### 方式一：下载便携版（推荐，空白机可用）

到 [**Releases**](https://github.com/SrQingChen/douyin-likeboard/releases/latest) 下载最新便携包，解压到任意目录（路径可含中文），**双击 `一键启动.bat`**：

> 新版打包：`cd server && node scripts/package-release.mjs` → `release/LikesStatsAssistant-<版本>-win64-portable.zip`（旧版数据会在首次启动时自动迁移到 `likes-stats.db`）。

1. 弹出**部署进度窗**：运行环境 → 浏览器检测 → 数据初始化 → 核心启动 → 打开控制台（五步全绿，约 5~10 秒）
2. 控制台自动在浏览器打开 → 输入**房间号或直播间链接** → 进入房间
3. 双击 **`打开榜单窗口.bat`** = 独立桌面透明窗口；OBS 用浏览器源填 `http://127.0.0.1:17730/board?transparent=1`；OBS/直播伴侣窗口捕获用 **`打开榜单窗口-OBS兼容.bat`**（纯绿背景 + Chroma Key）
4. 结束：控制台右上角「⏻ 关闭系统」（确认后自动结算当前轮，并关闭捕获浏览器与独立榜单窗口，控制台显示已关闭页）

> 💡 便携包内置 Node 运行时与 Chromium：**无需安装任何东西**。若本机有 Chrome 会优先使用（数据完整度更好）。
> 💡 想提高完整度：在捕获 Chrome 小窗里登录一个抖音小号（实测匿名约 3~5 成 → 登录后约 8 成，详见 [docs/数据完整度与抽样.md](docs/数据完整度与抽样.md)）。

### 方式二：从源码运行

```bash
git clone https://github.com/SrQingChen/douyin-likeboard.git
cd douyin-likeboard

# 后端（Node ≥ 22）
cd server && npm install
npm run typecheck                        # 类型检查
node --import tsx scripts/replay-test.mjs   # 真实录制帧回放测试（24 断言）
node --import tsx src/index.ts           # 启动 core :17730

# 前端
cd ../ui && npm install && npm run build # 产物 ui/dist，由 core 直接托管

# 桌面透明窗口（可选）
cd ../desktop && npm install             # 需要 electron 二进制（走镜像见 .npmrc）

# 无浏览器开发模式：合成点赞数据源
cd ../server && node --import tsx scripts/sim-capture.mjs --rate 40
# 演示高能冲刺：压低重度用户后，用单发事件注入 60 赞（折合 360/分）
node --import tsx scripts/sim-capture.mjs --rate 30 --calm --surge-at 8
node --import tsx scripts/sim-event.mjs --surge --top --count 60
```

---

## 🧪 测试与验证

| 命令（server/ 下） | 内容 |
|---|---|
| `node --import tsx scripts/replay-test.mjs` | 真实录制帧回放：int64 无损 / Σcount=5551 分毫不差 / 去重 / 并列结算 / 徽章 / 崩溃恢复，24 断言 |
| `node --import tsx scripts/perf-test.mjs` | 1000 msg/s 压测：零丢失、快照 <10ms、3000 用户结算 30ms |
| `node --import tsx scripts/soak-test.mjs` | **长跑压测**：默认 1h@300msg/s+观众陆续进场+周期结算，断言零丢失与内存无单调泄漏 |
| `node --import tsx scripts/dom-check.mjs` | 控制台+榜单 DOM 验收 24 项（需 core 运行中） |
| `node --import tsx scripts/sim-capture.mjs` | 合成点赞流（连点器形态），驱动 UI/演示；`--calm` 演示节奏、`--surge-at 8` 定点注入冲刺 |
| `node --import tsx scripts/sim-event.mjs --surge` | 单发高能冲刺（默认 60 赞 ≈ 360/分），用于验证鎏金/光环/粒子 |

---

## 📖 数据与风控说明

- **纯被动**：只收不发——不向 WS 发帧、不调业务接口、不要求登录；匿名即可统计（点赞/弹幕流匿名可收，实测）。
- **抽样机制**：抖音对点赞广播是抽样下发（同 profile 多标签提升有限），工具如实展示完整度、不虚补；相对排序与冠亚季军判定不受影响。详见 [docs/数据完整度与抽样.md](docs/数据完整度与抽样.md)。
- **点赞限额（3000/时）**：无官方文档，按社区与一手观察整理成机制文档，计数口径不受影响。详见 [docs/点赞限额机制.md](docs/点赞限额机制.md)。
- **数据在哪**：`data/likes-stats.db`（SQLite）；设置页可一键导出全量 JSON，也可在「危险区」双确认清空（保留登录态）。

---

## ❓ FAQ

<details>
<summary><b>捕获 Chrome 小窗能关吗？</b></summary>
它是数据来源，请保持打开；被误关 8 秒内自动重开。最小化即可，不用置顶。
</details>

<details>
<summary><b>榜单窗口 OBS/直播伴侣捕获不到，或捕获有黑底？</b></summary>
实测 OBS「窗口采集」可直接捕获透明 Electron 窗口并保留 alpha（窗口名选「多功能点赞统计助手」）。若个别采集端版本列表里看不到或丢失透明通道，按下面兜底：<br />
1. <b>OBS 浏览器源</b>：URL 填 <code>/board?transparent=1</code>（真透明，推荐）；<br />
2. <b>绿幕窗口</b>：控制台「设置 → OBS 兼容窗口（绿幕）」或双击 <code>打开榜单窗口-OBS兼容.bat</code>，在窗口捕获里选「多功能点赞统计助手（OBS兼容）」，加 Chroma Key 滤镜抠掉绿色；<br />
3. <b>直播伴侣</b>：高级功能里的「绿幕抠图」实际消费窗口透明通道，<b>不需要绿色背景</b>；直接用常规透明窗口即可，相似度调到最低避免误伤正常区域。绿幕窗口仅作个别采集端不识别 alpha 的兜底；另一条路是 OBS 浏览器源 → OBS 虚拟摄像头 → 直播伴侣摄像头源。
</details>

<details>
<summary><b>为什么我的完整度只有 40%？</b></summary>
抽样下发是正常现象。登录一个小号可提升至约 8 成；绝对数值偏低但排序/冠军判定不受影响。
</details>

<details>
<summary><b>昵称显示"好***"是 bug 吗？</b></summary>
不是——部分用户的昵称在服务端就已打码。聚合用不变的 secUid，展示会优先取该用户历史里未打码的昵称，兜底"赞友+尾号"。同一打码名可能对应多人（实测），不影响统计归属。
</details>

<details>
<summary><b>数据会无限膨胀吗？</b></summary>
不会。只存聚合与结算结果，不存原始事件流；头像本地去重缓存。8h/天 × 30 天 ≈ 数 MB 级。
</details>

---

## 📄 协议与作者

本项目以 **[GPL-3.0](LICENSE)** 开源 · 作者 **SrQingChen**

- 技术路线参考并致谢：[jwwsjlm/douyinLive](https://github.com/jwwsjlm/douyinLive) 等社区 proto 研究与本人早期项目「抖音红包」的实测数据
- 协议字段为**实测取证**（非官方），抖音更新可能影响功能；本项目仅用于学习交流，请勿用于任何违反平台规则或法律的用途
- 如果对你有帮助，欢迎点个 ⭐
