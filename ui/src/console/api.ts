// 控制台 REST 客户端
export async function api<T = any>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    headers: { 'content-type': 'application/json' },
    ...init,
  });
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try { msg = (await res.json()).error ?? msg; } catch {}
    throw new Error(msg);
  }
  return res.json() as Promise<T>;
}
export const post = (path: string, body?: unknown) =>
  api(path, { method: 'POST', body: body ? JSON.stringify(body) : undefined });
export const patch = (path: string, body: unknown) =>
  api(path, { method: 'PATCH', body: JSON.stringify(body) });
