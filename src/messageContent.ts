// 消息内容纯函数：快照本地化、引用预览、聊天记录解析、文件名/URL 处理、媒体定框等。
// 从 App.tsx 抽出（无 JSX、无 React 状态），单测见 chatRecord.test.ts。
import type { CSSProperties } from "react";
import type { ChatMessage, Favorite } from "./sdk/protocol";
import { mediaDisplaySize } from "./media";
import { CALL_CONTENT_TYPE } from "./callRecord";
import { CONTACT_CONTENT_TYPE, contactCardPreview } from "./contactCard";
import { t as i18nT, type Args } from "./i18n";

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

/**
 * 服务端冻结的英文媒体快照 token（`[image]`/`[video]`/…）本地化为当前 App 语言（与 iOS
 * IMLocalizeSnippet 对齐）。**真实 bug 修复（P3）**：此前硬编码中文输出，英文界面下引用条
 * 一直显中文——不传 `translate` 时默认用模块级 `t()`（调用时刻的语言，非模块顶层求值）；
 * `MessageList.tsx` 这类组件应传 `useT()` 的 `tr` 以便切语言即时重渲染。
 * `[chat_record]` 的 JSON 整段救援（`looksLikeChatRecordJSON`）仍走 `chatRecordSnippet`——
 * 那是本端 `replyPreviewOf` 共用的老函数、标题本身来自消息内容而非文案表，不在本次范围内。 */
export const localizeSnippet = (s: string, translate: (key: string, args?: Args) => string = i18nT): string =>
  s === "[image]" ? translate("preview.image") : s === "[video]" ? translate("preview.video")
  : s === "[file]" ? translate("preview.file") : s.startsWith("[file] ") ? translate("quote.snapshot.file_named", { name: s.slice(7) }) // 文件带原名（M4-x）
  : s === "[chat_record]" ? translate("quote.snapshot.chat_record") // 旧服务端 token（无标题）兜底
  : s === "[call]" ? translate("quote.snapshot.call")        // 服务端裸 call token 兜底
  : s === "[contact]" ? translate("quote.snapshot.contact")  // 同上：老服务端下发的裸 contact token
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
  : m.contentType === CALL_CONTENT_TYPE ? "[音视频通话]"    // 通话记录不可被引用；防御：万一有，快照也别露 JSON
  : (m.content || "").slice(0, 60);

/** 「可搜索/可选/可定位」的消息：已确认（convSeq>0）、非撤回、非系统提示。搜索命中集、日历活跃日、多选勾选共用此一处谓词。 */
export const isSearchableMessage = (m: Pick<ChatMessage, "convSeq"> & { recalledAt?: number; contentType?: string }): boolean =>
  m.convSeq > 0 && !m.recalledAt && m.contentType !== "system" && m.contentType !== CALL_CONTENT_TYPE;
/** 多选态该消息是否可勾选：系统提示/撤回墓碑/发送中·失败的本地件（无服务端内容，转出去是空的）不可选。
 *  与 iOS isSelectableMessage: 同语义。 */
export const selectableInMultiSelect = (m: ChatMessage): boolean => isSearchableMessage(m);

/** 多选一次最多勾几条（2026-09-06）。**一道闸管住转发/收藏/举报三件事**，不给每个动作各设一个数字：
 *  三套阈值＝三套文案，用户记不住、我们也难维护。不限的话「选 200 条 × 9 个会话」会串行发出 1800 条。
 *  与 iOS `kIMSelectionMaxCount` 拉齐；服务端另有独立上限（举报 100 条/单、收藏 300 次/分）。 */
export const SELECT_MAX = 100;

/** 这批已选消息能否作为「批量举报」的对象：能则回那个**唯一发送者的 uid**，否则回 null。
 *
 *  三个条件缺一不可：非空、不含我自己发的、全部来自同一个人。第三条是产品口径也是后端口径——
 *  服务端只按首条反查处置对象，混着两个人的证据会让管理员的一键封号落到"第一条那个人"头上。
 *  与 iOS `reportableSenderForMessages:` 同语义。 */
export function reportableSenderOf(msgs: Pick<ChatMessage, "convSeq" | "from">[], uid: string): string | null {
  if (msgs.length === 0) return null;
  let sender: string | null = null;
  for (const m of msgs) {
    if (m.convSeq <= 0) return null;            // 未发出的本地件没有 conv_seq，服务端定位不到
    if (!m.from || m.from === uid) return null; // 含我自己 → 不可举报
    if (sender === null) sender = m.from;
    else if (sender !== m.from) return null;    // 跨发送者 → 不可举报
  }
  return sender;
}

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
 *  **老记录一定缺字段**：无 ts 不显时间、无 u/a 头像退化成按名字生成的首字母块，绝不能因此不渲染。
 *
 *  ⚠️ `u` 是**卡片内匿名序号**（s1/s2/…），不是真 uid——见 buildRecordItemsSenderKeys。
 *  存量卡片里的 `u` 仍是真 10 位 uid，故读端**只能拿它做相等比较**，不得解析、不得当接口参数。 */
export type RecordItem = {
  n: string; ct: string; c: string;
  fn?: string; fs?: number; cap?: string; d?: number; w?: string;
  ts?: number; u?: string; a?: string;
};
export type ChatRecord = { t: string; items: RecordItem[] };

