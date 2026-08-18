// 图片/视频「已解门控」的持久化（方案 B）：opt-in 是内存 Set，刷新即失。存 localStorage（按 uid，末 500 条）→
// 刷新后仍直显远端（浏览器 HTTP 缓存秒出），兑现「解门控后刷新仍在」。content URL 每条唯一、跨会话不冲突。
export const optedInKey = (uid: string) => `im.optedIn.${uid}`;

export function loadOptedIn(uid: string): Set<string> {
  try { const a = JSON.parse(localStorage.getItem(optedInKey(uid)) || "[]"); return new Set(Array.isArray(a) ? a : []); }
  catch { return new Set(); }
}

export function saveOptedIn(uid: string, set: Set<string>): void {
  try { localStorage.setItem(optedInKey(uid), JSON.stringify([...set].slice(-500))); } catch { /* 配额满等，忽略 */ }
}
