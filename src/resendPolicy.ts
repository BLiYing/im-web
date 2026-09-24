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
 * 判定一条消息的重发路径。mine = 是否本人发送。与 iOS `IMResendPolicyForMessage` 同一套三段顺序，
 * **顺序本身就是判据的一部分，别只看每条规则单独对不对**：
 *
 * 1. **本地还留着字节的（`blob:` 占位）先判重传，必须排在 note 判断之前**：content 是 `blob:`
 *    说明服务器上根本没有这条，任何"被服务端拒收"的解释都不成立。
 *    反例（与 iOS 同一处易错点，2026-08-30 code-review 在那边抓到过）：语音上传失败会无条件写一句
 *    note（"语音上传失败"之类，见 useVoiceSend），若先判 note 会把它误判成"拒收→不可重发"，
 *    红❗照显却点不动。
 * 2. **被拒收判据用 `note` 而不是 `noteCode`**：noteCode 瞬态、不落 IndexedDB，刷新后归 0，
 *    按码判会让"重发必然再次被拒"的消息重新变成可点（与 iOS 同款取舍）。
 * 3. **content 为空且无 note**：还没来得及生成本地占位就失败（如文件排队中）——没有字节可留，
 *    仍按新 clientMsgId 重传。content 为空**但带 note**（第 2 步已拦）意味着连本地字节都没有，
 *    不是"服务器没见过"，是"压根没东西"，不给入口（与 iOS 对称，目前 Web 侧无实际产生此组合的路径，
 *    留着防将来某条失败路径手滑同时设了 note 又留了空 content）。
 */
export function resendPolicyFor(m: ChatMessage | null | undefined, mine: boolean): ResendPolicy {
  if (!m || !mine) return "none";
  if (m.status !== "failed") return "none";
  if (m.convSeq > 0) return "none"; // 服务端已收下：再发就是重复
  if (m.content && m.content.startsWith("blob:")) return "retry-upload";
  if (m.note) return "none";        // 拉黑/禁言/非好友/内容过大：原样重发必再被拒，恢复入口是下方系统行
  if (!m.content) return "retry-upload";
  return "same-id";
}
