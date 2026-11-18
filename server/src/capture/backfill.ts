// ─── EXP-2 进房补帧：/webcast/im/fetch 响应解码（纯函数，无副作用可测）──
// 社区参照（2026-11 独立调研核实）：
//  - 响应可能是 JSON（data.messages[].method 明文 + payload base64），
//    也可能是 protobuf LiveResponse（f1=messages[]，每条 f1=method、f2=payload 原始字节）；
//  - 响应整体可能再包一层 gzip（magic 1f 8b）——catbus/xiaokeai 均按此防御；
//  - JSON 分支 payload base64 解码后若仍 1f 8b 再 gunzip（无先例但无害的防御）。
// 全程绝不抛错：任何异常返回空列表 + note 原因，由调用方记实验日志。

import zlib from 'node:zlib';
import { parseFields, fld, fldAll, isBytes, asStr } from '../pb.js';

export interface BackfillMessage { method: string; payload: Buffer }
export type BackfillFormat = 'json' | 'gzip+json' | 'protobuf' | 'gzip+protobuf' | 'empty';
export interface BackfillDecodeResult { msgs: BackfillMessage[]; format: BackfillFormat; note?: string }

/** 判 gzip magic */
function isGzip(b: Buffer): boolean { return b.length > 2 && b[0] === 0x1f && b[1] === 0x8b; }

/** 单条 payload 兜底 gunzip（无先例的防御：base64 解出 1f 8b 时尝试） */
function maybeGunzip(b: Buffer): Buffer {
  if (!isGzip(b)) return b;
  try { return zlib.gunzipSync(b); } catch { return b; }
}

/** 解码 im/fetch 响应体（已过 HTTP content-encoding 层，浏览器栈自动解压） */
export function decodeImFetchBody(body: Buffer | null | undefined): BackfillDecodeResult {
  try {
    if (!body || !body.length) return { msgs: [], format: 'empty', note: 'empty body（CDP 静默空路径）' };
    let buf = body;
    let gz = false;
    if (isGzip(buf)) {
      try { buf = zlib.gunzipSync(buf); gz = true; }
      catch (e) { return { msgs: [], format: 'empty', note: `整体 gunzip 失败: ${String(e).slice(0, 120)}` }; }
    }
    // ① JSON 形态：{data:{messages:[{method,payload(base64)}]}}
    const head = buf.subarray(0, 1).toString('latin1');
    if (head === '{' || head === '[') {
      try {
        const json = JSON.parse(buf.toString('utf-8'));
        const list: unknown[] = json?.data?.messages ?? json?.messages ?? [];
        const msgs: BackfillMessage[] = [];
        for (const item of list) {
          const it = item as { method?: unknown; payload?: unknown } | null;
          const method = typeof it?.method === 'string' ? it.method : '';
          if (!method || typeof it?.payload !== 'string') continue;
          msgs.push({ method, payload: maybeGunzip(Buffer.from(it.payload, 'base64')) });
        }
        return { msgs, format: gz ? 'gzip+json' : 'json' };
      } catch (e) {
        return { msgs: [], format: 'empty', note: `JSON 解析失败: ${String(e).slice(0, 120)}` };
      }
    }
    // ② protobuf 形态：LiveResponse{ f1: [Message{ f1: method(string), f2: payload(bytes) }] }
    const msgs: BackfillMessage[] = [];
    for (const m of fldAll(parseFields(buf), 1)) {
      if (!isBytes(m)) continue;
      const inner = parseFields(m);
      const method = asStr(fld(inner, 1));
      const payload = fld(inner, 2);
      if (method && isBytes(payload) && payload.length) msgs.push({ method, payload });
    }
    if (!msgs.length) return { msgs: [], format: 'empty', note: `未识别形态（len=${buf.length} head=${buf.subarray(0, 8).toString('hex')}）` };
    return { msgs, format: gz ? 'gzip+protobuf' : 'protobuf' };
  } catch (e) {
    return { msgs: [], format: 'empty', note: `解码异常: ${String(e).slice(0, 160)}` };
  }
}
