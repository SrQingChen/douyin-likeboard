# 项目状态 · 多功能点赞统计助手

> 最后更新：2026-11-11 ｜ 版本：v0.2.0 ｜ 分支：main
> 新窗口开工先读本文件 + `docs/开发交接.md`，不要重新调研。

---

## 一、一句话状态

**本地旁听版已可稳定运行，官方平台入驻/互动插件已彻底放弃。** 项目已清理为纯产品仓库：礼物/付费效果全部移除，原鎏金动效改为免费「高能冲刺」；开放平台、软著、飞书资料已打包到项目外并从仓库删除。

- 对外名称：**多功能点赞统计助手**
- 形态：Windows 本地工具（core + capture + Vue 控制台/榜单 + Electron 透明/绿幕窗口）
- 变现：无；不接平台接口、不做礼物、不做付费效果
- 当前工作区：**有未提交改动**（本轮改造 + 清理），尚未 commit/push

---

## 二、本轮已完成（2026-11-11）

### 功能
- 删除全部礼物事件/礼物动效/甜甜圈文案；`GiftParticles.vue` → `SurgeParticles.vue`
- 新增「高能冲刺」：最近 10 秒点赞数 ×6 ≥ 阈值（默认 300 赞/分，可调 50~3000）
  - 冲榜用户整行/昵称鎏金扫光 + ⚡
  - 前三头像金色光环 + canvas 粒子
  - 快照 `surge/surgeThreshold`，持续达标续期，新轮结算清除
- 评论「加入」播报保留
- 品牌统一为「多功能点赞统计助手」；数据库 `likeboard.db` → `likes-stats.db`（自动迁移）

### 稳定性修复（本轮重点）
1. **控制台操作 400**
   - 原因：无 body 的 POST 带了 `content-type: application/json`，Fastify 报空 JSON body
   - 修复：`ui/src/console/api.ts` 仅有 body 时声明 JSON
2. **捕获浏览器无限重启（用户感知“反复被踢出直播”）**
   - 原因：旧 `ctx.on('close')` 又触发新一轮 relaunch（自循环）；`watchRoom` 与启动流程并发 launch 互相清理；profile 残留 Chrome
   - 修复：ctx 引用比较 + `ensureBrowser()` 单飞 + `relaunching` 守卫/单例定时器 + 启动前按 profile 清理 + `CaptureCtl.stop()` 进程树结束
3. **`autostartCapture=false` 时手动进房不生效**
   - 修复：`getResumeUrl` 始终返回 `lastRoomUrl`；`onStartCapture` 改 `ensureCapture()`
4. **安静房间一直显示“启动中”**
   - 修复：进房即上报 `watching`
5. **捕获日志不落 core.log**
   - 修复：`Hub.log()` 统一 `console.log`
6. **新轮结算残留冲刺**
   - 修复：结算清空 `engine.surge`；前端轮次切换清除旧态

### 验证
- `server npm run typecheck` ✅
- `ui npm run build` ✅
- `replay-test.mjs` **24/24** ✅
- `dom-check.mjs` **24/24** ✅
- 真实直播间（约 2 万在线）2 路采集连续 70 秒稳定，无浏览器重启，likes 正常累积
- 控制台全部操作 0 个 400 / 0 个 console error

