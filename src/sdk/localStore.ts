// 本地消息持久化（IndexedDB）。对齐 iOS 的 IMDatabase：消息按会话落库，刷新/重连后从本地秒载，
// 后台仅从独立连续游标增量追平。按 owner（本人 uid）隔离，避免同一浏览器多账号串库。
// 失败记录 IM.STORE warn，但持久化是增强，绝不阻断收发主流程。

import type { ChatMessage, Conversation } from "./protocol";
import { LOG_TAG, logger } from "../logging/logger";

const DB_NAME = "im-web";
// v4：修「曾中途升到 v3 但 deletions store 没建成」的坏库（HMR 半态/失败升级）——版本不变时 onupgradeneeded 不再触发，
// 缺的 store 永远补不上；bump 一版强制走一次 onupgradeneeded（`if(!contains)` 幂等，只补缺的、不动已有数据）。
const DB_VERSION = 4;
const STORE = "messages";
const CURSOR_STORE = "sync_cursors";
const DELETIONS_STORE = "deletions"; // 本地删除墓碑：本人删过的消息 id，刷新/重同步后仍不复现（无服务端删消息接口，本地兜底）

interface MsgRecord {
  id: string;        // 已确认：owner|convId|convSeq；被拒(convSeq=0)：owner|convId|c:clientMsgId —— 唯一键，幂等覆盖
  ownerConv: string; // owner|convId —— 索引：按会话批量取
  owner: string;
  convId: string;
  convSeq: number;
  from: string;
  content: string;
  contentType: string;
  fileName?: string;
  fileSize?: number;
  timestamp: number;
  serverMsgId?: string; // 服务端真实消息 id（举报消息等需用真实 id，不能用复合键 id）
  // 被拉黑拒收等失败消息：服务端永不接受（无 conv_seq），故按本地态落库，重进/刷新仍在。
  clientMsgId?: string;
  status?: "failed";  // 仅落"被拒"失败态；已确认消息不写此字段（读回默认 received）
  note?: string;      // 系统提示文案（如"消息已发出，但被对方拒收了"）
  // M4 消息操作派生状态（撤回/编辑/置顶）：由 applyMsgOpLocal 就地更新，读回还原到 ChatMessage。
  recalledAt?: number;
  recalledBy?: string;
  editedAt?: number;
  pinnedAt?: number;
  replyToConvSeq?: number;
  replySnapshot?: string;
  replyToFrom?: string;
  forwardFrom?: string;
  groupId?: string; // 相册分组（M4+）
  posterUrl?: string; // 视频封面首帧 URL（M4+）
  mediaW?: number;    // 媒体像素宽（M4+）：按原比例渲染气泡，免加载完跳版
  mediaH?: number;    // 媒体像素高（M4+）
  duration?: number;  // 视频时长毫秒（M4+）：封面左上角角标
  thumb?: string;     // 极小模糊预览 data URI（M4-7）：未下载卡片的磨砂占位。**必须持久化**，否则刷新后门控图退化成中性斜纹底
}

interface DeletionRecord {
  id: string;        // 被删消息的记录键（owner|convId|convSeq 或 owner|convId|c:clientMsgId），与 MsgRecord.id 同形
  ownerConv: string; // owner|convId —— 索引：loadConversation 时批量取本会话墓碑
}

interface SyncCursorRecord {
  id: string;       // owner|convId
  owner: string;
  convId: string;
  convSeq: number;  // 已经连续持久化完成的最大 conv_seq；不是本地消息最大值
}

let dbPromise: Promise<IDBDatabase> | null = null;

/** 本次连接期望具备的全部 object store —— 用于校验拿到的连接是不是「缺 store 的陈旧连接」。 */
const EXPECTED_STORES = [STORE, CURSOR_STORE, DELETIONS_STORE] as const;

