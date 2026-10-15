// 置顶消息横幅 / 置顶面板的纯逻辑（G0）：预览文案、横幅显哪条、面板气泡兜底、长按菜单允许项。
// 与 iOS `IMPinnedBanner` 的对应实现保持一致（parity），逻辑集中在此以便单测。
import type { ChatMessage, PinnedMessage } from "./sdk/protocol";
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

/** 横幅恒显的那条 = **最新置顶**（pinned_at 最大；并列取靠前者）。服务端本就按 pinned_at 倒序，这里不依赖它。
 *  2026-10-15 置顶面板 v3：横幅不再轮转（删 nextPinnedIndex/clampPinnedIndex），点横幅改为打开面板。 */
export function latestPinned(list: readonly PinnedMessage[]): PinnedMessage | undefined {
  let best: PinnedMessage | undefined;
  for (const p of list) if (!best || p.pinnedAt > best.pinnedAt) best = p;
  return best;
}

/** 置顶面板里一条要画成什么气泡（PINNED_PANEL_DESIGN §4.0 兜底顺序）：
 *  ① 本地已有该 conv_seq（聊天窗口里加载过，且未撤回）→ 本地行；② 接口附带的完整消息对象；
 *  ③ 都没有（旧服务端）→ 「类型词」单行纯文本气泡（仅兜底，不是设计目标）。 */
export function pinnedBubbleMessage(
  pm: PinnedMessage, local: readonly ChatMessage[] | undefined, convId: string,
  translate: (key: string, args?: Args) => string = i18nT,
): ChatMessage {
  const hit = local?.find((m) => m.convSeq === pm.convSeq && !m.recalledAt);
  if (hit) return hit;
  if (pm.message) return pm.message;
  return {
    serverMsgId: pm.serverMsgId, convId, from: pm.from, fromNickname: pm.fromNickname,
    content: pinnedPreview(pm, translate), contentType: "text", convSeq: pm.convSeq, timestamp: pm.timestamp, status: "received",
  };
}

/** 置顶面板长按菜单的允许项（DESIGN §2.3，按此顺序）：取消置顶（仅有权限）/ 复制（仅文本）/ 定位到消息。转发排期再加。 */
export type PinnedMenuId = "unpin" | "copy" | "locate";
export function pinnedMenuIds(m: Pick<ChatMessage, "contentType" | "content">, canPin: boolean): PinnedMenuId[] {
  const ids: PinnedMenuId[] = [];
  if (canPin) ids.push("unpin");
  if (m.contentType === "text" && !!m.content) ids.push("copy");
  ids.push("locate");
  return ids;
}
