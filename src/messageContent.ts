// 消息内容纯函数：快照本地化、引用预览、聊天记录解析、文件名/URL 处理、媒体定框等。
// 从 App.tsx 抽出（无 JSX、无 React 状态），单测见 chatRecord.test.ts。
import type { CSSProperties } from "react";
import type { ChatMessage, Favorite } from "./sdk/protocol";
import { mediaDisplaySize } from "./media";
import { CONTACT_CONTENT_TYPE, contactCardPreview } from "./contactCard";

/** 整条内容就是一个 http(s) 链接 → 按链接样式渲染（URL 消息 v1，与 iOS IMLooksLikeURL 对齐）。 */
export const isUrlText = (s: string) => /^https?:\/\/\S+$/.test(s);

/** 匹配文本里的 http(s) URL。
 *  中部只允许 URL 合法字符（RFC 3986 unreserved + reserved + pct-encoded 的 ASCII 子集，
 *  即 A-Z a-z 0-9 - . _ ~ : / ? # [ ] @ ! $ & ' ( ) * + , ; = %）——遇任何非 URL 字符（空白 /
 *  中文汉字 / 中文标点 / <>"' 等）自然作为边界。末尾再回吐句末标点 .,;:!?)]}"' 避免"看 https://foo.com."
 *  把句号吃进 URL；中文标点无需单列，因为它们已经不在中部合法字符集里。
 *  与 Preview 抓取端契约一致：只识别显式 http(s)，不做裸域猜测（避 example.com 误识 + 后端 SSRF 面）。
 *  修 bug：老正则用 `[^\s<>()"'【...]` 反向排除，中文汉字都通过 → "分身乏术，https://foo.com，好文"
 *  被吸成整段（中文都在中部集合内），preview API 拿到含中文的 URL 直接 404。 */
