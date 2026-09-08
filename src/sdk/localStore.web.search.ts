// `LocalStore` 的 web 实现之二：扫本地消息库找命中（首页「聊天记录」那一栏 + 会话内检索）。
//
// 单独一个文件（CODING_STYLE §7 体量门禁）：它是**只读扫描**，不参与任何落库事务，
// 与消息写入路径没有共享状态——放一起只是让那个文件更胖。
//
// **命中判据是跨端契约**（后端 G4 / iOS / SQLite 实现必须一致），定义与「为什么不上 FTS5」
// 见 localStore.types.ts 的 `searchMessages`。

import { searchableFields, type MsgRecord, type SearchOptions } from "./localStore.types";
import { openDB, STORE, DELETIONS_STORE } from "./localStore.web.db";
import { LOG_TAG, logger } from "../logging/logger";

/**
 * 命中判定（与后端 G4 / iOS 口径对齐）：**text 消息的 `content`** 或任意消息的 `caption` 大小写不敏感子串。
 * 媒体/文件消息的 content 是 URL（含服务端生成的文件名片段），**不参与命中**——否则搜索词撞上 URL 片段
 * 会命中「看不见文字」的消息（文件名命中是 P2，做也应按 fileName 字段而非 URL）。
 * 撤回消息（`recalledAt`）不参与命中；删除/自删走墓碑在外层过滤。needle 须已 `toLowerCase`。
 */
function matchesQuery(rec: MsgRecord, needle: string): boolean {
  if (rec.recalledAt) return false; // 撤回消息不参与命中（**状态**判断，不在 searchableFields 里）
  // 「哪几段文本参与」的规则是两侧共用的一份（localStore.types.ts），不在这里重写——
  // SQLite 实现拿同一个函数算落库时的检索列，规则就不可能分叉。
  const f = searchableFields(rec);
  return f.content.toLowerCase().includes(needle)
    || f.caption.toLowerCase().includes(needle)
    || f.fileName.toLowerCase().includes(needle);
}

/**
 * 本地消息搜索（纯本地，SEARCH_DESIGN §7.2）。
 * - **会话内**（`opts.convId`）：走 `ownerConv` 索引 `getAll` 后内存过滤（零新索引）。
 * - **全局**（无 `convId`）：游标遍历整个 `messages` store（仅 `ownerConv` 索引、无内容索引），命中即收。
 *
 * 命中 = `content`/`caption` 大小写不敏感子串（`matchesQuery`）；排除撤回（`recalledAt`）与本地删除墓碑。
 * 结果**按时间倒序**（新→旧，tiebreak `convSeq` 倒序），上限 `limit`。失败记日志并返回空——搜索是增强，绝不抛。
 */
export async function searchMessages(owner: string, opts: SearchOptions): Promise<MsgRecord[]> {
  const needle = (opts.q ?? "").trim().toLowerCase();
  if (!owner || !needle || !opts.limit || opts.limit <= 0) return [];
  try {
    const db = await openDB();
    // 陈旧连接可能缺 deletions store（升级被别标签页阻塞时）——此时不过滤墓碑，也不让事务抛 NotFoundError。
    const hasDeletions = db.objectStoreNames.contains(DELETIONS_STORE);
    const stores = hasDeletions ? [STORE, DELETIONS_STORE] : [STORE];
    return await new Promise<MsgRecord[]>((resolve, reject) => {
      const tx = db.transaction(stores, "readonly");
      const msgStore = tx.objectStore(STORE);
      const deleted = new Set<string>();
      const collected: MsgRecord[] = [];
      if (hasDeletions) {
        const delStore = tx.objectStore(DELETIONS_STORE);
        // 会话内只取本会话墓碑；全局取全部键。
        const delReq = opts.convId
          ? delStore.index("ownerConv").getAllKeys(`${owner}|${opts.convId}`)
          : delStore.getAllKeys();
        delReq.onsuccess = () => {
          for (const k of (delReq.result as IDBValidKey[]) ?? []) deleted.add(String(k));
        };
      }
      if (opts.convId) {
        const req = msgStore.index("ownerConv").getAll(`${owner}|${opts.convId}`);
        req.onsuccess = () => {
          for (const rec of (req.result as MsgRecord[]) ?? []) {
            if (rec.owner === owner && matchesQuery(rec, needle)) collected.push(rec);
          }
        };
      } else {
        const cursorReq = msgStore.openCursor();
        cursorReq.onsuccess = () => {
          const cursor = cursorReq.result;
          if (!cursor) return;
          const rec = cursor.value as MsgRecord;
          if (rec.owner === owner && matchesQuery(rec, needle)) collected.push(rec);
          cursor.continue();
        };
      }
      tx.oncomplete = () => {
        const hits = collected
          .filter((r) => !deleted.has(r.id))
          // 第三级 `id` 升序是**必需的**，不是锦上添花：前两级打平时（被拒消息 conv_seq 恒为 0、
          // 同批落库的时间戳也可能一样），没有最终键就只剩"稳定排序 + 存储顺序"这条**隐式**性质，
          // 而 SQLite 那侧没有对应物 → 同一个搜索词加 limit 会在两端截出不同的消息。写明它。
          .sort((a, b) => (b.timestamp - a.timestamp) || (b.convSeq - a.convSeq) || a.id.localeCompare(b.id))
          .slice(0, opts.limit);
        resolve(hits);
      };
      tx.onerror = () => reject(tx.error);
    });
  } catch (error) {
    logger.warn(LOG_TAG.store, "message_search_failed", { conv_id: opts.convId, error });
    return [];
  }
}
