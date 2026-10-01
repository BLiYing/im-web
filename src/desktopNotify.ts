// 桌面端的「未读角标」与「要不要弹系统通知」两条判断。**纯函数，与 React 无关**——
// 它们决定用户会不会被打扰，判错的代价是「静音群把 Dock 角标顶成 99+」或者
// 「自己发的消息给自己弹通知」，都是那种一眼能看出来、但不测就一定会出现的错。
//
// 浏览器版走同一份判断（`platform().setBadge` 在 web 恒回 false，等于自动失效），
// 所以这里没有 if (isDesktop) —— 分流在 platform 层，不在业务里。
import type { Conversation } from "./sdk/protocol";
import type { ChatMessage } from "./sdk/protocol";
import { CALL_CONTENT_TYPE, callRecordIsGroup, isMissedCall } from "./callRecord";
import { t as i18nT } from "./i18n";
import { alertDecision, type AlertContext } from "./alertDecision";
import { DEFAULT_NOTIFY_SETTINGS, type NotifySettings } from "./notifySettings";
import { isMutedNow } from "./muteState";

/**
 * Dock / 任务栏角标数。
 *
 * **免打扰的会话默认不计入**：这是各家 IM 的通行做法，也是免打扰本身的意思——
 * 把静音群算进角标，用户就得为了消掉那个红点去点开一个他明确说过不想被打扰的会话。
 * 但**免打扰里 @我 的仍要计**（`mention_unread`）：设免打扰是「别为每条消息烦我」，
 * 不是「@我也别告诉我」。这条与 iOS/Web 会话行的红点口径一致（`UI.md` 未读红点那节）。
 *
 * `includeMuted`（NOTIFICATIONS_DESIGN §3.4，设置 ▸ 通知 ▸「包含免打扰会话」）：
 * **默认 `false` = 上面这条现行口径**；调用方不传就是老行为，改口径只影响传 `true` 的调用点。
 * 打开后免打扰会话也按未读数全额计入（不再降级成「有事记 1」）。
 */
export function badgeCountOf(convs: readonly Conversation[], includeMuted = false): number {
  const now = Date.now();
  let n = 0;
  for (const c of convs) {
    // 定时免打扰到期后按未免打扰计（NOTIFICATIONS_P1_DESIGN §4.3：所有读 muted 的地方都要走 isMutedNow，
    // 这里同时驱动桌面 Dock 角标与 favicon 角标——漏改就是「铃铛已消失、角标却还压着」）。
    if (!isMutedNow(!!c.muted, c.mute_until, now) || includeMuted) n += c.unread ?? 0;
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
 * **NOTIFICATIONS_DESIGN §3.1 起，本函数是 `alertDecision` 的薄封装**（"absorb shouldNotify"）：
 * 真正的判据表在 `alertDecision.ts`，那边有三端共用的一致性向量兜着。本函数只做两件
 * `alertDecision` 管不到的窄事——① 没有 `convId` 的畸形消息直接拒绝（`AlertContext` 没有
 * 「这条消息本身合不合法」这个概念，那是消息域的活）；② 把窄接口 `NotifyContext`（无
 * `convType`/`settings`/节流等字段）适配成 `AlertContext`：按「全部开关都开、不节流、不在
 * 通话中」的固定盘算——这些正是 `NotifyContext` 从未表达过的维度，保持旧调用点行为不变。
 *
 * **仍然保留**（没有直接删掉、全部调用点迁去 `alertDecision`）：`useDesktopIntegration.ts` 的
 * 真实通知链路已经改走 `alertDecision`（带完整设置/节流/免打扰穿透/通话中判断），本函数只留给
 * 历史测试与可能的窄场景调用方——它的契约比 `alertDecision` 窄，语义不会再演进。
 */
export function shouldNotify(msg: ChatMessage, ctx: NotifyContext): boolean {
  if (!msg.convId) return false;   // 点了也不知道该开哪个会话——AlertContext 没有这个概念，在此单独拦
  const isCall = msg.contentType === CALL_CONTENT_TYPE;
  const missedForMe = isCall && isMissedCall(msg.content, { viewerIsSender: false, isGroup: callRecordIsGroup(msg.content) });
  const alertCtx: AlertContext = {
    platform: "desktop",
    isLive: true,
    isSelf: msg.from === ctx.selfUid,
    isSystem: msg.contentType === "system",
    isRecalled: !!msg.recalledAt,
    isCallRecord: isCall,
    missedCallForMe: !!missedForMe,
    convType: "private",   // NotifyContext 不带会话类型；private/group 默认值相同（§3.7 全开），选哪个不影响结果
    muted: ctx.muted,
    mentionsMe: ctx.mentionsMe,
    appActive: true,
    windowFocused: ctx.windowFocused,
    viewingConv: ctx.windowFocused && msg.convId === ctx.currentConvId,
    inCall: false,
    nowMs: 0,
    lastSoundAtMs: -Infinity,   // 永不节流：NotifyContext 从没表达过节流窗口
    settings: DEFAULT_NOTIFY_SETTINGS as NotifySettings,   // 全部开关开：还原旧 shouldNotify 的固定行为
  };
  return alertDecision(alertCtx).osNotify;
}

/** 通知正文。媒体消息的 content 是 URL，直接显出来是一串路径——按类型给可读占位。
 *  2026-09-22 P3 修复：此前硬编码中文，不跟 App 语言；渲染进程内有 i18n 可用，直接取模块级 `t()`。 */
export function notifyBodyOf(msg: ChatMessage): string {
  const ct = msg.contentType;
  if (!ct || ct === "text") return (msg.content || "").slice(0, 120);
  if (msg.caption) return msg.caption.slice(0, 120);   // 图说优先于类型占位
  switch (ct) {
    case "image": return i18nT("preview.image");
    case "video": return i18nT("preview.video");
    case "voice": return i18nT("preview.voice");
    case "file": return msg.fileName ? i18nT("quote.snapshot.file_named", { name: msg.fileName }) : i18nT("preview.file");
    case "contact": return i18nT("notify.body.contact");
    case CALL_CONTENT_TYPE: return i18nT("notify.body.missed_call");   // shouldNotify 已放行的只有被叫未接
    case "chat_record": return i18nT("preview.chat_record");
    default: return i18nT("notify.body.default");
  }
}

/**
 * 系统通知的正文，**与手机推送同一套拼法**（服务端 `internal/push/content.go` 的 `Build`，iOS/Android 通知都用它）：
 * 预览关 → 「新消息」（仍保留下面的发送人前缀）；群聊 → 「发送人: 正文」（`push.group_body`）；
 * @我 / @全体 → 再套「[有人@我] …」（`push.mention_body`）。单聊不加前缀——标题本身就是对方名字。
 */
export function osNotifyBodyOf(
  msg: ChatMessage,
  o: { isGroup: boolean; preview: boolean; senderName: string; mentionsMe: boolean },
): string {
  let body = o.preview ? notifyBodyOf(msg) : i18nT("notif.preview.hidden");
  if (o.isGroup) body = i18nT("push.group_body", { sender: o.senderName, text: body });
  if (o.mentionsMe) body = i18nT("push.mention_body", { text: body });
  return body;
}
