// 本地消息库的**桌面代理**（D4-3b）：把 15 个方法转发给 preload 注入的桥，
// 桥那头是主进程的 SQLite 实现（`desktop/src/main/sqliteStore.ts`）。
//
// 本文件**不 import 任何 electron、也不读 window**——桥由调用方（`platform/desktop.ts`）
// 递进来。那是 DESKTOP_DESIGN §7.3 ② 那条硬规矩：`window.imDesktop` 的唯一调用方是
// platform/desktop.ts。好处顺带是本文件在浏览器与测试里都能加载，给个假桥就能跑契约。
//
// **两条设计取舍，都不是随手定的**：
//
// ① **桥缺任何一个方法 → 整体回落 IndexedDB，不做逐方法回退。**
//    platform 那一层的能力是逐个回退的（通知没实现就退回浏览器通知），因为那些能力彼此独立。
//    本地库不是：14 个方法走 SQLite、1 个走 IndexedDB，等于同一份数据分裂在两个库里——
//    写进 SQLite 的消息用 IndexedDB 的游标去读，比"整体用旧的"糟得多。
//
// ② **IPC 失败一律降级成兜底值，绝不让 Promise reject 冒到调用方。**
//    契约那条「失败只降级不抛」在跨进程之后更要紧：主进程崩了、通道没装、白名单拒了，
//    表现都是 invoke reject，而调用方（imSdk 的收发路径）大多是 `void localStore.xxx(...)`
//    —— 一个未捕获的 rejection 就挂在那里。写失败的兜底一律取「保守值」：
//    `saveIncomingPage` 返回 **false**（宁可重拉，不可漏拉），读失败返回空。

import type { ChatMessage, MsgOpPatch } from "./protocol";
import type { SeqRange } from "./ranges";
import { LOG_TAG, logger } from "../logging/logger";
import { LOCAL_STORE_METHODS } from "./localStore.types";
import type {
  DeleteTarget, LocalStore, MsgRecord, RangesSnapshot, SearchOptions,
} from "./localStore.types";

/**
 * 桥暴露的本地库面：**只有一个通用转发口**。
 *
 * 为什么不是 15 个方法各一个：preload 跑在 sandbox 里、引不了共享模块（相对 require 会
 * module not found → 桥没挂上 → 页面白屏，2026-09-09 被 e2e 实测抓到），逐个列举就意味着
 * 第三份方法名字面量。现在只剩两份——主进程的白名单与下面这份，
 * 由 `desktop/test/storeBridge.test.ts` 断言相等，漂移会红不会静默。
 */
export interface DesktopStoreBridge {
  call(method: string, args: unknown[]): Promise<unknown>;
}

/** 方法名清单在契约文件里（那边有编译期穷尽性检查），这里只做个别名转出去。 */
export const STORE_BRIDGE_METHODS = LOCAL_STORE_METHODS;

/** 桥可用 = 有那个通用转发口。没有就当整座桥没有（理由见文件头 ①）。 */
export function isStoreBridgeUsable(b: unknown): b is DesktopStoreBridge {
  return !!b && typeof b === "object" && typeof (b as { call?: unknown }).call === "function";
}

/** 一次调用失败时的兜底。**写操作取保守值**：整页写返回 false 让调用方重拉，别谎报成功。 */
async function call<T>(method: string, fallback: T, run: () => Promise<unknown>): Promise<T> {
  try {
    const v = (await run()) as T | undefined;
    // 通道拒绝时主进程回 undefined（见 desktop 的 installStoreIpc）——按兜底值算，
    // 不能让 `undefined` 冒充「读到空会话」之外的东西（如 loadSyncCursor 拿到 undefined）。
    return v === undefined ? fallback : v;
  } catch (error) {
    logger.warn(LOG_TAG.store, "desktop_store_call_failed", { method, error });
    return fallback;
  }
}

/**
 * 用一座桥造桌面本地库。桥不可用返回 **null**，调用方（`localStore.ts#pickStore`）据此回落 web。
 */
export function createDesktopLocalStore(bridge: unknown): LocalStore | null {
  if (!isStoreBridgeUsable(bridge)) return null;
  const b = bridge;
  return {
    name: "desktop-sqlite",

    saveMessage: (owner: string, m: ChatMessage) =>
      call("saveMessage", undefined, () => b.call("saveMessage", [owner, m])),

    saveIncomingMessage: (owner: string, m: ChatMessage, advanceCursor: boolean) =>
      call("saveIncomingMessage", undefined, () => b.call("saveIncomingMessage", [owner, m, advanceCursor])),

    // **整页一次 IPC**（§7.6.3）：别在这里拆成逐条转发，一页 100 条就是 100 次跨进程往返。
    saveIncomingPage: (
      owner: string, msgs: ChatMessage[], advanceTo: number, rangeFrom: number, rangeTo: number, head = 0,
    ) => call("saveIncomingPage", false, () => b.call("saveIncomingPage", [owner, msgs, advanceTo, rangeFrom, rangeTo, head])),

    saveRejected: (owner: string, m: ChatMessage) =>
      call("saveRejected", undefined, () => b.call("saveRejected", [owner, m])),

    applyMsgOpLocal: (owner: string, convId: string, convSeq: number, patch: MsgOpPatch, advanceCursorTo = 0) =>
      call("applyMsgOpLocal", undefined, () => b.call("applyMsgOpLocal", [owner, convId, convSeq, patch, advanceCursorTo])),

    markMessageDeleted: (owner: string, convId: string, target: DeleteTarget) =>
      call("markMessageDeleted", undefined, () => b.call("markMessageDeleted", [owner, convId, target])),

    clearMessages: (owner: string, convId: string) =>
      call("clearMessages", undefined, () => b.call("clearMessages", [owner, convId])),

    advanceSyncCursor: (owner: string, convId: string, convSeq: number) =>
      call("advanceSyncCursor", undefined, () => b.call("advanceSyncCursor", [owner, convId, convSeq])),

    registerRange: (owner: string, convId: string, lo: number, hi: number, head?: number) =>
      call<SeqRange[]>("registerRange", [], () => b.call("registerRange", [owner, convId, lo, hi, head])),

    updateRangesHead: (owner: string, convId: string, head: number) =>
      call("updateRangesHead", undefined, () => b.call("updateRangesHead", [owner, convId, head])),

    loadConversation: (owner: string, convId: string) =>
      call<ChatMessage[]>("loadConversation", [], () => b.call("loadConversation", [owner, convId])),

    loadDeletedSeqs: (owner: string, convId: string) =>
      call<number[]>("loadDeletedSeqs", [], () => b.call("loadDeletedSeqs", [owner, convId])),

    loadSyncCursor: (owner: string, convId: string) =>
      call("loadSyncCursor", 0, () => b.call("loadSyncCursor", [owner, convId])),

    loadRanges: (owner: string, convId: string) =>
      call<RangesSnapshot>("loadRanges", { ranges: [], head: 0 }, () => b.call("loadRanges", [owner, convId])),

    searchMessages: (owner: string, opts: SearchOptions) =>
      call<MsgRecord[]>("searchMessages", [], () => b.call("searchMessages", [owner, opts])),
  };
}
