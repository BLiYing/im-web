// 本地消息持久化（IndexedDB）。对齐 iOS 的 IMDatabase：消息按会话落库，刷新/重连后从本地秒载，
// 不必每次从服务端重拉全部历史。按 owner（本人 uid）隔离，避免同一浏览器多账号串库。
// 失败一律静默（持久化是增强，绝不阻断收发主流程）。

import type { ChatMessage } from "./protocol";

const DB_NAME = "im-web";
const DB_VERSION = 1;
const STORE = "messages";

interface MsgRecord {
  id: string;        // owner|convId|convSeq —— 唯一键，保证同一条幂等覆盖、去重
  ownerConv: string; // owner|convId —— 索引：按会话批量取
  owner: string;
  convId: string;
  convSeq: number;
  from: string;
  content: string;
  contentType: string;
  timestamp: number;
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

/** 保存一条稳定消息（仅 convSeq>0；发送中/失败的临时态不入库）。失败静默。 */
export async function saveMessage(owner: string, m: ChatMessage): Promise<void> {
  if (!owner || !m.convId || !m.convSeq || m.convSeq <= 0) return;
  try {
    const db = await openDB();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).put({
        id: keyOf(owner, m.convId, m.convSeq),
        ownerConv: `${owner}|${m.convId}`,
        owner,
        convId: m.convId,
        convSeq: m.convSeq,
        from: m.from,
        content: m.content,
        contentType: m.contentType,
        timestamp: m.timestamp,
      } as MsgRecord);
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
    return recs.map((r) => ({
      serverMsgId: r.id,
      convId: r.convId,
      from: r.from,
      content: r.content,
      contentType: r.contentType,
      convSeq: r.convSeq,
      timestamp: r.timestamp,
      status: "received" as const,
    }));
  } catch {
    return [];
  }
}
