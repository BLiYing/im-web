// 桌面端的「未读角标」与「要不要弹系统通知」两条判断。**纯函数，与 React 无关**——
// 它们决定用户会不会被打扰，判错的代价是「静音群把 Dock 角标顶成 99+」或者
// 「自己发的消息给自己弹通知」，都是那种一眼能看出来、但不测就一定会出现的错。
//
// 浏览器版走同一份判断（`platform().setBadge` 在 web 恒回 false，等于自动失效），
// 所以这里没有 if (isDesktop) —— 分流在 platform 层，不在业务里。
import type { Conversation } from "./sdk/protocol";
import type { ChatMessage } from "./sdk/protocol";

/**
 * Dock / 任务栏角标数。
 *
 * **免打扰的会话不计入**：这是各家 IM 的通行做法，也是免打扰本身的意思——
 * 把静音群算进角标，用户就得为了消掉那个红点去点开一个他明确说过不想被打扰的会话。
 * 但**免打扰里 @我 的仍要计**（`mention_unread`）：设免打扰是「别为每条消息烦我」，
 * 不是「@我也别告诉我」。这条与 iOS/Web 会话行的红点口径一致（`UI.md` 未读红点那节）。
 */
export function badgeCountOf(convs: readonly Conversation[]): number {
  let n = 0;
  for (const c of convs) {
    if (!c.muted) n += c.unread ?? 0;
    else if (c.mention_unread) n += 1;   // 静音里被 @：只记 1，表示「这里有事」，不放大成条数
  }
  return n;
}

/** `shouldNotify` 要看的上下文。全部由调用方给，函数本身不读任何全局。 */
export interface NotifyContext {
  /** 本人 uid：自己发的消息（多端抄送）绝不通知。 */
  selfUid: string;
  /** 当前打开的会话 id。正在看的会话不通知——用户就在看，弹窗是纯打扰。 */
  currentConvId: string;
  /** 窗口是否处于前台。前台时不通知，消息本来就在眼前。 */
  windowFocused: boolean;
  /** 该会话是否免打扰。 */
  muted: boolean;
  /** 该消息是否 @了我（免打扰的唯一例外）。 */
  mentionsMe: boolean;
}

/**
 * 要不要为这条入站消息弹系统通知。
 *
 * 顺序是有讲究的：**先排除「本来就该看到」的情形**（自己发的、正在看的、窗口在前台），
 * 再看免打扰。反过来写会让「免打扰会话里自己发的消息」走到 mention 分支上去。
 */
export function shouldNotify(msg: ChatMessage, ctx: NotifyContext): boolean {
  if (!msg.convId) return false;
  if (msg.from === ctx.selfUid) return false;                       // 自己发的（含多端抄送）
  if (ctx.windowFocused && msg.convId === ctx.currentConvId) return false; // 正看着这个会话
  if (ctx.windowFocused) return false;                              // 前台：交给应用内的红点/声音
  if (ctx.muted) return ctx.mentionsMe;                             // 免打扰：只有 @我 才穿透
  return true;
}

/** 通知正文。媒体消息的 content 是 URL，直接显出来是一串路径——按类型给可读占位。 */
export function notifyBodyOf(msg: ChatMessage): string {
  const t = msg.contentType;
  if (!t || t === "text") return (msg.content || "").slice(0, 120);
  if (msg.caption) return msg.caption.slice(0, 120);   // 图说优先于类型占位
  switch (t) {
    case "image": return "[图片]";
    case "video": return "[视频]";
    case "voice": return "[语音]";
    case "file": return msg.fileName ? `[文件] ${msg.fileName}` : "[文件]";
    case "contact": return "[名片]";
    case "chat_record": return "[聊天记录]";
    default: return "[消息]";
  }
}
