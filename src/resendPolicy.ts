// 发送失败消息的重发路径（与 iOS `IMResendPolicyForMessage` 同一套口径，见 IMChatMessageLogic.h）。
// 红❗可不可点、点了走哪条路，全端唯一判据；别在组件里各判各的。
import type { ChatMessage } from "./sdk/protocol";

export type ResendPolicy =
  /** 不可重发：非本人 / 非失败态 / 已拿到 conv_seq / 被服务端明确拒收。 */
  | "none"
  /** 上传失败：服务器上根本没有这条 → 用留存的 File 重传，换新 localId 不会重复。 */
  | "retry-upload"
  /** send_msg 失败（ack 超时/断线）：内容已就绪 → 按**原 clientMsgId** 重发，靠服务端幂等去重。 */
  | "same-id";

/**
 * 判定一条消息的重发路径。mine = 是否本人发送。
 *
 * - **被拒收判据用 `note` 而不是 `noteCode`**：noteCode 瞬态、不落 IndexedDB，刷新后归 0，
 *   按码判会让"重发必然再次被拒"的消息重新变成可点（与 iOS 同款取舍）。
 * - **上传失败的判据是 content**：乐观气泡的 content 是 `blob:`（图片/视频）或空串（文件、
 *   还没上传完就没有 URL），此时 clientMsgId 只是本地 `outbox-` 占位、从没发给过服务端。
 *   对齐 iOS 的 `im-pending://` / 空 content 两种。
 */
export function resendPolicyFor(m: ChatMessage | null | undefined, mine: boolean): ResendPolicy {
  if (!m || !mine) return "none";
  if (m.status !== "failed") return "none";
  if (m.convSeq > 0) return "none"; // 服务端已收下：再发就是重复
  if (m.note) return "none";        // 拉黑/禁言/非好友/内容过大：原样重发必再被拒，恢复入口是下方系统行
  if (!m.content || m.content.startsWith("blob:")) return "retry-upload";
  return "same-id";
}
