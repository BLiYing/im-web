// 本地消息库的**门面 + 唯一选择点**（D4-3a，DESKTOP_DESIGN §7.6）。
//
// 全仓所有落库/读盘都从这里走。谁在底下（浏览器 = IndexedDB，桌面 = 主进程 SQLite）
// 只在本文件的 `pickStore()` 里决定一次——**别在业务代码里问「我是不是桌面端」**
// （与 `src/platform/index.ts` 同一条规矩，见 DESKTOP_DESIGN §7.3 ③）。
//
// 为什么保留这一层同名函数、而不是让调用方写 `activeLocalStore().loadConversation(...)`：
// 20 多个调用点（`imSdk.ts` 的命名空间 import、App.tsx、useChatSearch）本来就是这个形状，
// 换实现不该顺带改它们——**这一层的价值就是让 D4-3b 只改 `pickStore()` 一处**。
//
// 契约（每个方法的语义、不变量、踩过的坑）在 localStore.types.ts；
// web 实现在 localStore.web*.ts；两套实现共跑的断言在 localStore.contract.test.ts。

import type { ChatMessage, MsgOpPatch } from "./protocol";
import type { DeleteTarget, LocalStore } from "./localStore.types";
import { webLocalStore } from "./localStore.web";
import { platform } from "../platform";

export type { LocalStore, MsgRecord, DeleteTarget, RangesSnapshot, SearchOptions } from "./localStore.types";
export { keyOf, cursorKeyOf, rejectedKeyOf } from "./localStore.types";
// 会话列表缓存（localStorage，同步）刻意不在能力接口里，理由见 localStore.types.ts 顶部。
export { saveConversations, loadConversations } from "./localStore.web";

let cached: LocalStore | null = null;

/**
 * 选一次实现。桌面端（D4-3b）走主进程 SQLite，其余一律 IndexedDB。
 *
 * **这里不判断"我是不是桌面端"**——那个判断全仓只有 `platform/index.ts` 一处（§7.3 ③）。
 * 本函数只问平台层"有没有本地库实现"，桥不在、桥半残、跑在浏览器里，答案都是 null。
 */
function pickStore(): LocalStore {
  return platform().localStore() ?? webLocalStore;
}

/**
 * 取当前宿主的本地库实现。
 *
 * **缓存是有意的**（同 `platform()`）：桥在 preload 期就注入完毕，运行中不会凭空长出来；
 * 每次调用重新探测只会让「同一次会话里前后拿到不同实现」变成可能——那种不一致比慢一点难查得多。
 */
export function activeLocalStore(): LocalStore {
  return (cached ??= pickStore());
}

// ---- 以下每个函数都只做一件事：转发给选中的实现。语义注释在 localStore.types.ts，不在这里重抄。 ----

export const saveMessage = (owner: string, m: ChatMessage): Promise<void> =>
  activeLocalStore().saveMessage(owner, m);

export const saveIncomingMessage = (owner: string, m: ChatMessage, advanceCursor: boolean): Promise<void> =>
  activeLocalStore().saveIncomingMessage(owner, m, advanceCursor);

export const saveIncomingPage = (
  owner: string, msgs: ChatMessage[], advanceTo: number, rangeFrom: number, rangeTo: number, head = 0,
): Promise<boolean> =>
  activeLocalStore().saveIncomingPage(owner, msgs, advanceTo, rangeFrom, rangeTo, head);

export const saveRejected = (owner: string, m: ChatMessage): Promise<void> =>
  activeLocalStore().saveRejected(owner, m);

export const applyMsgOpLocal = (
  owner: string, convId: string, convSeq: number, patch: MsgOpPatch, advanceCursorTo = 0,
): Promise<void> =>
  activeLocalStore().applyMsgOpLocal(owner, convId, convSeq, patch, advanceCursorTo);

export const markMessageDeleted = (owner: string, convId: string, target: DeleteTarget): Promise<void> =>
  activeLocalStore().markMessageDeleted(owner, convId, target);

export const clearMessages = (owner: string, convId: string, knownLatest = 0): Promise<void> =>
  activeLocalStore().clearMessages(owner, convId, knownLatest);

export const loadClearedUpTo = (owner: string, convId: string): Promise<number> =>
  activeLocalStore().loadClearedUpTo(owner, convId);

export const advanceSyncCursor = (owner: string, convId: string, convSeq: number): Promise<void> =>
  activeLocalStore().advanceSyncCursor(owner, convId, convSeq);

export const loadConversation = (owner: string, convId: string): Promise<ChatMessage[]> =>
  activeLocalStore().loadConversation(owner, convId);

export const loadDeletedSeqs = (owner: string, convId: string): Promise<number[]> =>
  activeLocalStore().loadDeletedSeqs(owner, convId);

export const loadSyncCursor = (owner: string, convId: string): Promise<number> =>
  activeLocalStore().loadSyncCursor(owner, convId);
