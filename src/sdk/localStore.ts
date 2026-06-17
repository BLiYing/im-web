// 本地消息持久化（IndexedDB）。对齐 iOS 的 IMDatabase：消息按会话落库，刷新/重连后从本地秒载，
// 不必每次从服务端重拉全部历史。按 owner（本人 uid）隔离，避免同一浏览器多账号串库。
// 失败一律静默（持久化是增强，绝不阻断收发主流程）。

import type { ChatMessage, Conversation } from "./protocol";

const DB_NAME = "im-web";
const DB_VERSION = 1;
const STORE = "messages";

interface MsgRecord {
  id: string;        // 已确认：owner|convId|convSeq；被拒(convSeq=0)：owner|convId|c:clientMsgId —— 唯一键，幂等覆盖
  ownerConv: string; // owner|convId —— 索引：按会话批量取
  owner: string;
  convId: string;
  convSeq: number;
  from: string;
  content: string;
  contentType: string;
  timestamp: number;
  serverMsgId?: string; // 服务端真实消息 id（举报消息等需用真实 id，不能用复合键 id）
  // 被拉黑拒收等失败消息：服务端永不接受（无 conv_seq），故按本地态落库，重进/刷新仍在。
  clientMsgId?: string;
  status?: "failed";  // 仅落"被拒"失败态；已确认消息不写此字段（读回默认 received）
  note?: string;      // 系统提示文案（如"消息已发出，但被对方拒收了"）
}

let dbPromise: Promise<IDBDatabase> | null = null;

function openDB(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const os = db.createObjectStore(STORE, { keyPath: "id" });
        os.createIndex("ownerConv", "ownerConv", { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

const keyOf = (owner: string, convId: string, convSeq: number) => `${owner}|${convId}|${convSeq}`;

/** 保存一条已确认消息（convSeq>0）。发送中/普通失败的临时态不入库。失败静默。 */
export async function saveMessage(owner: string, m: ChatMessage): Promise<void> {
  if (!owner || !m.convId || !m.convSeq || m.convSeq <= 0) return;
  await put(owner, {
    id: keyOf(owner, m.convId, m.convSeq),
    ownerConv: `${owner}|${m.convId}`,
    owner, convId: m.convId, convSeq: m.convSeq,
    from: m.from, content: m.content, contentType: m.contentType, timestamp: m.timestamp,
    serverMsgId: m.serverMsgId, // 保留真实 server_msg_id（举报消息按它定位）
  });
}

/** 保存一条被拒收的失败消息（被拉黑：服务端永不接受、无 conv_seq）。按 clientMsgId 落库，重进/刷新仍在。 */
export async function saveRejected(owner: string, m: ChatMessage): Promise<void> {
  if (!owner || !m.convId || !m.clientMsgId) return;
  await put(owner, {
    id: `${owner}|${m.convId}|c:${m.clientMsgId}`, // 与已确认消息的 conv_seq 键不冲突；同 clientMsgId 幂等覆盖
    ownerConv: `${owner}|${m.convId}`,
    owner, convId: m.convId, convSeq: 0,
    from: m.from, content: m.content, contentType: m.contentType, timestamp: m.timestamp,
    clientMsgId: m.clientMsgId, status: "failed", note: m.note,
  });
}

/** 写一条记录（put 幂等）。失败静默——持久化是增强，绝不阻断收发主流程。 */
async function put(owner: string, rec: MsgRecord): Promise<void> {
  if (!owner) return;
  try {
    const db = await openDB();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).put(rec);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    /* 持久化失败不影响主流程 */
  }
}

/** 取某会话的本地消息（按 conv_seq 升序）。失败/无库返回空。 */
export async function loadConversation(owner: string, convId: string): Promise<ChatMessage[]> {
  if (!owner || !convId) return [];
  try {
    const db = await openDB();
    const recs = await new Promise<MsgRecord[]>((resolve, reject) => {
      const tx = db.transaction(STORE, "readonly");
      const req = tx.objectStore(STORE).index("ownerConv").getAll(`${owner}|${convId}`);
      req.onsuccess = () => resolve((req.result as MsgRecord[]) ?? []);
      req.onerror = () => reject(req.error);
    });
    recs.sort((a, b) => a.convSeq - b.convSeq);
    return recs.map((r) =>
      r.status === "failed"
        ? {
            // 被拒收的失败消息：还原失败态 + 系统提示（红❗+下方系统行）。convSeq=0，渲染按 timestamp 落位。
            clientMsgId: r.clientMsgId,
            convId: r.convId, from: r.from, content: r.content, contentType: r.contentType,
            convSeq: 0, timestamp: r.timestamp, status: "failed" as const, note: r.note,
          }
        : {
            serverMsgId: r.serverMsgId ?? r.id, // 真实 server_msg_id（旧记录无此字段则回退复合键）
            convId: r.convId, from: r.from, content: r.content, contentType: r.contentType,
            convSeq: r.convSeq, timestamp: r.timestamp, status: "received" as const,
          },
    );
  } catch {
    return [];
  }
}

// ---- 会话列表缓存（localStorage 单 JSON blob，按 owner）：刷新/离线时先秒显旧列表 ----

const convsKey = (owner: string) => `im-web:convs:${owner}`;

/** 缓存会话列表（每次服务端拉到就覆盖写）。失败静默。 */
export function saveConversations(owner: string, convs: Conversation[]): void {
  if (!owner) return;
  try {
    localStorage.setItem(convsKey(owner), JSON.stringify(convs));
  } catch {
    /* 配额满/隐私模式等：静默 */
  }
}

/** 读缓存的会话列表（刷新后先秒显，再被服务端最新覆盖）。无则空数组。 */
export function loadConversations(owner: string): Conversation[] {
  if (!owner) return [];
  try {
    const s = localStorage.getItem(convsKey(owner));
    const arr = s ? JSON.parse(s) : [];
    return Array.isArray(arr) ? (arr as Conversation[]) : [];
  } catch {
    return [];
  }
}
