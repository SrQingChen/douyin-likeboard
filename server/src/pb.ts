import zlib from 'node:zlib';

// ─── int64 安全的 protobuf 裸解析层 ────────────────────────────────
// 红线（评审 P0-1，已实测）：参考项目 readVarint 用 `v |= (b & 0x7f) << shift`
// （JS 32 位位移）会损坏 >32 位的 varint（msgId/uid 均 int64）。本层一律用
// BigInt 读出，调用侧再按需转 Number（total<2^53 安全）或字符串键。

export type PBVal = bigint | Buffer<ArrayBufferLike>;
export interface PBField { no: number; wt: 0 | 2; val: PBVal }

/** BigInt varint 读取（64 位无损）。返回 [值, 下一字节下标] */
export function readVarintBig(buf: Buffer, i: number): [bigint, number] {
  let v = 0n, shift = 0n;
  for (;;) {
    const b = buf[i++];
    v |= BigInt(b & 0x7f) << shift;
    if (!(b & 0x80)) return [v, i];
    shift += 7n;
    if (shift > 70n) throw new Error('varint too long'); // 防御恶意流
  }
}

/** 遍历顶层字段（截断容错：解析失败即停，返回已解析部分） */
export function parseFields(buf: Buffer): PBField[] {
  const out: PBField[] = [];
  let i = 0;
  try {
    while (i < buf.length) {
      const [tag, j] = readVarintBig(buf, i);
      const no = Number(tag >> 3n), wt = Number(tag & 7n);
      if (wt === 0) {
        const [v, k] = readVarintBig(buf, j);
        out.push({ no, wt: 0, val: v }); i = k;
      } else if (wt === 2) {
        const [ln, k] = readVarintBig(buf, j);
        const len = Number(ln);
        if (k + len > buf.length) break; // 截断
        out.push({ no, wt: 2, val: buf.subarray(k, k + len) }); i = k + len;
      } else break; // 本协议消息不使用 5/1 wire type
    }
  } catch { /* 截断容错 */ }
  return out;
}

export const asNum = (v: PBVal | undefined): number => (typeof v === 'bigint' ? Number(v) : 0);
export const asBig = (v: PBVal | undefined): bigint => (typeof v === 'bigint' ? v : 0n);
export const asStr = (v: PBVal | undefined): string =>
  (v instanceof Buffer ? v.toString('utf-8') : '');
export const isBytes = (v: PBVal | undefined): v is Buffer => v instanceof Buffer;

/** 取指定字段号的首个出现 */
export const fld = (fields: PBField[], no: number): PBVal | undefined =>
  fields.find(f => f.no === no)?.val;
/** 取指定字段号的全部出现（repeated） */
export const fldAll = (fields: PBField[], no: number): PBVal[] =>
  fields.filter(f => f.no === no).map(f => f.val);

export interface DecodedMessage { method: string; payload: Buffer<ArrayBufferLike> }

/** PushFrame → gunzip(f8) → Response.f1[] → Message{f1:method, f2:payload} */
export function decodePushFrame(buf: Buffer): DecodedMessage[] | null {
  const f8 = parseFields(buf).find(f => f.no === 8)?.val;
  if (!(f8 instanceof Buffer)) return null;
  let inner: Buffer<ArrayBufferLike>;
  try { inner = zlib.gunzipSync(f8); } catch { return null; }
  const msgs: DecodedMessage[] = [];
  for (const f of parseFields(inner)) {
    if (f.no !== 1 || !(f.val instanceof Buffer)) continue;
    let method = '?'; let payload: Buffer<ArrayBufferLike> = Buffer.alloc(0);
    for (const g of parseFields(f.val)) {
      if (g.no === 1 && g.val instanceof Buffer) method = g.val.toString('utf-8');
      if (g.no === 2 && g.val instanceof Buffer) payload = g.val;
    }
    msgs.push({ method, payload });
  }
  return msgs;
}
