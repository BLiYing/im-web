// 「添加例外」选择页过滤（NOTIFICATIONS_P1_DESIGN.md §2/§4.3）：纯函数，无 React/DOM 依赖。
// 只列**还没有免打扰**的会话；系统通知会话（777000）的排除已经统一收在 ForwardPicker 内部
// （转发消息 / 收藏转发 / 推荐名片 / 添加例外四个入口共用同一条），这里不重复过滤。
//
// 第二批接入 mute_until 后走 isMutedNow（NOTIFICATIONS_P1_DESIGN §4.3 清单登记项）：定时免打扰
// 已过期的会话视同「未免打扰」，仍可被选为新的例外（含重新免打扰）。
import type { Conversation } from "./sdk/protocol";
import { isMutedNow } from "./muteState";

export function isExceptionPickable(c: Conversation, nowMs: number = Date.now()): boolean {
  return !isMutedNow(!!c.muted, c.mute_until, nowMs);
}
