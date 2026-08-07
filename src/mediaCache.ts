// 已下载媒体的持久化（C1）+ 持久失效标记。
//
// **C1 · Cache Storage**：把用户**显式下载**的文件字节写入 Cache Storage（按 uid 命名空间），刷新/离线仍在、
// 秒开——对齐 iOS 把原件落 sandbox 磁盘（`fileExistsAtPath` 命中即"就绪"）。key=消息的 content URL、
// payload=HTTP 响应，正是 Cache Storage 的本职（优于手搓 IndexedDB 存 blob）。图片/视频不走这里：它们用
// `mediaOptedIn`（解门控记录）+ 远端 URL + 浏览器 HTTP 缓存，本就刷新仍在。
//
// **持久失效标记**（草图 §02 铁律 + §06 404 止损）：命中 404/410 的 content URL 落 localStorage，刷新后立即
// 画失效占位、不再回源，掐掉 404 风暴。二者是同一枚硬币的两面：缓存"成功"、记住"永久失败"。
//
// 全部 Cache Storage 操作对不支持/被禁用的环境（Safari 隐私模式、Node 测试）**静默降级**为易失内存 blob，
// 绝不抛错影响主流程。

const CACHE_PREFIX = "im-media";

/** 按 uid 命名空间化 Cache Storage 名（跨账号隔离，同一浏览器换账号不串媒体）。 */
export function mediaCacheName(uid: string): string {
  return `${CACHE_PREFIX}-${uid || "anon"}`;
}

/** 已下载文件 content 键集合的 localStorage key（驱动登录时的 rehydrate，避免依赖 Cache keys() 的 URL 规整）。 */
export function downloadedFilesKey(uid: string): string {
  return `im.dlfiles.${uid}`;
}

/** 已失效（404/410）content 键集合的 localStorage key。 */
export function expiredKey(uid: string): string {
  return `im.expired.${uid}`;
}

const hasCaches = (): boolean => {
  try { return typeof caches !== "undefined"; } catch { return false; }
};

/** 通用字符串集合的 localStorage 读/写（末 500 条封顶，防无限增长）。缺失/损坏一律回退空集，绝不抛。 */
export function loadStrSet(storageKey: string): Set<string> {
  try {
    const a = JSON.parse(localStorage.getItem(storageKey) || "[]");
    return new Set(Array.isArray(a) ? (a as string[]) : []);
  } catch {
    return new Set();
  }
}

export function saveStrSet(storageKey: string, set: Set<string>): void {
  try {
    localStorage.setItem(storageKey, JSON.stringify([...set].slice(-500)));
  } catch {
    /* 配额满等，忽略 */
  }
}

/** 写入一份下载好的字节；失败（配额/隐私模式）静默降级。 */
export async function cachePutBlob(uid: string, url: string, blob: Blob): Promise<void> {
  if (!hasCaches() || !url) return;
  try {
    const c = await caches.open(mediaCacheName(uid));
    await c.put(url, new Response(blob, {
      headers: { "Content-Type": blob.type || "application/octet-stream" },
    }));
  } catch {
    /* 配额满 / 隐私模式禁用：降级为易失内存 blob */
  }
}

/** 取回某 content 的持久字节；无则 null。用与写入时**同一个** url 字符串，规整一致。 */
export async function cacheMatchBlob(uid: string, url: string): Promise<Blob | null> {
  if (!hasCaches() || !url) return null;
  try {
    const c = await caches.open(mediaCacheName(uid));
    const resp = await c.match(url);
    return resp ? await resp.blob() : null;
  } catch {
    return null;
  }
}

/** 清空该账号的持久媒体缓存（设置 ▸ 数据与存储 / 换账号）。 */
export async function cacheClear(uid: string): Promise<void> {
  if (!hasCaches()) return;
  try { await caches.delete(mediaCacheName(uid)); } catch { /* ignore */ }
}