export const URL_REGEX = /https?:\/\/[-A-Za-z0-9._~:/?#\[\]@!$&'()*+,;=%]+[-A-Za-z0-9_~/#\[\]@!$&'*+=%]/g;

/** 抽出文本里第一个 URL；无 → null。用于文本气泡下方 preview 卡（首个 URL 起卡，其余仅正文高亮）。 */
export function firstURLInText(text: string | undefined | null): string | null {
  if (!text) return null;
  URL_REGEX.lastIndex = 0;
  const m = URL_REGEX.exec(text);
  return m ? m[0] : null;
}

/** 文本切片：{kind:"t",text} 普通段 / {kind:"u",url} URL 段。渲染层按 kind 分支包 <a>。
 *  一段文本混排多个 URL 时全部识别；纯 URL 消息由上游 isUrlText 判定不走此函数。 */
export function splitTextByURL(text: string): Array<{ kind: "t" | "u"; text: string }> {
  const out: Array<{ kind: "t" | "u"; text: string }> = [];
  URL_REGEX.lastIndex = 0;
  let last = 0;
  for (let m = URL_REGEX.exec(text); m; m = URL_REGEX.exec(text)) {
    if (m.index > last) out.push({ kind: "t", text: text.slice(last, m.index) });
    out.push({ kind: "u", text: m[0] });
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push({ kind: "t", text: text.slice(last) });
  return out.length > 0 ? out : [{ kind: "t", text }];
}

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
  : s === "[contact]" ? "[个人名片]"      // 同上：老服务端下发的裸 contact token
  // 存量救援：旧版引用聊天记录卡片时把整段 JSON 存进快照 → 就地救成「[聊天记录] 标题」。
  : looksLikeChatRecordJSON(s) ? chatRecordSnippet(s) : s;

/** 引用某条消息时的本端快照预览：媒体 → [图片]/[视频]/[文件]，文本截 60 字。 */
export const replyPreviewOf = (m: ChatMessage): string =>
  // 图说 caption「有字显字」：图文/视频文/文件文带 caption 时引用条显 caption 文字（与服务端冻结快照同口径）。
  m.caption && (m.contentType === "image" || m.contentType === "video" || m.contentType === "file") ? m.caption.slice(0, 60)
  : m.contentType === "image" ? "[图片]" : m.contentType === "video" ? "[视频]"
  : m.contentType === "file" ? ("[文件] " + (m.fileName || fileNameFromContent(m.content))).trimEnd()
  : m.contentType === "chat_record" ? chatRecordSnippet(m.content)
  : m.contentType === CONTACT_CONTENT_TYPE ? contactCardPreview(m.content)
  : (m.content || "").slice(0, 60);

/** 「可搜索/可选/可定位」的消息：已确认（convSeq>0）、非撤回、非系统提示。搜索命中集、日历活跃日、多选勾选共用此一处谓词。 */
export const isSearchableMessage = (m: Pick<ChatMessage, "convSeq"> & { recalledAt?: number; contentType?: string }): boolean =>
  m.convSeq > 0 && !m.recalledAt && m.contentType !== "system";
/** 多选态该消息是否可勾选：系统提示/撤回墓碑/发送中·失败的本地件（无服务端内容，转出去是空的）不可选。
 *  与 iOS isSelectableMessage: 同语义。 */
export const selectableInMultiSelect = (m: ChatMessage): boolean => isSearchableMessage(m);

/** 消息列表里的最小 conv_seq（发送中的 0 不计；空列表返回 0）。供定位/搜索「最早」翻页判据用。 */
export function minSeqOf(messages: ChatMessage[]): number {
  let m = 0;
  for (const x of messages) if (x.convSeq > 0 && (m === 0 || x.convSeq < m)) m = x.convSeq;
  return m;
}

/** 合并转发「聊天记录」结构（与 iOS chat_record 一致）：t=标题,
 *  items=[{n发送者, ct类型, c内容/URL, 文件另带 fn文件名/fs字节数}]。老记录无 fn 时从 URL 反推原名兜底。 */
/** 合并转发条目。fn/fs=文件原名与字节数；d/w=语音时长(ms)与波形 base64；cap=图说随附文本；
 *  ts=原消息时间(ms)；u=发送者 uid（**只作查头像/判「连续同一人」的键，永不上屏**）；
 *  a=发送者头像相对路径（快照，读端自己拼 host）。
 *  key 与 iOS `mergedForwardJSONForMessages` 逐字对齐——两端读写同一份 JSON。
 *  **老记录一定缺字段**：无 ts 不显时间、无 u/a 头像退化成按名字生成的首字母块，绝不能因此不渲染。 */
export type RecordItem = {
  n: string; ct: string; c: string;
  fn?: string; fs?: number; cap?: string; d?: number; w?: string;
  ts?: number; u?: string; a?: string;
};
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
  if (it.ct === CONTACT_CONTENT_TYPE) return contactCardPreview(it.c);
  // 语音条目：预览显 [语音] m:ss（有 d 才带时长），别把 URL 铺进套娃卡片的两行预览里。
  if (it.ct === "voice" || it.ct === "audio") {
    const sec = Math.max(0, Math.floor((it.d ?? 0) / 1000));
    return it.d ? `[语音] ${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}` : "[语音]";
  }
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

/** 合并转发条目的「发送者身份键」——记录详情据此判「连续同一人」（只显一次头像与昵称）。
 *  优先 `u`（uid，同名不同人才分得开）；老记录没有 `u` 就退回显示名 `n`。
 *  两个前缀（`u:` / `n:`）保证 uid 与昵称不会互相误撞。与 iOS `IMRecordSenderKey` 同口径。 */
export function recordSenderKey(it: Pick<RecordItem, "n" | "u">): string {
  return it.u ? `u:${it.u}` : `n:${it.n ?? ""}`;
}

/** 合并转发记录里的语音条目 → 供 VoiceBubble(mini) 渲染的临时 ChatMessage。
 *  d/w 是打包端随包带的时长与波形；老记录没这两个字段时退化成等高条纹 + 0:00，仍可播。
 *  clientMsgId 带行号：同一条语音在记录里出现多次时，两行不能共用一个播放态。 */
export function recordVoiceMessage(it: RecordItem, index: number): ChatMessage {
  return {
    clientMsgId: `rec-voice-${index}-${it.c}`, convId: "", from: "",
    content: it.c, contentType: "voice", duration: it.d ?? 0, waveform: it.w,
    convSeq: 0, timestamp: 0, status: "sent",
  };
}

// convSeq 置 1（快照非引用，仅为过合并转发的 convSeq>0 守卫）；from=source_from 保留最初作者链。
export function favoriteToMessage(f: Favorite): ChatMessage {
  return {
    clientMsgId: `fav-${f.id}`, convId: f.source_conv_id, from: f.source_from,
    content: f.content, contentType: f.content_type,
    fileName: f.file_name, fileSize: f.file_size, duration: f.duration ?? 0, waveform: f.waveform, thumb: f.thumb, posterUrl: f.poster,
    mediaW: f.media_w, mediaH: f.media_h, caption: f.caption,
    convSeq: 1, timestamp: f.created_at || Date.now(), status: "sent",
  };
}
