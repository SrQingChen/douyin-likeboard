// 控制台 REST 客户端
export async function api<T = any>(path: string, init?: RequestInit): Promise<T> {
  // 只有带 body 的请求才声明 JSON；空 POST 若带 content-type 会被 Fastify 判为
  // “空的 JSON body”并返回 400（立即结算/刷新/重启捕获/打开榜单窗口都踩过）。
  const headers = new Headers(init?.headers);
  if (init?.body != null && !headers.has('content-type')) headers.set('content-type', 'application/json');
  const res = await fetch(path, { ...init, headers });
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try { msg = (await res.json()).error ?? msg; } catch {}
    throw new Error(msg);
  }
  return res.json() as Promise<T>;
}
export const post = (path: string, body?: unknown) =>
  api(path, { method: 'POST', body: body !== undefined ? JSON.stringify(body) : undefined });
export const patch = (path: string, body: unknown) =>
  api(path, { method: 'PATCH', body: JSON.stringify(body) });
