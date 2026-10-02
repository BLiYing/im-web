// web 实现（IndexedDB）的库连接与 schema —— `LocalStore` 的 web 一侧共用的地基。
//
// 从 localStore.web.ts 拆出（D4-3a）：三个 web 文件（消息 / 区间 / 搜索）都要 `openDB` 与
// store 名，而消息那个文件还要**汇总**出 `webLocalStore` 对象——不把地基单独拆一层，
// 汇总处 import 区间/搜索、区间/搜索又 import 回来，就是一圈运行时循环依赖
// （`src/platform/types.ts` 里为同一个理由拆过一次纯类型文件）。
// 连续游标的读写也在这儿：区间目录的老库回退要读它，它自己不依赖任何别的实现文件。
//
// **本文件只服务 web 实现**，SQLite 那侧没有对应物；跨实现的契约在 localStore.types.ts。

import { cursorKeyOf, type MsgRecord } from "./localStore.types";
import { backfillClearedUpTo, seqFromRecordKey } from "./clearFloor";
import type { SeqRange } from "./ranges";
import { LOG_TAG, logger } from "../logging/logger";

const DB_NAME = "im-web";
// v4：修「曾中途升到 v3 但 deletions store 没建成」的坏库（HMR 半态/失败升级）——版本不变时 onupgradeneeded 不再触发，
// 缺的 store 永远补不上；bump 一版强制走一次 onupgradeneeded（`if(!contains)` 幂等，只补缺的、不动已有数据）。
// v5：新增 ranges store（离线积压的「本地有哪几段」目录，见 OFFLINE_BACKLOG_DESIGN §4.2）。
// v6：游标行新增 `clearedUpTo`（本机清空位点，§6.7）——**不新增 store**（那正是「事务 NotFoundError → 列表空」的老坑），
//     只在升级事务里给既有游标行回填一次位点（`backfillClearedUpTo`）。升级需要旧连接让路：见 `db.onversionchange`。
const DB_VERSION = 6;
export const STORE = "messages";
export const CURSOR_STORE = "sync_cursors";
export const DELETIONS_STORE = "deletions"; // 本地删除墓碑：本人删过的消息 id，刷新/重同步后仍不复现（无服务端删消息接口，本地兜底）
export const RANGES_STORE = "conv_ranges";  // 「本地有哪几段」目录：一个会话一行，值是归一化后的区间数组

/**
 * IndexedDB object store 的**单一来源清单**。新增一个 store 只需在此加一项 + bump `DB_VERSION`：
 * `onupgradeneeded` 建表、`EXPECTED_STORES` 校验、陈旧连接自愈都从它派生——杜绝「加 store 要四处同改、
 * 漏一处 → 升级过的老库事务抛 `NotFoundError`、悄悄空列表」的历史坑（见 CODING_STYLE §九）。
 * 所有 store 主键均为 `id`（复合键字符串，见各 *Record 的 id 字段）。
 */
interface StoreDef {
  name: string;
  keyPath: string;
  indexes?: { name: string; keyPath: string; unique?: boolean }[];
}
const STORE_DEFS: StoreDef[] = [
  { name: STORE, keyPath: "id", indexes: [{ name: "ownerConv", keyPath: "ownerConv" }] },
  { name: CURSOR_STORE, keyPath: "id" },
  { name: DELETIONS_STORE, keyPath: "id", indexes: [{ name: "ownerConv", keyPath: "ownerConv" }] },
  { name: RANGES_STORE, keyPath: "id" },
];

/**
 * 落进 messages store 的一行 = 契约里的 `MsgRecord` **加一个 `ownerConv` 索引字段**。
 * 索引字段是 IndexedDB 特有的（"按会话批量取"靠它），SQLite 那侧用 WHERE 就够，
 * 所以它留在本实现里、不进 `localStore.types.ts`。
 */
export interface MsgRow extends MsgRecord {
  ownerConv: string; // owner|convId —— 索引：按会话批量取
}

export interface DeletionRecord {
  id: string;        // 被删消息的记录键（owner|convId|convSeq 或 owner|convId|c:clientMsgId），与 MsgRow.id 同形
  ownerConv: string; // owner|convId —— 索引：loadConversation 时批量取本会话墓碑
}

/**
 * 「本地有哪几段」的持久化行：一个 (owner, conv) 一行。
 *
 * 与 SyncCursorRecord 的关系：游标是这张目录的**派生量**（从下界起连续到哪），
 * 两者都留着是为了向后兼容——老库只有游标，升级后第一次读会由游标反推出首段区间。
 */
