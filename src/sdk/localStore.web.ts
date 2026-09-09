// `LocalStore` 的 **web 实现**（IndexedDB）——浏览器版的本地消息库，桌面版在 SQLite 就位前也用它兜底
// （DESKTOP_DESIGN §7.6.4：desktop 实现暂缺时按能力回退，IndexedDB 在 Electron 里照样能跑）。
//
// 对齐 iOS 的 IMDatabase：消息按会话落库，刷新/重连后从本地秒载，后台仅从独立连续游标增量追平。
// 按 owner（本人 uid）隔离，避免同一浏览器多账号串库。
// 失败记录 IM.STORE warn，但持久化是增强，绝不阻断收发主流程。
//
// D4-3a 起，本文件既是消息/墓碑那一族的实现，也是 **web 侧的装配点**（末尾的 `webLocalStore`）：
// 把区间（localStore.web.ranges.ts）与搜索（localStore.web.search.ts）汇总成一个 `LocalStore`。
// 地基（连接/schema/游标）在 localStore.web.db.ts —— 那一层单独拆开正是为了让这里能 import 它们
// 而不成环。**跨实现的语义契约在 localStore.types.ts，改行为前先读那里的注释。**

import type { ChatMessage, Conversation, MsgOpPatch } from "./protocol";
import { addRange } from "./ranges";
import { LOG_TAG, logger } from "../logging/logger";
import {
  cursorKeyOf, keyOf, mergeRecords, rejectedKeyOf,
  type DeleteTarget, type LocalStore,
} from "./localStore.types";
import {
  CURSOR_STORE, DELETIONS_STORE, RANGES_STORE, STORE,
  advanceCursorInStore, advanceSyncCursor, loadSyncCursor, openDB,
  type DeletionRecord, type MsgRow, type RangesRecord,
} from "./localStore.web.db";
import { loadRanges, registerRange, updateRangesHead } from "./localStore.web.ranges";
import { searchMessages } from "./localStore.web.search";

/** 保存一条已确认消息（convSeq>0）。发送中/普通失败的临时态不入库。 */
async function saveMessage(owner: string, m: ChatMessage): Promise<void> {
  if (!owner || !m.convId || !m.convSeq || m.convSeq <= 0) return;
  await put(owner, messageRecord(owner, m));
}

function messageRecord(owner: string, m: ChatMessage): MsgRow {
  return {
    id: keyOf(owner, m.convId, m.convSeq),
    ownerConv: cursorKeyOf(owner, m.convId),
    owner, convId: m.convId, convSeq: m.convSeq,
    from: m.from, fromNickname: m.fromNickname, fromRole: m.fromRole, content: m.content, contentType: m.contentType, fileName: m.fileName, fileSize: m.fileSize, caption: m.caption, mentions: m.mentions, mentionSpans: m.mentionSpans, mentionAll: m.mentionAll, sysSegments: m.sysSegments, timestamp: m.timestamp,
    serverMsgId: m.serverMsgId, // 保留真实 server_msg_id（举报消息按它定位）
    recalledAt: m.recalledAt, recalledBy: m.recalledBy, editedAt: m.editedAt, pinnedAt: m.pinnedAt,
    replyToConvSeq: m.replyToConvSeq, replySnapshot: m.replySnapshot, replyToFrom: m.replyToFrom, forwardFrom: m.forwardFrom,
    groupId: m.groupId, posterUrl: m.posterUrl,
    mediaW: m.mediaW, mediaH: m.mediaH, duration: m.duration, thumb: m.thumb, waveform: m.waveform,
  };
}

/**
 * **整页**补拉消息的原子落库（OFFLINE_BACKLOG_DESIGN §4.8）：一页消息 + 游标推进 + 区间登记
 * 全部在**同一个事务**里提交。
 *
 * 为什么按页而不是按条：不变量仍是「消息未落库则游标/区间绝不越过」，只是把粒度从"每条"
 * 降到"每页"——页内任一条失败则整页回滚、整页重拉，约束一字不改，而事务数从 N 降到 N/200。
 * 补拉 10 万条时这是 10 万次事务与 500 次事务的差别。
 *
 * advanceTo：本页权威覆盖位点（服务端 covered_conv_seq）；0 表示不推进（调用方判定本页不可信）。
 * rangeFrom/rangeTo：本页齐全的区间，登记进"本地有哪几段"目录；rangeTo<rangeFrom 表示不登记。
 */
