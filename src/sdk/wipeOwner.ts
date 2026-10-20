// 注销账号后清空本机该账号的聊天缓存（DELETE_ACCOUNT_DESIGN §3.4：与退出登录不同，注销不保留本机记录）。
// 范围：消息/游标/墓碑/区间（`LocalStore.wipeOwner`，web=IndexedDB，桌面=SQLite 桥）、会话列表缓存、已下载文件的
// Cache Storage、以及 localStorage 里按该 uid 命名的键（`im.<名>.<uid>[.<conv>]`：opt-in / 已下载 / 失效 / 文件夹 / 语音已播）。别的账号不动。
import { wipeOwner } from "./localStore";
import { cacheClear } from "../mediaCache";
import { loadSession } from "../session";

const SETTLE_MS = 1500; // 断连前已在途的写（落库/会话列表缓存）可能晚于首次清库落地，隔一会再扫一遍

function wipeLocalStorageKeys(owner: string): void {
  try {
    localStorage.removeItem(`im-web:convs:${owner}`);
    const dot = `.${owner}`;
    const keys = Array.from({ length: localStorage.length }, (_, i) => localStorage.key(i) ?? "");
    for (const k of keys) {
      if (k.startsWith("im.") && (k.endsWith(dot) || k.includes(`${dot}.`))) localStorage.removeItem(k);
    }
  } catch { /* 隐私模式等：忽略 */ }
}

async function wipeOnce(owner: string): Promise<void> {
  wipeLocalStorageKeys(owner);
  await Promise.all([wipeOwner(owner), cacheClear(owner)]); // 各自失败只记日志、不抛：最坏=缓存仍在本机，不阻塞注销流程
}

export async function wipeOwnerLocalData(owner: string): Promise<void> {
  if (!owner) return;
  await wipeOnce(owner);
  // 补扫时若同一 uid 已重新登录（恢复账号后立刻再入场），别把它刚写的新缓存清掉。
  setTimeout(() => { if (loadSession()?.uid !== owner) void wipeOnce(owner); }, SETTLE_MS);
}