### 同日追加改动
- **OBS 实测修正**：OBS「窗口采集」可直接捕获透明 Electron 窗口并保留 alpha（选「多功能点赞统计助手」）；绿幕窗口降级为个别采集端的兜底（README/设置页/交接文档同步）
- **榜单完整度常显**：此前只在 <99% 时显示徽章，长跑后覆盖率饱和到 100 就“消失”；现在始终显示 `完整度 N%`（<99% 琥珀色 + ⚠）
- **领奖台宽度比**：亚军:冠军:季军 = **0.9 : 1 : 0.8**（flexGrow，实测 438.7 : 487.4 : 389.9）
- **控制台速率趋势图自适应高度**：46px → 填满卡片剩余高度（约 206px @980 高）
- **控制台「展开完整排行」**：预览卡新增按钮，全屏可滚动表格最多 100 人；快照固定推送 `max(100, boardCount)` 行
- **作者彩蛋**：`Sr_青尘` 的稳定 f46 secUid 硬编码在 `ui/src/shared/format.ts` 与 `server/src/author.ts`（数字 uid 97905874098 仅备注）；榜单/领奖台/结算/冲刺/评论播报/用户库昵称显示五彩渐变循环；40px 短周期 8 色 + 提亮/暗色投影，宝石行上也清晰
- **星守护识别（实测）**：真实房间抓包确认，`User` 的粉丝团勋章（f24 → data → badge → icons）里星守护会出现 `star_guard_advanced_badge_N_xmp.png`；捕获层按 URL 标记解析，写入 `users.star_guard`。26 位真实用户回归 26/26（2 位星守护）
- **星守护/作者宝石行**：仅 **第 4 名及之后** 的星守护/作者行换成透明宝石质感（随机晶面 + 边缘色散 + 流动高光，保留 alpha）；作者默认彩虹流光，其他星守每场首次出现随机一色、本场稳定
- **前三名配套水晶效果**：冠/亚/季奖台换成水晶质感（金/银/铜晶面），若该位是作者/星守则用其宝石色（作者=彩虹）；作者昵称在领奖台同样显示彩色流动
- **用户库同款条目**：用户库由表格改为与榜单 4+ 同款的横条列表，作者/星守护自动显示宝石行（手动色 > 当前榜单实时色 > 作者彩虹 > 星守稳定取色）
- **宝石渲染升级**：不规则晶面（大小混合/四边形+三角）+ **共享高度场 → 逐面 3D 法线 → 平面着色**（相邻晶面在晶界两侧向各自方向倾斜，明暗由法线与左上光源夹角决定，不再统一从左上到右下）+ 仅朝光边保留一条两端渐隐的倒角高光 + 极轻微画布模糊 + 青品红色散/高光点，保留透明通道；作者彩虹改为 **左上→右下慢速色波**（16s 周期、0.30 对角滞后、完整 360° 闭环 + 正弦速度扰动，无色相跳变；高饱和中亮避开棕灰），只有作者画布按 30fps 重绘，其余宝石静态绘制
- **手动宝石配色**：用户库详情抽屉新增色板 + 彩虹流光 + 跟随默认；`PATCH /api/user/:secUid/gem`，持久化到 `users.gem_color`（`null`/`rainbow`/`#RRGGBB`）
- **关闭系统彻底化**：`/api/shutdown` 先回 200 再退出；关闭时同步结束捕获进程树 + 清理本 profile 的 Chrome + 关闭项目 Electron 榜单窗口（透明/绿幕），控制台显示「系统已关闭」页
- **身份主键修正（重要）**：实测 `User.f73` 是带轮换密钥的 1.0.3 令牌（同一 uid 42s 内 158 个不同值），不是稳定 secUid；已改为 **f46（1.0.0 / MS4wLjABAAAA...，账号级稳定）优先、f73 仅打码兜底**，**所有用户**都走 f46。这修复了同一账号跨场被拆成多个用户的问题，也是作者 ID “变化”的真正原因
- **作者稳定绑定**：从真实 MemberMessage 抓到作者 `Sr_青尘` 的稳定 **f46 = `MS4wLjABAAAAhs9HSVhGCISlyr4RzfOhVsF24VwtOg_SfIx3xGlFVm8`**（数字 uid 97905874098）；旧 f73 列表、头像兜底、昵称启发式全部删除，只认这个 f46，换头像/改名/换场都不会失效
- **窗口列表条数**：设置页「窗口列表条数（不含前三）」默认 **10**，范围 3~100，走 `boardCount` 配置，保存后 1 秒内热生效；chroma 窗口不再硬编码 `max=8`；不做自动压缩（窗口不够高时由采集端拉高/缩放）
- **设置持久化 / 并发数 / 去重**：`data/config.json` 保存全部设置，危险区「清空全部数据」改为**保留 config**；新增 `captureTabs`（1~4，默认 2）设置，保存后自动重启捕获生效；去重实测双标签 msgId 11/11 一致，并补了缺失/`0` msgId 的 `(secUid,total)` 兜底键（`dedupe-test.mjs` 8/8）
- **启动首屏加速**：捕获层解析进房 ~4.7s 就到的 `WebcastRoomUserSeqMessage`（f3/f9 在线人数）和 `WebcastRoomStatsMessage`（f5）；页面头部「N本场点赞」直接作为房间累计赞首帧，不再等点赞/进场消息。控制台/榜单改用 1s WS 快照，未就绪显示 `—` 而非 0
- **测试数据**：本轮验证产生的模拟场次/用户已通过「清空用户库」清空（内测阶段不保留数据）

---

## 三、项目清理 / 归档

平台与软著资料已打包到项目外：

**`E:\多功能点赞统计助手-平台与软著资料-2026-11-11.7z`**