async function saveIncomingPage(
  owner: string,
  msgs: ChatMessage[],
  advanceTo: number,
  rangeFrom: number,
  rangeTo: number,
  head = 0,
): Promise<boolean> {
  if (!owner || msgs.length === 0) return true;
  const convId = msgs[0].convId;
  const recs = msgs.filter((m) => m.convId && m.convSeq > 0).map((m) => messageRecord(owner, m));
  if (recs.length === 0) return true;
  try {
    const db = await openDB();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction([STORE, CURSOR_STORE, RANGES_STORE], "readwrite");
      const messageStore = tx.objectStore(STORE);
      for (const rec of recs) {
        const getReq = messageStore.get(rec.id);
        getReq.onsuccess = () => messageStore.put(mergeRecords(getReq.result as MsgRow | undefined, rec));
      }
      if (advanceTo > 0) advanceCursorInStore(tx.objectStore(CURSOR_STORE), owner, convId, advanceTo);
      if (rangeTo >= rangeFrom && rangeTo > 0) {
        const rangeStore = tx.objectStore(RANGES_STORE);
        const id = cursorKeyOf(owner, convId);
        const getReq = rangeStore.get(id);
        getReq.onsuccess = () => {
          const prev = getReq.result as RangesRecord | undefined;
          rangeStore.put({
            id, owner, convId,
            ranges: addRange(prev?.ranges ?? [], rangeFrom, rangeTo),
            head: Math.max(Number(prev?.head) || 0, head),
          } satisfies RangesRecord);
        };
      }
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    return true;
  } catch (error) {
    // 整页失败 → 游标与区间都没动，下次从原位幂等重拉。宁可重拉，不可漏拉。
    logger.warn(LOG_TAG.store, "incoming_page_write_failed", { conv_id: convId, count: recs.length, error });
    return false;
  }
}

/**
 * 接收/补拉消息的原子落库：消息与连续游标在同一个 IndexedDB 事务提交。
 * 崩溃时要么两者都成功，要么游标仍停在旧位置并在下次幂等重拉，不会出现“游标已过、消息没落库”。
 */
