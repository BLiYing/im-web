// 本地库桥的通道定义与方法白名单。**只有主进程用**。
//
// ⚠️ **preload 引不了本文件**：它跑在 sandbox 里，那份 `require` 只认 `electron`，
// 相对路径会在运行时 module not found → 桥没挂上 → 页面白屏（2026-09-09 被 `npm run e2e` 实测抓到）。
// 所以 preload 里的 `IPC_STORE` 是一份手抄的字面量，而它**不列举方法名**——
// 只暴露一个通用 `call(method, args)`，把「会漂移的地方」从三处降到两处。
//
// 剩下的两处是：本文件的白名单，与 im-web `src/sdk/localStore.desktop.ts` 的
// `STORE_BRIDGE_METHODS`（跨仓，两套独立依赖树跨不过去）。这两份由
// `test/storeBridge.test.ts` 断言相等——漂移会红，不会静默。

/** 唯一的本地库通道。载荷 `{ method, args }`，method 必须在白名单内。 */
export const IPC_STORE = "im:store";

/**
 * 桥暴露的方法白名单，与 im-web `LocalStore` 接口一一对应。
 *
 * ⚠️ **`saveIncomingPage` 必须保持「整页一次调用」**（DESKTOP_DESIGN §7.6.3）：
 * 拆成逐条就是一页 100 次跨进程往返，同步 10 万条时是 500 次与 10 万次的差别。
 */
export const STORE_METHODS = [
  "saveMessage",
  "saveIncomingMessage",
  "saveIncomingPage",
  "saveRejected",
  "applyMsgOpLocal",
  "markMessageDeleted",
  "clearMessages",
  "advanceSyncCursor",
  "registerRange",
  "updateRangesHead",
  "loadConversation",
  "loadDeletedSeqs",
  "loadSyncCursor",
  "loadRanges",
  "loadClearedUpTo",
  "searchMessages",
] as const;

export type StoreMethod = (typeof STORE_METHODS)[number];

/** 主进程侧的白名单校验。**不能直接 `store[payload.method]`**——那等于把渲染进程的任意
 *  属性访问转发给主进程对象（能摸到 `close` 之类不该暴露的东西）。 */
export function isStoreMethod(v: unknown): v is StoreMethod {
  return typeof v === "string" && (STORE_METHODS as readonly string[]).includes(v);
}