/** 合并转发卡片标题 `t` 的**唯一生成口径**（与 iOS `IMChatRecordTitle` 逐字对齐）。
 *
 *  群聊一律固定串「群聊的聊天记录」，**绝不写真实群名**：收件人往往不在那个群里，群名本身就是
 *  信息（「XX 病友群」），而 `t` 会被冻结进消息内容、还能被再次转发，泄露没有回收路径。
 *  单聊写双方名字（微信同款）——只写对方的话，收件人看不出这是「对方和谁」的对话。
 *
 *  名字用**公开名**（昵称），不是备注：备注仅本人可见，写进去等于把「我给他起的私房名」发出去。
 *  缺名时逐级降级到「聊天记录」，绝不落到 10 位内部 ID（内部 ID 不上屏是全局纪律）。 */
export function chatRecordTitle(o: { isGroup: boolean; peerName?: string; myName?: string }): string {
  if (o.isGroup) return "群聊的聊天记录";
  const peer = (o.peerName ?? "").trim();
  const me = (o.myName ?? "").trim();
  if (peer && me) return `${peer}和${me}的聊天记录`;
  if (peer || me) return `${peer || me}的聊天记录`;
  return "聊天记录";
}

/** 为一组条目算出**卡片内匿名发送者序号**（真 uid → "s1"/"s2"/…，按首次出现顺序）。
 *
 *  为什么不直接发真 uid（2026-08-31 收口）：`GET /users/{id}` 只校验「持有合法 token」、不校验
 *  请求方与目标的关系——随机 10 位内部 ID 的**不可枚举**就是这个接口唯一的防线。把群成员的真 uid
 *  打包发给一个不在群里的收件人，等于绕过它：对方照着拉一遍就能多拿到 @句柄 / 标签 / 注册时间，
 *  还得到一个长期可复查的稳定句柄、可对这些人挨个发好友申请。
 *
 *  `u` 原本的两个用途都不需要真 uid：判「连续同一人」只要卡片内可区分；查头像本就有 `a` 快照兜底
 *  （而且 `a` 比读端查本地缓存更准——读端未必缓存过这个陌生人）。 */
export function buildRecordSenderKeys(froms: (string | undefined)[]): Map<string, string> {
  const keys = new Map<string, string>();
  for (const f of froms) {
    if (!f || keys.has(f)) continue;
    keys.set(f, `s${keys.size + 1}`);
  }
  return keys;
}
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
  if (it.ct === CALL_CONTENT_TYPE) return "[音视频通话]";
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

/**
 * 就绪文件点击时能否在浏览器内直接预览（对齐 iOS QuickLook 的 Web 诚实映射）。其余类型 → 另存。
 *
 * ⚠️ **这份清单必须是服务端 `inlineMIME` 的子集**（IMServer `cmd/imserver/handlers_upload.go`）。
 * 判据不在我们这边：`/uploads/` 只对 `inlineMIME` 白名单内的类型内联下发，**白名单外一律
 * `octet-stream` + `Content-Disposition: attachment`**（2026-09-03 加的存储型 XSS 闸）。
 * 所以这里多列一个类型，效果不是"能预览了"，而是**那个类型绕过了另存这条路**——
 * 点它 → openExternal → 浏览器拿到 attachment → 直接下载。
 *
 * 2026-09-09 就为此收敛过一次：原先多列了 `svg txt md log json csv xml` 七个。
 * 后果是桌面端点 `.log` 落进 `~/Downloads`（经系统浏览器），而点 `.apk` 弹原生保存框——
 * 同样是不可预览的文件，行为却不一致，且没有正当理由。（`.svg` 更是死条目：
 * 它连 `allowedUploadExt` 都不在，根本收不到。）两边的清单已登记进 docs/SYMMETRY.md。
 *
 * **反过来不必对齐**：服务端能内联、这里没列的（heic/heif/tif/tiff/ico/caf/opus/flac）
 * 是刻意的——"服务端肯内联"不等于"浏览器渲染得了"（Chrome 打不开 heic/tif），
 * 让它们走另存反而是对的。
 *
 * **这个数组是唯一来源，正则由它拼出来**——别再写一条平行的正则字面量。
 * 早先是「数组给测试看、正则给运行时用」的双份，于是只改正则、不改数组时两边测试都还绿，
 * 而服务端 `inlineMIME` 并没有那个新类型 → 那条老 bug（绕过另存）原样复发且无声。
 * 现在往这里加一个扩展名，`previewableFile.test.ts` 的「一个不多一个不少」当场红，
 * 逼你回头确认 IMServer 的 `inlineMIME` 也有它（见 IMServer docs/SYMMETRY.md 那条登记）。
 */
export const PREVIEWABLE_FILE_EXT = [
  "pdf",
  "png", "jpg", "jpeg", "gif", "webp", "bmp",
  "mp4", "mov", "webm", "m4v",
  "mp3", "wav", "m4a", "ogg", "aac",
] as const;

const PREVIEWABLE_FILE = new RegExp(`\\.(${PREVIEWABLE_FILE_EXT.join("|")})$`, "i");
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