function openDB(attempt = 0): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const os = db.createObjectStore(STORE, { keyPath: "id" });
        os.createIndex("ownerConv", "ownerConv", { unique: false });
      }
      if (!db.objectStoreNames.contains(CURSOR_STORE)) {
        db.createObjectStore(CURSOR_STORE, { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains(DELETIONS_STORE)) {
        const ds = db.createObjectStore(DELETIONS_STORE, { keyPath: "id" });
        ds.createIndex("ownerConv", "ownerConv", { unique: false });
      }
    };
    // 另一标签页/连接占着旧版本 → 本次升级被阻塞（多标签页测号常见）。留痕，靠对方收到 versionchange 关闭后放行。
    req.onblocked = () => logger.warn(LOG_TAG.store, "indexeddb_open_blocked", { db: DB_NAME, version: DB_VERSION });
    req.onsuccess = () => {
      const db = req.result;
      // 别的标签页要升级 schema 时，关闭本连接并清缓存 —— 否则本连接会阻塞对方升级，且升级后本连接仍是旧结构（缺新 store）。
      db.onversionchange = () => { try { db.close(); } finally { dbPromise = null; } };
      resolve(db);
    };
    req.onerror = () => reject(req.error);
  }).then((db) => {
    // 兜底自愈：若拿到的是「缺某个 store 的陈旧连接」（曾以旧版本打开、被 dbPromise 缓存复用），
    // 关掉并清缓存重开一次触发升级（此时本连接已不占用，升级可放行）。最多重试 2 次，避免被别的标签页
    // 长期阻塞时死循环——仍缺则返回该连接，由各读函数按 objectStoreNames 兜底降级（见 loadConversation）。
    const missing = EXPECTED_STORES.some((s) => !db.objectStoreNames.contains(s));
    if (missing && attempt < 2) {
      db.close();
      dbPromise = null;
      return openDB(attempt + 1);
    }
    return db;
  });
  return dbPromise;
}

const keyOf = (owner: string, convId: string, convSeq: number) => `${owner}|${convId}|${convSeq}`;
const cursorKeyOf = (owner: string, convId: string) => `${owner}|${convId}`;

/** 保存一条已确认消息（convSeq>0）。发送中/普通失败的临时态不入库。 */
export async function saveMessage(owner: string, m: ChatMessage): Promise<void> {
  if (!owner || !m.convId || !m.convSeq || m.convSeq <= 0) return;
  await put(owner, messageRecord(owner, m));
}

function messageRecord(owner: string, m: ChatMessage): MsgRecord {
  return {
    id: keyOf(owner, m.convId, m.convSeq),
    ownerConv: `${owner}|${m.convId}`,
    owner, convId: m.convId, convSeq: m.convSeq,
    from: m.from, content: m.content, contentType: m.contentType, fileName: m.fileName, fileSize: m.fileSize, timestamp: m.timestamp,
    serverMsgId: m.serverMsgId, // 保留真实 server_msg_id（举报消息按它定位）
    recalledAt: m.recalledAt, recalledBy: m.recalledBy, editedAt: m.editedAt, pinnedAt: m.pinnedAt,
    replyToConvSeq: m.replyToConvSeq, replySnapshot: m.replySnapshot, replyToFrom: m.replyToFrom, forwardFrom: m.forwardFrom,
    groupId: m.groupId, posterUrl: m.posterUrl,
    mediaW: m.mediaW, mediaH: m.mediaH, duration: m.duration, thumb: m.thumb,
  };
}

function mergedRecord(existing: MsgRecord | undefined, rec: MsgRecord): MsgRecord {
  return {
    ...existing,
    ...rec,
    fileName: rec.fileName || existing?.fileName,
    fileSize: rec.fileSize !== undefined && rec.fileSize > 0 ? rec.fileSize : existing?.fileSize ?? rec.fileSize,
    serverMsgId: rec.serverMsgId || existing?.serverMsgId,
  };
}

function advanceCursorInStore(store: IDBObjectStore, owner: string, convId: string, convSeq: number): void {
  if (convSeq <= 0) return;
  const id = cursorKeyOf(owner, convId);
  const req = store.get(id);
  req.onsuccess = () => {
    const previous = Number((req.result as SyncCursorRecord | undefined)?.convSeq) || 0;
    if (convSeq > previous) store.put({ id, owner, convId, convSeq } satisfies SyncCursorRecord);
  };
}

/**
 * 接收/补拉消息的原子落库：消息与连续游标在同一个 IndexedDB 事务提交。
 * 崩溃时要么两者都成功，要么游标仍停在旧位置并在下次幂等重拉，不会出现“游标已过、消息没落库”。
 */