export interface RangesRecord {
  id: string;     // owner|convId
  owner: string;
  convId: string;
  ranges: SeqRange[];
  head?: number;  // 服务端最新位点的最近一次快照（sync_resp 的 head_conv_seq），用于判"齐不齐"
}

export interface SyncCursorRecord {
  id: string;       // owner|convId
  owner: string;
  convId: string;
  convSeq: number;  // 已经连续持久化完成的最大 conv_seq；不是本地消息最大值
  /** 本机清空位点（只增不减，纯本机）。与游标同行存放：落库过滤要在**同一事务**里读它，游标 store 本来就在那些事务里。 */
  clearedUpTo?: number;
}

let dbPromise: Promise<IDBDatabase> | null = null;

/** 本次连接期望具备的全部 object store（从 STORE_DEFS 派生）——校验拿到的连接是不是「缺 store 的陈旧连接」。 */
const EXPECTED_STORES = STORE_DEFS.map((s) => s.name);

export function openDB(attempt = 0): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (ev) => {
      const db = req.result;
      // 从 STORE_DEFS 派生建表：`if(!contains)` 幂等，只补缺的、不动已有数据。新增 store 改 STORE_DEFS 即可。
      for (const def of STORE_DEFS) {
        if (db.objectStoreNames.contains(def.name)) continue;
        const os = db.createObjectStore(def.name, { keyPath: def.keyPath });
        for (const idx of def.indexes ?? []) os.createIndex(idx.name, idx.keyPath, { unique: idx.unique ?? false });
      }
      // 老库回填本机清空位点（只对「v1~v5 升上来」的库跑一次；全新库没有游标行，无事可做）。
      if (ev.oldVersion > 0 && ev.oldVersion < 6 && req.transaction) backfillClearedFloors(req.transaction);
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

/**
 * 升级事务里给每条既有游标行回填 `clearedUpTo`：游标以内最小的本地消息 seq − 1，一条没有则 = 游标。
 * 只读消息键（`openKeyCursor`，conv_seq 就在主键里），不把正文读进内存。
 */
function backfillClearedFloors(tx: IDBTransaction): void {
  if (!tx.objectStoreNames.contains(CURSOR_STORE) || !tx.objectStoreNames.contains(STORE)) return;
  const cursors = tx.objectStore(CURSOR_STORE);
  const byConv = tx.objectStore(STORE).index("ownerConv");
  const walk = cursors.openCursor();
  walk.onsuccess = () => {
    const cur = walk.result;
    if (!cur) return;
    const rec = cur.value as SyncCursorRecord;
    if (!(rec.convSeq > 0) || rec.clearedUpTo !== undefined) { cur.continue(); return; }
    let min = 0;
    const keys = byConv.openKeyCursor(IDBKeyRange.only(rec.id));
    keys.onsuccess = () => {
      const k = keys.result;
      if (k) {
        const seq = seqFromRecordKey(String(k.primaryKey));
        if (seq > 0 && seq <= rec.convSeq && (min === 0 || seq < min)) min = seq;
        k.continue();
        return;
      }
      cur.update({ ...rec, clearedUpTo: backfillClearedUpTo(rec.convSeq, min) } satisfies SyncCursorRecord);
      cur.continue();
    };
  };
}

/** 在给定事务里单调推进游标（只增不减）。调用方负责把 CURSOR_STORE 放进事务的 store 列表。 */
export function advanceCursorInStore(store: IDBObjectStore, owner: string, convId: string, convSeq: number): void {
  if (convSeq <= 0) return;
  const id = cursorKeyOf(owner, convId);
  const req = store.get(id);
  req.onsuccess = () => {
    const prev = req.result as SyncCursorRecord | undefined;
    // `...prev`：游标行还带着 clearedUpTo，推游标不许把它抹掉（契约「游标/区间的后续写入不重置位点」）。
    if (convSeq > (Number(prev?.convSeq) || 0)) store.put({ ...prev, id, owner, convId, convSeq } satisfies SyncCursorRecord);
  };
}

/** 读本机清空位点（无记录 = 0）。 */
export async function loadClearedUpTo(owner: string, convId: string): Promise<number> {
  if (!owner || !convId) return 0;
  try {
    const db = await openDB();
    return await new Promise<number>((resolve, reject) => {
      const tx = db.transaction(CURSOR_STORE, "readonly");
      const req = tx.objectStore(CURSOR_STORE).get(cursorKeyOf(owner, convId));
      req.onsuccess = () => resolve(Math.max(0, Number((req.result as SyncCursorRecord | undefined)?.clearedUpTo) || 0));
      req.onerror = () => reject(req.error);
    });
  } catch (error) {
    logger.warn(LOG_TAG.store, "cleared_floor_read_failed", { conv_id: convId, error });
    return 0;
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