- 8.5 MB，7z `-mx=9`，34 个文件，完整性校验通过
- 含：`软著申请/` 全部材料、开放平台调研/操作指南、飞书脚本、软著生成脚本、旧 `交接文档.md`
- 已从仓库删除上述文件；`.gitignore` 增加 `软著申请/`
- 项目内保留纯技术交接：`docs/开发交接.md`

---

## 四、启动 / 构建 / 测试

```bash
# core（开发）
cd server && npm run dev

# 前端构建（core 托管 ui/dist）
cd ui && npm run build

# 类型检查
cd server && npm run typecheck

# 回放测试（24 断言）
cd server && node --import tsx scripts/replay-test.mjs

# DOM 验收（需 core + 数据源）
cd server && node --import tsx scripts/dom-check.mjs

# 用户库清空回归
cd server && node scripts/wipe-test.mjs

# 无浏览器模拟数据源
cd server && node scripts/sim-capture.mjs --rate 30 --users 18 --calm

# 单发高能冲刺（默认 60 赞 ≈ 360/分）
cd server && node scripts/sim-event.mjs --surge --top --count 60
```

- core 端口：`127.0.0.1:17730`
- 启动器：`一键启动.bat`；榜单窗口：`打开榜单窗口.bat` / `打开榜单窗口-OBS兼容.bat`
- 便携包：`cd server && node scripts/package-release.mjs`
  → `release/LikesStatsAssistant-<版本>-win64-portable.zip`

---

## 五、数据与登录态

| 项 | 位置/说明 |
|---|---|
| 数据库 | `data/likes-stats.db`（首次启动自动从旧名 `likeboard.db` 迁移） |
| 登录态 | `data/chrome-profile/`（捕获 Chrome 持久化 profile；已登录） |
| 配置 | `data/config.json`（`autostartCapture` 当前为 true） |
| 头像 | `data/avatars/` |
| 日志 | `data/core.log`（capture 子进程日志现在也会落盘） |
| 密钥/飞书 | `.secrets/` 已 gitignore，不属于产品运行必需 |

> 如果直播间要求登录/频繁跳转：直接在捕获 Chrome 窗口登录抖音账号即可，登录态保存在本机 profile；不要向任何人索要 cookie。

---

## 六、已知问题 / 边界

1. **完整度是抽样下发**：大房间单连接约 19~22%，2 路略高；`CAPTURE_TABS=1~4` 可调。不要承诺 100%。
2. **登录态会过期**：过期后日志显示 `登录态：匿名`，可能被重定向到 passport/首页；在捕获窗口重新登录即可。
3. **OBS/直播伴侣透明窗口**：
   - 首选 OBS 浏览器源 `/board?transparent=1`（真 alpha）
   - **实测 OBS「窗口采集」可直接捕获透明 Electron 窗口并保留透明通道**（2026-11-11 实测），窗口名选「多功能点赞统计助手」
   - 直播伴侣：高级功能「绿幕抠图」实际消费窗口透明通道，常规透明窗口即可（不需要绿背景）；相似度调到最低避免误伤正常区域；绿幕窗口仅作不识别 alpha 的采集端兜底
   - 个别采集端版本窗口列表不显示/丢 alpha 时，用绿幕窗口 + Chroma Key 兜底
   - 不要给真实 Electron 看板窗口注入 `WS_EX_LAYERED` 色键：已实测会色键不生效/渲染异常，需要独立原生 helper
4. **版本 0.2.0**；本地目录名和 GitHub 仓库名仍是 `douyin-likeboard`/`抖音点赞排行榜小助手`，未改远程。
5. **工作区未提交**：本轮改动较多，推 GitHub 前先 review `git diff`。

---

## 七、建议的下一步

1. 长跑验证：真实直播间挂 30~60 分钟，观察 `data/core.log` 是否还有重启/跳转。
2. 可选：把“登录态（已登录/匿名）”显示到控制台，而不是只写日志。
3. 可选：评估 `CAPTURE_TABS` 默认值（稳定性 vs 完整度），或做自适应降级。
4. 发布：确认版本号后跑 `package-release.mjs`，打 `LikesStatsAssistant-...zip`。
5. 如果以后要改仓库名/远程地址，再统一更新 README/徽章/package-release 的 repository。

---

## 八、新窗口开场提示（可直接复制）

```
读 E:\抖音点赞排行榜小助手\PROJECT_STATUS.md 和 docs/开发交接.md。
这是本地旁听版「多功能点赞统计助手」，已放弃官方平台入驻，不要引入礼物/付费/平台接口。
先跑 server typecheck + ui build，确认工作区可构建；再看 git diff 了解本轮未提交改动。
```