export async function saveIncomingMessage(owner: string, m: ChatMessage, advanceCursor: boolean): Promise<void> {
  if (!owner || !m.convId || !m.convSeq || m.convSeq <= 0) return;
  const rec = messageRecord(owner, m);
  try {
    const db = await openDB();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction([STORE, CURSOR_STORE], "readwrite");
      const messageStore = tx.objectStore(STORE);
      const getReq = messageStore.get(rec.id);
      getReq.onsuccess = () => messageStore.put(mergedRecord(getReq.result as MsgRecord | undefined, rec));
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
export async function applyMsgOpLocal(
  owner: string, convId: string, convSeq: number,
  patch: { recalledAt?: number; recalledBy?: string; editedAt?: number; pinnedAt?: number; content?: string },
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
        const rec = getReq.result as MsgRecord | undefined;
        if (rec) {
          if (patch.recalledAt !== undefined) rec.recalledAt = patch.recalledAt;
          if (patch.recalledBy !== undefined) rec.recalledBy = patch.recalledBy;
          if (patch.editedAt !== undefined) rec.editedAt = patch.editedAt;
          if (patch.pinnedAt !== undefined) rec.pinnedAt = patch.pinnedAt;
          if (patch.content !== undefined) rec.content = patch.content;
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
export async function saveRejected(owner: string, m: ChatMessage): Promise<void> {
  if (!owner || !m.convId || !m.clientMsgId) return;
  // 复用 messageRecord 的**完整**字段集：被拒的媒体消息也要留住 groupId/poster/尺寸/文件名，
  // 否则刷新后图片/视频退化成显示 URL 的文本气泡，相册也会因 groupId 丢失而散成独立消息。
  await put(owner, {
    ...messageRecord(owner, m),
    id: `${owner}|${m.convId}|c:${m.clientMsgId}`, // 与已确认消息的 conv_seq 键不冲突；同 clientMsgId 幂等覆盖
    convSeq: 0, // 被拒收永远拿不到 conv_seq，渲染按 timestamp 落位
    clientMsgId: m.clientMsgId, status: "failed", note: m.note,
  });
}

/** 写一条记录（put 幂等）。失败只记日志——持久化是增强，绝不阻断收发主流程。 */
async function put(owner: string, rec: MsgRecord): Promise<void> {
  if (!owner) return;
  try {
    const db = await openDB();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      const store = tx.objectStore(STORE);
      const getReq = store.get(rec.id);
      getReq.onsuccess = () => {
        const existing = getReq.result as MsgRecord | undefined;
        // 同一服务端消息可能先由 ACK/实时帧落库、后由 sync_resp 再次到达。
        // 后到的稀疏负载不能把已经确认的文件名/字节数覆盖为空或 0。
        store.put(mergedRecord(existing, rec));
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

/** 读取按账号+会话隔离的连续同步游标。无记录表示从 0 开始，不从消息最大值推断。 */
export async function loadSyncCursor(owner: string, convId: string): Promise<number> {
  if (!owner || !convId) return 0;
  try {
    const db = await openDB();
    return await new Promise<number>((resolve, reject) => {
      const tx = db.transaction(CURSOR_STORE, "readonly");
      const req = tx.objectStore(CURSOR_STORE).get(cursorKeyOf(owner, convId));
      req.onsuccess = () => resolve(Math.max(0, Number((req.result as SyncCursorRecord | undefined)?.convSeq) || 0));
      req.onerror = () => reject(req.error);
    });
  } catch (error) {
    logger.warn(LOG_TAG.store, "sync_cursor_read_failed", { conv_id: convId, error });
    return 0;
  }
}

/**
 * 单调推进连续同步游标。调用方只可在对应消息/操作已处理后调用；游标本身按 owner 隔离持久化。
 * 写失败时下次从较低位置重拉，最多产生幂等重复，不会漏消息。
 */
export async function advanceSyncCursor(owner: string, convId: string, convSeq: number): Promise<void> {
  if (!owner || !convId || convSeq <= 0) return;
  try {
    const db = await openDB();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(CURSOR_STORE, "readwrite");
      const store = tx.objectStore(CURSOR_STORE);
      advanceCursorInStore(store, owner, convId, convSeq);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch (error) {
    logger.warn(LOG_TAG.store, "sync_cursor_write_failed", { conv_id: convId, conv_seq: convSeq, error });
  }
}

/** 取某会话的本地消息（按 conv_seq 升序）。失败记日志并返回空。 */
export async function loadConversation(owner: string, convId: string): Promise<ChatMessage[]> {
  if (!owner || !convId) return [];
  try {
    const db = await openDB();
    // 消息与本会话的删除墓碑同事务读出：本人删过的消息即便被重同步重新落库，也在此过滤掉，不复现。
    // 兜底：陈旧连接可能缺 `deletions` store（升级被别的标签页阻塞时）——此时**只读 messages**，宁可暂不过滤墓碑，
    // 也不能让整个事务抛 NotFoundError 而返回空（曾导致资料卡片「媒体/文件」列表全空）。
    const hasDeletions = db.objectStoreNames.contains(DELETIONS_STORE);
    const stores = hasDeletions ? [STORE, DELETIONS_STORE] : [STORE];
    const { recs, deleted } = await new Promise<{ recs: MsgRecord[]; deleted: Set<string> }>((resolve, reject) => {
      const tx = db.transaction(stores, "readonly");
      const ownerConv = `${owner}|${convId}`;
      const msgReq = tx.objectStore(STORE).index("ownerConv").getAll(ownerConv);
      const delReq = hasDeletions ? tx.objectStore(DELETIONS_STORE).index("ownerConv").getAllKeys(ownerConv) : null;
      tx.oncomplete = () => resolve({
        recs: (msgReq.result as MsgRecord[]) ?? [],
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
            convId: r.convId, from: r.from, content: r.content, contentType: r.contentType, fileName: r.fileName, fileSize: r.fileSize,
            convSeq: 0, timestamp: r.timestamp, status: "failed" as const, note: r.note,
            replyToConvSeq: r.replyToConvSeq, replySnapshot: r.replySnapshot, replyToFrom: r.replyToFrom, forwardFrom: r.forwardFrom,
            groupId: r.groupId, posterUrl: r.posterUrl,
            mediaW: r.mediaW, mediaH: r.mediaH, duration: r.duration, thumb: r.thumb,
          }
        : {
            serverMsgId: r.serverMsgId ?? r.id, // 真实 server_msg_id（旧记录无此字段则回退复合键）
            convId: r.convId, from: r.from, content: r.content, contentType: r.contentType, fileName: r.fileName, fileSize: r.fileSize,
            convSeq: r.convSeq, timestamp: r.timestamp, status: "received" as const,
            recalledAt: r.recalledAt, recalledBy: r.recalledBy, editedAt: r.editedAt, pinnedAt: r.pinnedAt,
            replyToConvSeq: r.replyToConvSeq, replySnapshot: r.replySnapshot, replyToFrom: r.replyToFrom, forwardFrom: r.forwardFrom,
            groupId: r.groupId, posterUrl: r.posterUrl,
            mediaW: r.mediaW, mediaH: r.mediaH, duration: r.duration, thumb: r.thumb,
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
export async function markMessageDeleted(
  owner: string,
  convId: string,
  opts: { convSeq?: number; clientMsgId?: string },
): Promise<void> {
  if (!owner || !convId) return;
  const id = opts.convSeq && opts.convSeq > 0
    ? keyOf(owner, convId, opts.convSeq)
    : opts.clientMsgId ? `${owner}|${convId}|c:${opts.clientMsgId}` : null;
  if (!id) return;
  try {
    const db = await openDB();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction([STORE, DELETIONS_STORE], "readwrite");
      tx.objectStore(DELETIONS_STORE).put({ id, ownerConv: `${owner}|${convId}` } satisfies DeletionRecord);
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
export async function loadDeletedSeqs(owner: string, convId: string): Promise<number[]> {
  if (!owner || !convId) return [];
  try {
    const db = await openDB();
    const keys = await new Promise<IDBValidKey[]>((resolve, reject) => {
      const tx = db.transaction(DELETIONS_STORE, "readonly");
      const req = tx.objectStore(DELETIONS_STORE).index("ownerConv").getAllKeys(`${owner}|${convId}`);
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
export async function clearMessages(owner: string, convId: string): Promise<void> {
  if (!owner || !convId) return;
  try {
    const db = await openDB();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      const store = tx.objectStore(STORE);
      const req = store.index("ownerConv").getAllKeys(`${owner}|${convId}`);
      req.onsuccess = () => {
        for (const key of (req.result as IDBValidKey[]) ?? []) store.delete(key);
      };
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch (error) {
    logger.warn(LOG_TAG.store, "conversation_clear_failed", { conv_id: convId, error });
  }
}

// ---- 会话列表缓存（localStorage 单 JSON blob，按 owner）：刷新/离线时先秒显旧列表 ----

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
