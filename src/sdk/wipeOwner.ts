// 注销账号后清空本机该账号的聊天缓存（DELETE_ACCOUNT_DESIGN §3.4：与退出登录不同，注销不保留本机记录）。
// 只清 web 的 IndexedDB 四张表里 `owner|…` 前缀的行 + 会话列表缓存；别的账号的缓存不动。
// 桌面端（SQLite 桥）暂无「按 owner 清库」原语，见 current_task 已知限制。
import { CURSOR_STORE, DELETIONS_STORE, RANGES_STORE, STORE, openDB } from "./localStore.web.db";
import { LOG_TAG, logger } from "../logging/logger";

const ALL_STORES = [STORE, CURSOR_STORE, DELETIONS_STORE, RANGES_STORE];

/** 这个 owner 的全部记录主键范围（主键均为 `owner|…`）。 */
export function ownerKeyRange(owner: string): IDBKeyRange {
  return IDBKeyRange.bound(`${owner}|`, `${owner}|￿`);
}

export async function wipeOwnerLocalData(owner: string): Promise<void> {
  if (!owner) return;
  try { localStorage.removeItem(`im-web:convs:${owner}`); } catch { /* 隐私模式等：忽略 */ }
  try {
    const db = await openDB();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(ALL_STORES, "readwrite");
      for (const name of ALL_STORES) tx.objectStore(name).delete(ownerKeyRange(owner));
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } catch (error) {
    logger.warn(LOG_TAG.store, "wipe_owner_failed", { error }); // 清不掉不阻塞注销流程；最坏情况=缓存仍在本机
  }
}
