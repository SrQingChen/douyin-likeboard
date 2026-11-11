import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export interface AppConfig {
  port: number;                 // core 监听端口（仅 127.0.0.1）
  roundMinutes: number;         // 轮次时长（分钟），0 = 不自动结算
  rankBasis: 'round' | 'session'; // 榜单排序依据
  boardCount: number;           // 榜单推送条数（top N）
  autostartCapture: boolean;    // core 启动时自动拉起捕获进程
  lastRoomUrl: string | null;   // 上次观看的房间（重启后自动恢复）
  cappedThreshold: number;      // 限额推断阈值（滚动 1h 赞数达到该值且停滞）
  checkpointSec: number;        // 轮内 checkpoint 间隔
  surgeThreshold: number;       // 高能冲刺阈值（10s 窗口折算 赞/分；达到即触发鎏金动效，免费）
  captureTabs: number;          // 捕获并发标签数（1~4）；越多覆盖率略高，资源占用更高
}

export const DEFAULT_CONFIG: AppConfig = {
  port: 17730,
  roundMinutes: 30,
  rankBasis: 'round',
  boardCount: 10,
  autostartCapture: true,
  lastRoomUrl: null,
  cappedThreshold: 2800,
  checkpointSec: 30,
  surgeThreshold: 300,
  captureTabs: 2,
};

/** 从 import.meta.url 稳健定位项目根（fileURLToPath 处理 Windows 盘符） */
function detectRoot(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  // .../<root>/server/src → 回退两级
  return path.resolve(here, '..', '..');
}
export const DATA_DIR = path.join(detectRoot(), 'data');
export const CONFIG_PATH = path.join(DATA_DIR, 'config.json');
export const TOKEN_PATH = path.join(DATA_DIR, 'runtime-token');
export const AVATAR_DIR = path.join(DATA_DIR, 'avatars');
export const PROFILE_DIR = path.join(DATA_DIR, 'chrome-profile');
// 数据库文件名：likes-stats.db；首次启动自动从旧名 likeboard.db 迁移（保留旧数据）
const LEGACY_DB_PATH = path.join(DATA_DIR, 'likeboard.db');
const NEW_DB_PATH = path.join(DATA_DIR, 'likes-stats.db');
try {
  if (!fs.existsSync(NEW_DB_PATH) && fs.existsSync(LEGACY_DB_PATH)) {
    const suffixes = ['', '-wal', '-shm'];
    for (const sfx of suffixes) {
      if (fs.existsSync(LEGACY_DB_PATH + sfx)) fs.copyFileSync(LEGACY_DB_PATH + sfx, NEW_DB_PATH + sfx);
    }
    for (const sfx of suffixes) {
      if (fs.existsSync(LEGACY_DB_PATH + sfx)) fs.rmSync(LEGACY_DB_PATH + sfx, { force: true });
    }
  }
} catch { /* 迁移失败则继续用旧库，不阻塞启动 */ }
export const DB_PATH = fs.existsSync(NEW_DB_PATH) ? NEW_DB_PATH : LEGACY_DB_PATH;

let current: AppConfig = { ...DEFAULT_CONFIG };

export function loadConfig(): AppConfig {
  try {
    const raw = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
    current = { ...DEFAULT_CONFIG, ...raw };
  } catch { current = { ...DEFAULT_CONFIG }; }
  return current;
}

export function getConfig(): AppConfig { return current; }

/** 热更新（REST PATCH）→ 落盘，返回应用后的配置 */
export function patchConfig(patch: Partial<AppConfig>): AppConfig {
  // 白名单：未知键一律忽略（验证 P2-③）
  const ALLOWED: (keyof AppConfig)[] = ['roundMinutes', 'rankBasis', 'boardCount',
    'autostartCapture', 'lastRoomUrl', 'cappedThreshold', 'checkpointSec', 'surgeThreshold', 'captureTabs'];
  const p: Partial<AppConfig> = {};
  for (const k of ALLOWED) if (patch[k] !== undefined) (p as any)[k] = patch[k];
  // 白名单 + 边界钳制
  if (p.roundMinutes !== undefined) p.roundMinutes = Math.min(240, Math.max(0, Math.floor(p.roundMinutes)));
  if (p.boardCount !== undefined) p.boardCount = Math.min(100, Math.max(3, Math.floor(p.boardCount)));
  if (p.rankBasis !== undefined && p.rankBasis !== 'round' && p.rankBasis !== 'session') delete p.rankBasis;
  if (p.cappedThreshold !== undefined) p.cappedThreshold = Math.min(3000, Math.max(500, Math.floor(p.cappedThreshold)));
  if (p.surgeThreshold !== undefined) p.surgeThreshold = Math.min(3000, Math.max(50, Math.floor(p.surgeThreshold)));
  if (p.captureTabs !== undefined) p.captureTabs = Math.min(4, Math.max(1, Math.floor(p.captureTabs)));
  current = { ...current, ...p };
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(current, null, 2), 'utf-8');
  return current;
}
