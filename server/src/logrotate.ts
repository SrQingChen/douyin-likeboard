// ─── 日志轮转：防长跑膨胀（>maxBytes 时保 keep 代）──────────────────
import fs from 'node:fs';

export function rotateLog(file: string, maxBytes = 20 * 1024 * 1024, keep = 1) {
  try {
    const st = fs.statSync(file);
    if (st.size < maxBytes) return false;
    for (let i = keep; i >= 1; i--) {
      const from = i === 1 ? file : `${file}.${i - 1}`;
      const to = `${file}.${i}`;
      if (fs.existsSync(from)) {
        try { fs.rmSync(to, { force: true }); } catch {}
        try { fs.renameSync(from, to); } catch { break; } // 被占用（bat 追加句柄）则尽力而为
      }
    }
    return true;
  } catch { return false; }
}
