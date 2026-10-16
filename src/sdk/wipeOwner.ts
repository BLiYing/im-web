// 注销账号后清空本机该账号的聊天缓存（DELETE_ACCOUNT_DESIGN §3.4：与退出登录不同，注销不保留本机记录）。
// 消息/游标/墓碑/区间走 `LocalStore.wipeOwner`（web=IndexedDB，桌面=SQLite 桥），会话列表缓存在 localStorage；别的账号不动。
import { wipeOwner } from "./localStore";

export async function wipeOwnerLocalData(owner: string): Promise<void> {
  if (!owner) return;
  try { localStorage.removeItem(`im-web:convs:${owner}`); } catch { /* 隐私模式等：忽略 */ }
  await wipeOwner(owner); // 清不掉只记日志、不抛：最坏情况=缓存仍在本机，不阻塞注销流程
}
