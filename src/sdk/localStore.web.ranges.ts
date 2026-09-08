// `LocalStore` 的 web 实现之三：「本地有哪几段」目录（`conv_ranges` store）的读写
// （OFFLINE_BACKLOG_DESIGN §4.2）。语义契约见 localStore.types.ts。
//
// 单独一个文件（CODING_STYLE §7 体量门禁）：它是**独立的一张表**，与消息表/游标表
// 只在 `saveIncomingPage` 的那一个事务里相遇——那一处留在 localStore.web.ts，因为整页原子性
// 要求三者同事务，拆开反而会把"要么都成、要么都不动"这条正确性底线拆没。
// 区间代数本身在 sdk/ranges.ts，本文件只管持久化。
// 只 import 地基（localStore.web.db.ts），不反向 import 装配点，故无循环依赖。

import { cursorKeyOf, type RangesSnapshot } from "./localStore.types";
import { openDB, RANGES_STORE, loadSyncCursor, type RangesRecord } from "./localStore.web.db";
import { addRange, normalizeRanges, type SeqRange } from "./ranges";
import { LOG_TAG, logger } from "../logging/logger";

/**
 * 读「本地有哪几段」目录（OFFLINE_BACKLOG_DESIGN §4.2）。
 *
 * **老库兼容**：没有 ranges 行时用连续游标反推出首段 `[1, cursor]`——升级前本地是"从头连续拉到
 * 游标处"，那正好就是一段。不这么做的话，所有老用户升级后会被判成"整个会话都有缺口"，
 * 于是本地搜索一夜之间全部改走服务端，离线时集体降级。
 */
export async function loadRanges(owner: string, convId: string): Promise<RangesSnapshot> {
  if (!owner || !convId) return { ranges: [], head: 0 };
  try {
    const db = await openDB();
    const rec = await new Promise<RangesRecord | undefined>((resolve, reject) => {
      const tx = db.transaction(RANGES_STORE, "readonly");
      const req = tx.objectStore(RANGES_STORE).get(cursorKeyOf(owner, convId));
      req.onsuccess = () => resolve(req.result as RangesRecord | undefined);
      req.onerror = () => reject(req.error);
    });
    if (rec) {
      return { ranges: normalizeRanges(rec.ranges ?? []), head: Math.max(0, Number(rec.head) || 0) };
    }
    const cursor = await loadSyncCursor(owner, convId);
    return { ranges: cursor > 0 ? [{ lo: 1, hi: cursor }] : [], head: 0 };
  } catch (error) {
    logger.warn(LOG_TAG.store, "ranges_read_failed", { conv_id: convId, error });
    return { ranges: [], head: 0 };
  }
}

/**
 * 登记一段"这段我已齐全"，并可顺带更新 head 快照。返回归一化后的新清单。
 *
 * **调用契约（对应 §4.2 不变量 I1）**：只在这一段的消息**全部落库成功之后**才调用。
 * 区间断言的是"这段我齐全"——提前登记等于宣称拿到了其实没拿到的消息，
 * 上层据此跳过补拉，那一段就永久漏了。这与 synced_conv_seq 的老约束是同一条，只是推广到了区间。
 */
export async function registerRange(
  owner: string, convId: string, lo: number, hi: number, head?: number,
): Promise<SeqRange[]> {
  if (!owner || !convId) return [];
  try {
    const db = await openDB();
    return await new Promise<SeqRange[]>((resolve, reject) => {
      const tx = db.transaction(RANGES_STORE, "readwrite");
      const store = tx.objectStore(RANGES_STORE);
      const id = cursorKeyOf(owner, convId);
      const getReq = store.get(id);
      let merged: SeqRange[] = [];
      getReq.onsuccess = () => {
        const prev = getReq.result as RangesRecord | undefined;
        merged = hi >= lo ? addRange(prev?.ranges ?? [], lo, hi) : normalizeRanges(prev?.ranges ?? []);
        const nextHead = Math.max(Number(prev?.head) || 0, Number(head) || 0);
        store.put({ id, owner, convId, ranges: merged, head: nextHead } satisfies RangesRecord);
      };
      getReq.onerror = () => reject(getReq.error);
      tx.oncomplete = () => resolve(merged);
      tx.onerror = () => reject(tx.error);
    });
  } catch (error) {
    logger.warn(LOG_TAG.store, "ranges_write_failed", { conv_id: convId, lo, hi, error });
    return [];
  }
}

/**
 * 只更新 head 快照（收到 too_long / conv_bump 时用：知道了服务端最新位点，但一条正文都没拿到）。
 * **绝不动 ranges**——那正是"没下载就不许登记"的体现。
 */
export async function updateRangesHead(owner: string, convId: string, head: number): Promise<void> {
  if (!owner || !convId || head <= 0) return;
  try {
    const db = await openDB();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(RANGES_STORE, "readwrite");
      const store = tx.objectStore(RANGES_STORE);
      const id = cursorKeyOf(owner, convId);
      const getReq = store.get(id);
      getReq.onsuccess = () => {
        const prev = getReq.result as RangesRecord | undefined;
        store.put({
          id, owner, convId,
          ranges: normalizeRanges(prev?.ranges ?? []),
          head: Math.max(Number(prev?.head) || 0, head),
        } satisfies RangesRecord);
      };
      getReq.onerror = () => reject(getReq.error);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch (error) {
    logger.warn(LOG_TAG.store, "ranges_head_write_failed", { conv_id: convId, head, error });
  }
}
