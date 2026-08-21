// 消息内容纯函数：快照本地化、引用预览、聊天记录解析、文件名/URL 处理、媒体定框等。
// 从 App.tsx 抽出（无 JSX、无 React 状态），单测见 chatRecord.test.ts。
import type { CSSProperties } from "react";
import type { ChatMessage } from "./sdk/protocol";
import { mediaDisplaySize } from "./media";

/** 整条内容就是一个 http(s) 链接 → 按链接样式渲染（URL 消息 v1，与 iOS IMLooksLikeURL 对齐）。 */
export const isUrlText = (s: string) => /^https?:\/\/\S+$/.test(s);

/** 合并转发卡片的引用快照：`[聊天记录] 标题`。兼容存量截断快照（旧引用把 JSON 截 60 字入库，
 *  解析不出时正则抠 "t":"…" 标题）；全失败回落 `[聊天记录]`。与 iOS IMChatRecordSnippet 同语义。 */
export function chatRecordSnippet(json: string): string {
  let title = "";
  try {
    const o = JSON.parse(json);
    if (o && typeof o.t === "string") title = o.t;
  } catch {
    title = /"t":"([^"]*)"/.exec(json)?.[1] ?? "";
  }
  return title ? `[聊天记录] ${title}` : "[聊天记录]";
}
export const looksLikeChatRecordJSON = (s: string) => s.startsWith("{") && (s.includes('"items"') || s.includes('"t":'));

/** 服务端冻结的英文媒体快照（[image]/[video]/[file]）本地化为中文（与 iOS IMLocalizeSnippet 对齐）。 */
export const localizeSnippet = (s: string) =>
  s === "[image]" ? "[图片]" : s === "[video]" ? "[视频]"
  : s === "[file]" ? "[文件]" : s.startsWith("[file] ") ? "[文件] " + s.slice(7) // 文件带原名（M4-x）
  : s === "[chat_record]" ? "[聊天记录]" // 旧服务端 token（无标题）兜底
  // 存量救援：旧版引用聊天记录卡片时把整段 JSON 存进快照 → 就地救成「[聊天记录] 标题」。
  : looksLikeChatRecordJSON(s) ? chatRecordSnippet(s) : s;

/** 引用某条消息时的本端快照预览：媒体 → [图片]/[视频]/[文件]，文本截 60 字。 */
export const replyPreviewOf = (m: ChatMessage): string =>
  // 图说 caption「有字显字」：图文/视频文/文件文带 caption 时引用条显 caption 文字（与服务端冻结快照同口径）。
  m.caption && (m.contentType === "image" || m.contentType === "video" || m.contentType === "file") ? m.caption.slice(0, 60)
  : m.contentType === "image" ? "[图片]" : m.contentType === "video" ? "[视频]"
  : m.contentType === "file" ? ("[文件] " + (m.fileName || fileNameFromContent(m.content))).trimEnd()
  : m.contentType === "chat_record" ? chatRecordSnippet(m.content) : (m.content || "").slice(0, 60);

/** 多选态该消息是否可勾选：系统提示/撤回墓碑/发送中·失败的本地件（无服务端内容，转出去是空的）不可选。
 *  与 iOS isSelectableMessage: 同语义。 */
export const selectableInMultiSelect = (m: ChatMessage): boolean =>
  m.convSeq > 0 && !m.recalledAt && m.contentType !== "system";

/** 消息列表里的最小 conv_seq（发送中的 0 不计；空列表返回 0）。供定位/搜索「最早」翻页判据用。 */
export function minSeqOf(messages: ChatMessage[]): number {
  let m = 0;
  for (const x of messages) if (x.convSeq > 0 && (m === 0 || x.convSeq < m)) m = x.convSeq;
  return m;
}

/** 合并转发「聊天记录」结构（与 iOS chat_record 一致）：t=标题,
 *  items=[{n发送者, ct类型, c内容/URL, 文件另带 fn文件名/fs字节数}]。老记录无 fn 时从 URL 反推原名兜底。 */
