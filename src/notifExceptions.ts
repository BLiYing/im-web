// 「添加例外」选择页过滤（NOTIFICATIONS_P1_DESIGN.md §2）：纯函数，无 React/DOM 依赖。
// 只列还没有免打扰的会话；系统通知会话（777000）的排除已经统一收在 ForwardPicker 内部
// （转发消息 / 收藏转发 / 推荐名片 / 添加例外四个入口共用同一条），这里不重复过滤。
//
// 批次一没有 `mute_until`（定时免打扰是第二批），直接读 `muted`——第二批接入 `isMutedNow` 后，
// 这里要跟着从 `!c.muted` 换成 `!isMutedNow(c.muted, c.mute_until, Date.now())`（§4.3 清单已登记）。
import type { Conversation } from "./sdk/protocol";

export function isExceptionPickable(c: Conversation): boolean {
  return !c.muted;
}
