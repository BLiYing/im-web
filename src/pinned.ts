// 置顶消息横幅的纯逻辑（G0）：预览文案 + 多条置顶的轮转索引。
// 与 iOS `IMPinnedBanner` 的对应实现保持一致（parity），逻辑集中在此以便单测。
import type { PinnedMessage } from "./sdk/protocol";
import { CONTACT_CONTENT_TYPE, contactCardPreview } from "./contactCard";
import { chatRecordSnippet } from "./messageContent";

/** 横幅/列表里一条置顶消息的单行预览文案。
 *  非文本消息没有可读 content（是 URL），直接显类型词——横幅只有一行高，塞 URL 既难读又会撑破。 */
export function pinnedPreview(p: Pick<PinnedMessage, "contentType" | "content" | "caption">): string {
  // 图说「有字显字」：媒体/文件带 caption 时置顶横幅显 caption 文字，否则回退 [图片]/[视频]/[文件]。
  if (p.caption && (p.contentType === "image" || p.contentType === "video" || p.contentType === "file")) {
    return oneLine(p.caption);
  }
  switch (p.contentType) {
    case "text":
      return oneLine(p.content) || "（空消息）";
    case "image":
      return "[图片]";
    case "video":
      return "[视频]";
    // voice = 录制的语音条（正式类型）；audio 是 voice 落地前的旧命名，两者都要认——
    // 只认 audio 时置顶横幅/置顶列表会把语音的 content（一串 URL）原样铺出来。
    case "audio":
    case "voice":
      return "[语音]";
    case "file":
      return "[文件]";
    case CONTACT_CONTENT_TYPE:
      return contactCardPreview(p.content);
    // 合并转发卡片：content 是整段 JSON，直接显会把 {"t":…,"items":[…]} 铺满横幅 → 收成「[聊天记录] 标题」。
    case "chat_record":
      return chatRecordSnippet(p.content);
    default:
      return oneLine(p.content) || `[${p.contentType}]`;
  }
}

/** 折行/连续空白压成单行——横幅是单行省略号布局，换行会把它撑高。 */
function oneLine(s: string): string {
  return (s ?? "").replace(/\s+/g, " ").trim();
}

/** 横幅上的发送者显示名：群聊优先服务端下发的群内昵称，回退 uid；单聊不显示发送者。 */
export function pinnedSenderLabel(p: Pick<PinnedMessage, "from" | "fromNickname">, isGroup: boolean): string {
  if (!isGroup) return "";
  return p.fromNickname || p.from;
}

/** 点横幅后的下一个索引（Telegram 式轮转：到末尾回到第一条）。
 *  列表为空时恒为 0，避免出现 NaN/-1 让渲染取到 undefined。 */
export function nextPinnedIndex(current: number, total: number): number {
  if (total <= 0) return 0;
  return (current + 1) % total;
}

/** 把索引夹到合法范围内。置顶被别人取消后列表会变短，旧索引可能越界（横幅空白）。 */
export function clampPinnedIndex(current: number, total: number): number {
  if (total <= 0) return 0;
  if (current < 0) return 0;
  return current >= total ? 0 : current;
}
