// 三端共用的通知判据（NOTIFICATIONS_DESIGN §3.1）。**纯函数，与 React/DOM/消息类型无关**——
// 输入已经是拆好的布尔/字符串，产出该不该响/振/弹横幅/弹系统通知。一致性向量：
// `IMServer/docs/conformance/alert_decision.json`（32 条，三端单测都读它；改规则先改向量）。
//
// 消息/会话到这份 ctx 的映射（isSelf/isCallRecord/mentionsMe 这些怎么从 ChatMessage 算出来）
// 不在本文件——那是「消息域」的活，见 `desktopNotify.ts` 的 `shouldNotify`（旧契约的窄场景）
// 与 `useDesktopIntegration.ts` 的 `notifyInbound`（新接线）。本文件只认调用方已经算好的字段。
import { normalizeSoundId, type NotifySettings, type NotifySoundId } from "./notifySettings";

/** 节流窗口：1.5 秒内最多响一次（连发十条只响一声），移动端连振动也一并节流。 */
export const ALERT_THROTTLE_MS = 1500;

export type AlertPlatform = "mobile" | "desktop" | "browser";

export interface AlertContext {
  platform: AlertPlatform;
  /** 实时到达的新消息才判；历史回填/离线积压/窗口加载一律不判（调用方在此之前就该短路，
   *  这里仍留一道闸门防漏）。 */
  isLive: boolean;
  isSelf: boolean;
  isSystem: boolean;
  isRecalled: boolean;
  isCallRecord: boolean;
  /** 仅 isCallRecord 时有意义：本端是被叫且未接。 */
  missedCallForMe: boolean;
  convType: "private" | "group";
  muted: boolean;
  /** 含 @全体；免打扰的唯一穿透条件。 */
  mentionsMe: boolean;
  /** 仅移动端用：App 是否在前台。 */
  appActive: boolean;
  /** 桌面/浏览器用：窗口是否在焦点，决定要不要弹系统通知。 */
  windowFocused: boolean;
  /** 调用方判定的「用户此刻真的在看这个会话」：移动端=前台且在该会话页；
   *  桌面/浏览器=窗口在焦点且选中该会话。命中则什么都不做。 */
  viewingConv: boolean;
  /** 正在音视频通话：不响不振，会抢通话音频。 */
  inCall: boolean;
  nowMs: number;
  lastSoundAtMs: number;
  settings: NotifySettings;
}

export interface AlertDecision {
  sound: boolean;
  /** 仅移动端可能为 true；桌面/浏览器恒 false（没有振动能力）。 */
  vibrate: boolean;
  /** 仅移动端可能为 true（P1 第一批已接，见 NOTIFICATIONS_P1_DESIGN §1.1）；桌面/浏览器恒 false。 */
  banner: boolean;
  /** 仅桌面（Electron）可能为 true；浏览器恒 false（没有系统通知能力）。 */
  osNotify: boolean;
  /** `sound` 为 false 时恒 null。 */
  soundId: NotifySoundId | null;
}

const DENIED: AlertDecision = { sound: false, vibrate: false, banner: false, osNotify: false, soundId: null };

export function alertDecision(ctx: AlertContext): AlertDecision {
  // 排除「本来就不该提醒」的情形：顺序不影响结果（每条都返回同一个全否决定），
  // 但保持"先排除自己/系统/撤回"在前——与旧 shouldNotify 的注释一致，便于对照。
  if (ctx.isSelf || ctx.isSystem || ctx.isRecalled) return DENIED;
  if (!ctx.isLive) return DENIED;
  if (ctx.isCallRecord && !ctx.missedCallForMe) return DENIED; // 通话记录只推被叫未接
  if (ctx.viewingConv) return DENIED; // 正看着这个会话：本来就在眼前
  if (ctx.inCall) return DENIED; // 通话中：不抢通话音频

  const typeSettings = ctx.convType === "group" ? ctx.settings.group : ctx.settings.private;
  if (!typeSettings.enabled) return DENIED;
  if (ctx.muted && !ctx.mentionsMe) return DENIED; // 免打扰：只有 @我 才穿透

  // 差值为负 = 系统时钟往回拨过：当没响过，否则回拨多久就静音多久（/code-review 2026-09-29，三端同改）
  const sinceLast = ctx.nowMs - ctx.lastSoundAtMs;
  const throttled = sinceLast >= 0 && sinceLast < ALERT_THROTTLE_MS;
  const soundId = normalizeSoundId(typeSettings.sound);

  if (ctx.platform === "mobile") {
    if (!ctx.appActive) return DENIED; // P0 没有推送：不在前台就收不到提醒
    const wantSound = ctx.settings.inApp.sound && soundId !== "none" && !throttled;
    const wantVibrate = ctx.settings.inApp.vibrate && !throttled;
    // 横幅（P1 §1.1）：资格同 sound/vibrate（含 appActive，已在上面短路），另要求「应用内预览」开，
    // **不受节流影响**——连来多条时横幅原地换成最新一条，只有声音/振动才节流。
    const banner = ctx.settings.inApp.preview;
    return { sound: wantSound, vibrate: wantVibrate, banner, osNotify: false, soundId: wantSound ? soundId : null };
  }

  // 桌面 / 浏览器：声音读 `desktop.*`（不是 `inApp.*`——那两个开关只管移动端），
  // 振动恒 false（没有这个能力）。osNotify 只有桌面才可能为 true，且只看「窗口是否在焦点」，
  // **与 sound 是否响独立**——桌面窗口在焦点但用户在看别的会话时，仍要响一声（§3.1 表格明文）。
  const wantSound = ctx.settings.desktop.sound && soundId !== "none" && !throttled;
  const osNotify = ctx.platform === "desktop" && ctx.settings.desktop.enabled && !ctx.windowFocused;
  return { sound: wantSound, vibrate: false, banner: false, osNotify, soundId: wantSound ? soundId : null };
}
