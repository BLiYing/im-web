// 「清除所有对话」HTTP 成功之后的本机动作（CLEAR_ALL_CONVERSATIONS_DESIGN §4）。纯编排、依赖全注入，便于单测。
// 铁律：只在 HTTP 成功后才调用本函数（失败不做半清）；位点取服务端 items[].cleared_at，不自造。
// 顺序：存储批量清除（单事务）→ 会话列表项移除 → 媒体副本 → 桌面通知。标题角标 / 桌面角标 / 会话 Tab 红点
// 都由会话列表派生，列表清空即归 0，无需单独清。随后到达的 conv_update(delete) 回声在 SDK 里幂等（位点已抬高）。
import type { ClearAllResult } from "./sdk/clearAllApi";
import { LOG_TAG, logger } from "./logging/logger";

export interface ClearAllLocalDeps {
  clearAllToFloors: (items: { convId: string; clearedAt: number }[]) => Promise<void>;
  dropConversations: (convIds: ReadonlySet<string>) => void;
  clearMediaCache: () => void;
  clearNotifications: (req: { convId: string; upTo: number }) => void;
}

export async function applyClearAllLocal(res: ClearAllResult, d: ClearAllLocalDeps): Promise<void> {
  if (res.items.length === 0) return;   // 服务端本就没有可清的会话：本机没有任何要动的
  try {
    await d.clearAllToFloors(res.items);
  } catch (error) {
    // 服务端已清；本机存储没清成时，回声帧 / 下次列表快照的 cleared_at 对齐会再补一次（§6.7.1 触发点②③）。
    logger.warn(LOG_TAG.store, "clear_all_local_failed", { count: res.items.length, error });
  }
  d.dropConversations(new Set(res.items.map((i) => i.convId)));
  d.clearMediaCache();
  for (const i of res.items) d.clearNotifications({ convId: i.convId, upTo: i.clearedAt });
}