async function saveIncomingMessage(owner: string, m: ChatMessage, advanceCursor: boolean): Promise<void> {
  if (!owner || !m.convId || !m.convSeq || m.convSeq <= 0) return;
  const rec = messageRecord(owner, m);
  try {
    const db = await openDB();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction([STORE, CURSOR_STORE], "readwrite");
      const messageStore = tx.objectStore(STORE);
      const getReq = messageStore.get(rec.id);
      getReq.onsuccess = () => messageStore.put(mergeRecords(getReq.result as MsgRow | undefined, rec));
      if (advanceCursor) advanceCursorInStore(tx.objectStore(CURSOR_STORE), owner, m.convId, m.convSeq);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch (error) {
    logger.warn(LOG_TAG.store, "incoming_message_write_failed", {
      conv_id: m.convId, conv_seq: m.convSeq, content_type: m.contentType, error,
    });
  }
}

/** 把一次消息操作（撤回/编辑/置顶）就地应用到已落库消息（按 conv_seq 定位）。记录不存在则忽略。 */
async function applyMsgOpLocal(
  owner: string, convId: string, convSeq: number,
  patch: MsgOpPatch,
  advanceCursorTo = 0,
): Promise<void> {
  if (!owner || !convId || !convSeq) return;
  try {
    const db = await openDB();
    await new Promise<void>((resolve, reject) => {
      const stores = advanceCursorTo > 0 ? [STORE, CURSOR_STORE] : [STORE];
      const tx = db.transaction(stores, "readwrite");
      const os = tx.objectStore(STORE);
      const getReq = os.get(keyOf(owner, convId, convSeq));
      getReq.onsuccess = () => {
        const rec = getReq.result as MsgRow | undefined;
        if (rec) {
          if (patch.recalledAt !== undefined) rec.recalledAt = patch.recalledAt;
          if (patch.recalledBy !== undefined) rec.recalledBy = patch.recalledBy;
          if (patch.editedAt !== undefined) rec.editedAt = patch.editedAt;
          if (patch.pinnedAt !== undefined) rec.pinnedAt = patch.pinnedAt;
          if (patch.content !== undefined) {
            rec.content = patch.content;
            // @ 片段的偏移是相对**原文**的，正文一改就全错位 → 连同清空（服务端落库时也清了）。
            // 不清的话刷新后旧片段会从 IndexedDB 回来配上新正文：多数时候被
            // segmentMentionsBySpans 挡掉（那个位置不是 `@`），但只要新正文碰巧在同一偏移
            // 有个 `@`，就会高亮出来并且**点进去是另一个人**的资料页。
            rec.mentionSpans = undefined;
          }
          os.put(rec);
        }
      };
      if (advanceCursorTo > 0) {
        advanceCursorInStore(tx.objectStore(CURSOR_STORE), owner, convId, advanceCursorTo);
      }
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch (error) {
    logger.warn(LOG_TAG.store, "message_operation_write_failed", { conv_id: convId, conv_seq: convSeq, error });
  }
}

/** 保存一条被拒收的失败消息（被拉黑：服务端永不接受、无 conv_seq）。按 clientMsgId 落库，重进/刷新仍在。 */
async function saveRejected(owner: string, m: ChatMessage): Promise<void> {
  if (!owner || !m.convId || !m.clientMsgId) return;
  // 复用 messageRecord 的**完整**字段集：被拒的媒体消息也要留住 groupId/poster/尺寸/文件名，
  // 否则刷新后图片/视频退化成显示 URL 的文本气泡，相册也会因 groupId 丢失而散成独立消息。
  await put(owner, {
    ...messageRecord(owner, m),
    id: rejectedKeyOf(owner, m.convId, m.clientMsgId), // 与已确认消息的 conv_seq 键不冲突；同 clientMsgId 幂等覆盖
    convSeq: 0, // 被拒收永远拿不到 conv_seq，渲染按 timestamp 落位
    clientMsgId: m.clientMsgId, status: "failed", note: m.note,
  });
}

/** 写一条记录（put 幂等）。失败只记日志——持久化是增强，绝不阻断收发主流程。 */
async function put(owner: string, rec: MsgRow): Promise<void> {
  if (!owner) return;
  try {
    const db = await openDB();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      const store = tx.objectStore(STORE);
      const getReq = store.get(rec.id);
      getReq.onsuccess = () => {
        const existing = getReq.result as MsgRow | undefined;
        // 同一服务端消息可能先由 ACK/实时帧落库、后由 sync_resp 再次到达。
        // 后到的稀疏负载不能把已经确认的文件名/字节数覆盖为空或 0。
        store.put(mergeRecords(existing, rec));
      };
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch (error) {
    logger.warn(LOG_TAG.store, "message_write_failed", {
      conv_id: rec.convId,
      conv_seq: rec.convSeq,
      content_type: rec.contentType,
      error,
    });
  }
}

/** 取某会话的本地消息（按 conv_seq 升序）。失败记日志并返回空。 */
async function loadConversation(owner: string, convId: string): Promise<ChatMessage[]> {
  if (!owner || !convId) return [];
  try {
    const db = await openDB();
    // 消息与本会话的删除墓碑同事务读出：本人删过的消息即便被重同步重新落库，也在此过滤掉，不复现。
    // 兜底：陈旧连接可能缺 `deletions` store（升级被别的标签页阻塞时）——此时**只读 messages**，宁可暂不过滤墓碑，
    // 也不能让整个事务抛 NotFoundError 而返回空（曾导致资料卡片「媒体/文件」列表全空）。
    const hasDeletions = db.objectStoreNames.contains(DELETIONS_STORE);
    const stores = hasDeletions ? [STORE, DELETIONS_STORE] : [STORE];
    const { recs, deleted } = await new Promise<{ recs: MsgRow[]; deleted: Set<string> }>((resolve, reject) => {
      const tx = db.transaction(stores, "readonly");
      const ownerConv = cursorKeyOf(owner, convId);
      const msgReq = tx.objectStore(STORE).index("ownerConv").getAll(ownerConv);
      const delReq = hasDeletions ? tx.objectStore(DELETIONS_STORE).index("ownerConv").getAllKeys(ownerConv) : null;
      tx.oncomplete = () => resolve({
        recs: (msgReq.result as MsgRow[]) ?? [],
        deleted: new Set(((delReq?.result as IDBValidKey[] | undefined) ?? []).map(String)),
      });
      tx.onerror = () => reject(tx.error);
    });
    recs.sort((a, b) => a.convSeq - b.convSeq);
    return recs.filter((r) => !deleted.has(r.id)).map((r) =>
      r.status === "failed"
        ? {
            // 被拒收的失败消息：还原失败态 + 系统提示（红❗+下方系统行）。convSeq=0，渲染按 timestamp 落位。
            // 媒体字段一并还原（与下面已确认分支同一套）——少还原 groupId 会让相册散架、
            // 少还原 posterUrl/尺寸会让视频封面与比例丢失。
            clientMsgId: r.clientMsgId,
            convId: r.convId, from: r.from, fromNickname: r.fromNickname, fromRole: r.fromRole, content: r.content, contentType: r.contentType, fileName: r.fileName, fileSize: r.fileSize, caption: r.caption, mentions: r.mentions, mentionSpans: r.mentionSpans, mentionAll: r.mentionAll,
            convSeq: 0, timestamp: r.timestamp, status: "failed" as const, note: r.note,
            replyToConvSeq: r.replyToConvSeq, replySnapshot: r.replySnapshot, replyToFrom: r.replyToFrom, forwardFrom: r.forwardFrom,
            groupId: r.groupId, posterUrl: r.posterUrl,
            mediaW: r.mediaW, mediaH: r.mediaH, duration: r.duration, thumb: r.thumb, waveform: r.waveform,
          }
        : {
            serverMsgId: r.serverMsgId ?? r.id, // 真实 server_msg_id（旧记录无此字段则回退复合键）
            convId: r.convId, from: r.from, fromNickname: r.fromNickname, fromRole: r.fromRole, content: r.content, contentType: r.contentType, fileName: r.fileName, fileSize: r.fileSize, caption: r.caption, mentions: r.mentions, mentionSpans: r.mentionSpans, mentionAll: r.mentionAll,
            sysSegments: r.sysSegments,
            convSeq: r.convSeq, timestamp: r.timestamp, status: "received" as const,
            recalledAt: r.recalledAt, recalledBy: r.recalledBy, editedAt: r.editedAt, pinnedAt: r.pinnedAt,
            replyToConvSeq: r.replyToConvSeq, replySnapshot: r.replySnapshot, replyToFrom: r.replyToFrom, forwardFrom: r.forwardFrom,
            groupId: r.groupId, posterUrl: r.posterUrl,
            mediaW: r.mediaW, mediaH: r.mediaH, duration: r.duration, thumb: r.thumb, waveform: r.waveform,
          },
    );
  } catch (error) {
    logger.warn(LOG_TAG.store, "conversation_load_failed", { conv_id: convId, error });
    return [];
  }
}

/**
 * 本地删除一条消息（对齐 iOS「删除」——服务端无删消息接口，纯本地）：落一条删除墓碑并抹掉消息记录。
 * 墓碑令 `loadConversation` 永久过滤掉它，故刷新 / 后台重同步重新落库也不复现。
 * 传 convSeq（已确认消息）或 clientMsgId（被拒的 convSeq=0 消息，按 saveRejected 的复合键）。
 */
async function markMessageDeleted(owner: string, convId: string, opts: DeleteTarget): Promise<void> {
  if (!owner || !convId) return;
  const id = opts.convSeq && opts.convSeq > 0
    ? keyOf(owner, convId, opts.convSeq)
    : opts.clientMsgId ? rejectedKeyOf(owner, convId, opts.clientMsgId) : null;
  if (!id) return;
  try {
    const db = await openDB();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction([STORE, DELETIONS_STORE], "readwrite");
      tx.objectStore(DELETIONS_STORE).put({ id, ownerConv: cursorKeyOf(owner, convId) } satisfies DeletionRecord);
      tx.objectStore(STORE).delete(id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch (error) {
    logger.warn(LOG_TAG.store, "message_delete_failed", { conv_id: convId, error });
  }
}

/**
 * 读某会话被本地删除的 conv_seq 列表：登录/进会话时载入内存，供 onMessage 挡住服务端重同步的**复现**。
 * loadConversation 只在"读盘"时过滤墓碑，但服务端会通过实时同步(onMessage)把删掉的消息重新推来——那条路径绕过读盘过滤，
 * 故必须另有一份内存墓碑在收帧时拦截。只取 conv_seq 型墓碑（c:clientMsgId 型是被拒消息，服务端本就不会重推）。
 */
async function loadDeletedSeqs(owner: string, convId: string): Promise<number[]> {
  if (!owner || !convId) return [];
  try {
    const db = await openDB();
    const keys = await new Promise<IDBValidKey[]>((resolve, reject) => {
      const tx = db.transaction(DELETIONS_STORE, "readonly");
      const req = tx.objectStore(DELETIONS_STORE).index("ownerConv").getAllKeys(cursorKeyOf(owner, convId));
      req.onsuccess = () => resolve((req.result as IDBValidKey[]) ?? []);
      req.onerror = () => reject(req.error);
    });
    const prefix = `${owner}|${convId}|`;
    return keys.map(String)
      .filter((id) => id.startsWith(prefix) && !id.startsWith(`${prefix}c:`))
      .map((id) => Number(id.slice(prefix.length)))
      .filter((n) => Number.isFinite(n) && n > 0);
  } catch { return []; }
}

/** 清空某会话的本机消息（对齐 iOS「清空聊天记录」，仅清本地、不动服务端）。 */
async function clearMessages(owner: string, convId: string): Promise<void> {
  if (!owner || !convId) return;
  try {
    const db = await openDB();
    await new Promise<void>((resolve, reject) => {
      // **区间清单必须同事务一起清**（OFFLINE_BACKLOG_DESIGN §4.2 的反方向不变量）：
      // 清单宣称的是"这几段我已齐全"，消息删了它还留着，就是在宣称一段其实没有的内容。
      // 后果不是报错而是**空白**——取数分流先查清单，判"本地已齐全"就一个请求都不发，
      // 于是清空聊天记录 + 刷新后会话恒空，上滑/点↓ 都不自愈（/code-review 2026-09-09 抓出）。
      const hasRanges = db.objectStoreNames.contains(RANGES_STORE); // 陈旧连接兜底，同 loadConversation
      const tx = db.transaction(hasRanges ? [STORE, RANGES_STORE] : [STORE], "readwrite");
      const store = tx.objectStore(STORE);
      const req = store.index("ownerConv").getAllKeys(cursorKeyOf(owner, convId));
      req.onsuccess = () => {
        for (const key of (req.result as IDBValidKey[]) ?? []) store.delete(key);
      };
      if (hasRanges) tx.objectStore(RANGES_STORE).delete(cursorKeyOf(owner, convId));
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch (error) {
    logger.warn(LOG_TAG.store, "conversation_clear_failed", { conv_id: convId, error });
  }
}

/**
 * web 侧的 `LocalStore` 装配点：三个 web 文件汇总成一个能力面。
 *
 * D4-3b 的 SQLite 实现要与它**逐条语义对齐**，判据不在这里而在
 * `localStore.contract.test.ts`——那组断言两套实现都必须跑绿。
 */
export const webLocalStore: LocalStore = {
  name: "web-indexeddb",
  saveMessage,
  saveIncomingMessage,
  saveIncomingPage,
  saveRejected,
  applyMsgOpLocal,
  markMessageDeleted,
  clearMessages,
  advanceSyncCursor,
  registerRange,
  updateRangesHead,
  loadConversation,
  loadDeletedSeqs,
  loadSyncCursor,
  loadRanges,
  searchMessages,
};

// ---- 会话列表缓存（localStorage 单 JSON blob，按 owner）：刷新/离线时先秒显旧列表 ----
//
// **刻意不进 `LocalStore` 接口**（理由见 localStore.types.ts 顶部）：localStorage 在 Electron
// 渲染进程里原样可用，且这两个是同步 API，收进全异步的能力面等于为了整齐去改一批与桌面端无关的调用点。

const convsKey = (owner: string) => `im-web:convs:${owner}`;

/** 缓存会话列表（每次服务端拉到就覆盖写）。失败记日志但不阻断。 */
export function saveConversations(owner: string, convs: Conversation[]): void {
  if (!owner) return;
  try {
    localStorage.setItem(convsKey(owner), JSON.stringify(convs));
  } catch (error) {
    logger.warn(LOG_TAG.store, "conversation_cache_write_failed", { count: convs.length, error });
  }
}

/** 读缓存的会话列表（刷新后先秒显，再被服务端最新覆盖）。无则空数组。 */
export function loadConversations(owner: string): Conversation[] {
  if (!owner) return [];
  try {
    const s = localStorage.getItem(convsKey(owner));
    const arr = s ? JSON.parse(s) : [];
    return Array.isArray(arr) ? (arr as Conversation[]) : [];
  } catch (error) {
    logger.warn(LOG_TAG.store, "conversation_cache_read_failed", { error });
    return [];
  }
}
