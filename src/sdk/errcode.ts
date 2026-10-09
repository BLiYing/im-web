/**
 * 业务错误码 → 友好文案键（对齐 iOS IMFriendlyMessageForCode）。**码表权威来源：后端
 * `../IMServer/internal/errcode/errcode.go`**——那里一经发布永不复用/改含义。这里的每个键都必须是
 * 该文件中现存的 Code；后端新增码这里不映射只回退英文原文（可接受降级），但**映射了一个已作废/改义的码
 * 会显示错误文案**，故 `imSdk.test.ts` 有对齐测试断言本表键 ⊆ 后端码集（见 CODING_STYLE §九）。
 * 隐私：被拉黑/密码错误等用模糊文案，不暴露"你被对方拉黑了"。
 * 值是文案表 `docs/i18n/strings.json` 的键（跨端同错误码复用同一个 `err.<code>`，对齐 iOS IMHTTPService.m）。
 */
import { t } from "../i18n";

export const FRIENDLY_MESSAGES: Record<number, string> = {
  100101: "common.login_expired",
  100102: "common.login_expired",
  200001: "err.200001",
  200002: "err.200002",
  200003: "err.200003",
  200004: "err.200004",
  200101: "err.200101",
  200102: "err.200102", // 被拉黑：不暴露
  200103: "err.200103",
  200104: "err.200104",
  200105: "err.200105",
  200106: "friend.requests.empty",
  200110: "err.200110",
  300201: "err.300201",
  300202: "err.300202",
  300004: "err.300004", // 账号被禁言（对齐 iOS；发消息被拒时用）
  300203: "err.300203",
  300206: "chat.input.disabled_mute_all", // 群全员禁言
  // 300204 不映射：服务端会带具体原因（如"群主需先转让群主再退群"），透传更有用。
  300205: "err.300205",
  300207: "qr.action.banned_note",
  300208: "chat.input.disabled_muted",
  // 300210 不映射：入群申请已提交，UI 走"待审批"提示分支而非错误 toast。
  300211: "err.300211",
  300212: "qr.action.admin_only_note",
  300213: "err.300213",
  100002: "err.100002",
  // 语音转文字 5001xx：这三个码只由 /voice/transcripts 产出，文案直接进总表。
  500101: "err.500101",
  500102: "err.500102", // 预留码：当前失败经 WS voice_transcript status=failed 送达
  500103: "err.500103",
};

/** 未收录回退服务端原文。导出供单测。 */
export function friendlyMessage(code: number, fallback: string): string {
  const key = FRIENDLY_MESSAGES[code];
  return key ? t(key) : fallback || t("err.request_failed", { code: String(code) });
}

/**
 * 发送被服务端拒收（WS error 帧带 client_msg_id）时挂到消息上的提示（对齐 iOS `IMSendRejectionNote` / Android `SendRejection`）。
 *
 * **只有「重发必然再被拒」的这几个码有提示**（iOS `IMSendRejectionShowsNote` 白名单）：有提示 = 气泡下方一行说明、
 * 红点不可点；其余码（限频 300002 等）返回空串 = 不挂提示，红点照常可点重发。
 *
 * 拉黑 200102 / 非好友 200103 / 内容过大 300001 用**专用文案**：不能走 `FRIENDLY_MESSAGES` 的 `err.200102`
 * （那是「加好友」场景的措辞），且拉黑 200102 必须读起来是模糊的「被拒收」、不泄露被拉黑（微信式）；
 * 非好友 200103 在同句后多一句「请先发送好友申请」，用来引出加好友入口。
 * 服务端对这几个码下发的是中文原文，直接用会让英文界面也显中文，所以三端都改走本地字符串。
 */
const SEND_REJECT_KEYS: Record<number, string> = {
  200102: "chat.reject.blocked",
  200103: "chat.reject.not_friend",
  300001: "chat.reject.too_large",
  300004: "err.300004", // 被禁言
  300203: "err.300203", // 非群成员
  300206: "chat.input.disabled_mute_all", // 群全员禁言
  300208: "chat.input.disabled_muted", // 成员级禁言
};

export function sendRejectNote(code: number): string {
  const key = SEND_REJECT_KEYS[code];
  return key ? t(key) : "";
}