export type RecordItem = { n: string; ct: string; c: string; fn?: string; fs?: number; cap?: string };
export type ChatRecord = { t: string; items: RecordItem[] };
export function parseChatRecord(content: string): ChatRecord {
  try {
    const o = JSON.parse(content);
    if (o && typeof o === "object") return { t: typeof o.t === "string" ? o.t : "聊天记录", items: Array.isArray(o.items) ? o.items : [] };
  } catch { /* 非法 JSON */ }
  return { t: "聊天记录", items: [] };
}
export const recordItemPreview = (it: RecordItem): string => {
  // 图说合并转发「有字显字」：媒体/文件条目带 cap（caption）时优先显文字，否则回退 [图片]/[视频]/[文件名]。
  if (it.cap && (it.ct === "image" || it.ct === "video" || it.ct === "file")) return it.cap.slice(0, 60);
  if (it.ct === "image") return "[图片]";
  if (it.ct === "video") return "[视频]";
  if (it.ct === "file") return `[文件] ${it.fn || fileNameFromContent(it.c)}`.trimEnd();
  // 嵌套合并转发：预览显「[聊天记录] 子标题」，不铺子卡片 JSON 原文（套娃卡片）；
  // 子 JSON 非法时 parseChatRecord 回落标题「聊天记录」，此时不再叠加以免「[聊天记录] 聊天记录」。
  if (it.ct === "chat_record") {
    const t = parseChatRecord(it.c).t;
    return t && t !== "聊天记录" ? `[聊天记录] ${t}` : "[聊天记录]";
  }
  return it.c;
};

/** 从文件消息 URL 取原始显示名：存储名 <随机>__<原名>.<ext> → 取 "__" 之后并解码（与后端/iOS 对齐）。 */
export function fileNameFromContent(content: string): string {
  const last = (content.split("/").pop() || content).split(/[?#]/, 1)[0];
  let decoded = last;
  try { decoded = decodeURIComponent(last); } catch { /* 保留原串 */ }
  const i = decoded.indexOf("__");
  return i >= 0 && i + 2 < decoded.length ? decoded.slice(i + 2) : decoded;
}

/** 把图片写入系统剪贴板（浏览器剪贴板图片仅稳定支持 image/png → 用 canvas 转 PNG）。失败抛错由调用方回退复制链接。 */
export async function copyImageToClipboard(url: string): Promise<void> {
  const blob = await (await fetch(url)).blob();
  const bmp = await createImageBitmap(blob);
  const canvas = document.createElement("canvas");
  canvas.width = bmp.width; canvas.height = bmp.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("no 2d context");
  ctx.drawImage(bmp, 0, 0);
  const png: Blob = await new Promise((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error("toBlob failed"))), "image/png"));
  await navigator.clipboard.write([new ClipboardItem({ "image/png": png })]);
}

/**
 * 媒体气泡定框：拿到协议下发的原始像素时按比例算出 CSS 尺寸（与 iOS 同算法）；
 * **尺寸未知**（老消息 / 老客户端 / 转发件）则不锁死方框，交给 `.auto` 让图片按自身比例显示，
 * 否则 object-fit:cover 会把老图永久裁成正方形（Web 没有 iOS 那样的加载后重排）。
 */
export function mediaBoxProps(m: ChatMessage): { className: string; style?: CSSProperties } {
  if (!m.mediaW || !m.mediaH) return { className: "msg-media auto" };
  const box = mediaDisplaySize(m.mediaW, m.mediaH);
  return { className: "msg-media", style: { width: `${box.width}px`, height: `${box.height}px` } };
}

/** 就绪文件点击时能否在浏览器内直接预览（对齐 iOS QuickLook 的 Web 诚实映射）。其余类型 → 另存。 */
const PREVIEWABLE_FILE = /\.(pdf|png|jpe?g|gif|webp|bmp|svg|mp4|mov|webm|m4v|mp3|wav|m4a|ogg|aac|txt|md|log|json|csv|xml)$/i;
export function isPreviewableFile(name: string): boolean { return PREVIEWABLE_FILE.test(name); }

/** 视频回退 <video> 的 src：非 blob 时追加 #t=0.1，促使浏览器画出首帧（无 poster 封面时的兜底）。 */
export function videoFrameSrc(url: string): string {
  return url && !url.startsWith("blob:") ? url + "#t=0.1" : url;
}

/**
 * 合成一条「只为进查看器」的临时 ChatMessage（收藏 / 合并转发记录里点图/视频时用）：
 * 无真实会话上下文（convId/convSeq/timestamp 全 0），仅带查看器需要的 content + 类型。
 * clientMsgId 作查看器内的稳定身份（收藏用 `fav-<id>`、记录用 `rec-<i>`），供 msgKey 复位视频态。
 */
export function syntheticViewerMessage(clientMsgId: string, content: string, kind: "image" | "video"): ChatMessage {
  return { clientMsgId, convId: "", from: "", content, contentType: kind, convSeq: 0, timestamp: 0, status: "sent" };
}
