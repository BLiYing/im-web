// 置顶消息横幅的纯逻辑（G0）：预览文案 + 多条置顶的轮转索引。
// 与 iOS `IMPinnedBanner` 的对应实现保持一致（parity），逻辑集中在此以便单测。
import type { PinnedMessage } from "./sdk/protocol";
import { CALL_CONTENT_TYPE } from "./callRecord";
import { CONTACT_CONTENT_TYPE, contactCardPreview } from "./contactCard";
import { chatRecordSnippet } from "./messageContent";
import { t as i18nT, type Args } from "./i18n";

/** 横幅/列表里一条置顶消息的单行预览文案。
 *  非文本消息没有可读 content（是 URL），直接显类型词——横幅只有一行高，塞 URL 既难读又会撑破。
 *  2026-09-22 P3 修复：此前硬编码中文，不跟 App 语言。`translate` 默认模块级 `t()`；
 *  组件内传 `useT()` 的 `tr` 以便切语言即时重渲染。 */
export function pinnedPreview(
  p: Pick<PinnedMessage, "contentType" | "content" | "caption">,
  translate: (key: string, args?: Args) => string = i18nT,
): string {
  // 图说「有字显字」：媒体/文件带 caption 时置顶横幅显 caption 文字，否则回退 [图片]/[视频]/[文件]。
  if (p.caption && (p.contentType === "image" || p.contentType === "video" || p.contentType === "file")) {
    return oneLine(p.caption);
  }
  switch (p.contentType) {
    case "text":
      return oneLine(p.content) || translate("preview.empty_message");
    case "image":
      return translate("preview.image");
    case "video":
      return translate("preview.video");
    // voice = 录制的语音条（正式类型）；audio 是 voice 落地前的旧命名，两者都要认——
    // 只认 audio 时置顶横幅/置顶列表会把语音的 content（一串 URL）原样铺出来。
    case "audio":
    case "voice":
      return translate("preview.voice");
    case "file":
      return translate("preview.file");
    case CONTACT_CONTENT_TYPE:
      return contactCardPreview(p.content, translate);
    case CALL_CONTENT_TYPE:
      return translate("quote.snapshot.call");
    // 合并转发卡片：content 是整段 JSON，直接显会把 {"t":…,"items":[…]} 铺满横幅 → 收成「[聊天记录] 标题」。
    case "chat_record":
      return chatRecordSnippet(p.content, translate);
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
