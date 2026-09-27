// 通话记录消息（content_type=call）的 content 解析 / 构造 / 渲染文案（纯函数，可单测）。
// content 是极小 JSON：{"cid","m","r","d"[,"g":1]}——call_id / 媒体类型 / 结束原因 / 服务端给的秒数 / 群通话标记。
// 设计见 IMServer docs/design/CALL_RECORD_DESIGN.md，文案矩阵以 UX 稿 §02 为准；
// 与 iOS / Android 逐条同口径，**三端共用测试向量**（src/testing/callRecord.vectors.json，源：IMServer docs/conformance/call_record.json）。
//
// 2026-09-22 P3 修复：渲染函数此前全是硬编码中文字面量，不看 App 当前语言（与 iOS IMCallRecordRender
// 早已本地化不同，是本端遗留的 SYMMETRY 缺口）。改按 i18n 文案表 call.record.* 取当前语言；
// 用到的键与 iOS IMCallRecord.m 逐条同口径，不新增文案。
import { t as i18nT, type Args } from "./i18n";

/** call 消息的 content_type 常量（与后端 store.ContentTypeCall 一致）。 */
export const CALL_CONTENT_TYPE = "call";

type Translate = (key: string, args?: Args) => string;

export type CallMedia = "audio" | "video";

/** 解析后的通话记录。 */
export interface CallRecord {
  callId: string;
  media: CallMedia;
  /** 协议 §6 的 reason 原串；渲染时表外值折成 error。 */
  reason: string;
  /** 服务端给的秒数（不变量 I8：禁止本地相减）。 */
  durationSec: number;
}

export type CallTone = "normal" | "missed";

export interface CallRender {
  /** 图标：电话 / 摄像机（只靠图标区分语音与视频，正文不重复写）。 */
  icon: CallMedia;
  text: string;
  /** missed = 红色（只有被叫侧的 cancel / no_answer / busy / offline）。 */
  tone: CallTone;
  /** 单聊可点回拨，群系统条不可点。 */
  tappable: boolean;
  /** 会话列表预览（含 [语音通话] 等前缀，按「看的人」视角）。 */
  preview: string;
}

/** 时长上限：3 天（与服务端 §1 截断一致）。 */
const MAX_DURATION_SEC = 86400 * 3;

/** 协议 §6 的 reason 表；表外一律折成 error。 */
const KNOWN_REASONS = new Set([
  "hangup", "cancel", "reject", "no_answer", "busy", "offline",
  "network", "room_closed", "kicked", "error",
]);

/** 主叫看到 / 被叫看到的未接通文案键（UX 稿 §02）。表里放文案**键**，不在模块顶层取文案，否则切语言不会变。 */
const UNANSWERED_KEYS: Record<string, readonly [caller: string, callee: string]> = {
  cancel: ["call.record.cancelled", "call.record.cancelled_by_peer"],
  reject: ["call.record.declined_by_peer", "call.record.declined"],
  no_answer: ["call.record.peer_no_answer", "call.record.missed"],
  busy: ["call.record.peer_busy", "call.record.missed"],
  offline: ["call.record.peer_offline", "call.record.missed"],
};

/** 时长格式：<1h → mm:ss；≥1h → h:mm:ss。 */
export function formatCallDuration(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  const h = Math.floor(s / 3600);
  const mm = String(Math.floor((s % 3600) / 60)).padStart(2, "0");
  const ss = String(s % 60).padStart(2, "0");
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

/**
 * 解析 call 消息 content。**非法 JSON / 缺 cid / m 不是 audio|video → null**（调用方降级成灰字系统条）。
 * r 不校验枚举；d 非法或负数按 0，超上限截断。
 */
export function parseCallRecord(content: string | undefined | null): CallRecord | null {
  if (typeof content !== "string" || content.length === 0) return null;
  let obj: unknown;
  try {
    obj = JSON.parse(content);
  } catch {
    return null;
  }
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) return null;
  const d = obj as Record<string, unknown>;
  const callId = typeof d.cid === "string" ? d.cid.trim() : "";
  if (!callId) return null;
  if (d.m !== "audio" && d.m !== "video") return null;
  const dur = typeof d.d === "number" && Number.isFinite(d.d) && d.d > 0 ? Math.min(Math.floor(d.d), MAX_DURATION_SEC) : 0;
  return { callId, media: d.m, reason: typeof d.r === "string" ? d.r : "", durationSec: dur };
}

/** SDK callSummary 事件里发消息需要的字段（只取这几个，不依赖 SDK 的类型导出）。 */
export interface CallSummaryLike {
  callId: string;
  mediaType: CallMedia;
  reason: string;
  durationSec: number;
  isGroup: boolean;
}

/** 一次待发送的通话记录消息（发送目标 + 内容 + 幂等 id）。 */
export interface CallRecordSendPlan {
  convId: string;
  /** 单聊对端 uid；群聊为空串。 */
  to: string;
  content: string;
  /** "call-" + call_id：主叫多端 / 断线重发都落同一条（服务端幂等）。 */
  clientMsgId: string;
}

/** callSummary 事件里做决定所需的字段（结构上是 SDK 事件的子集）。 */
export interface CallSummaryEvent extends CallSummaryLike {
  role: "caller" | "callee";
  peer: string;
  chatGroupId: string;
}

/**
 * 这个 callSummary 要不要发记录、发到哪。**只有主叫发**（被叫发就是一通电话两条）；
 * 1v1 发到「我—peer」单聊，群通话发到 chatGroupId 群会话（= 群 conv_id）；目标缺失或 callId 非法 → null。
 */
export function planCallRecord(s: CallSummaryEvent, selfUid: string, convIdOf: (self: string, peer: string) => string): CallRecordSendPlan | null {
  if (s.role !== "caller") return null;
  const content = buildCallRecord(s);
  if (!content) return null;
  const clientMsgId = `call-${s.callId.trim()}`;
  if (s.isGroup) {
    return s.chatGroupId ? { convId: s.chatGroupId, to: "", content, clientMsgId } : null;
  }
  return s.peer && selfUid ? { convId: convIdOf(selfUid, s.peer), to: s.peer, content, clientMsgId } : null;
}

/** 构造 call 消息 content JSON；callId 为空返回 null（服务端也会以 100001 拒）。 */
export function buildCallRecord(s: CallSummaryLike): string | null {
  const cid = (s.callId ?? "").trim();
  if (!cid || cid.length > 64) return null;
  const out: Record<string, string | number> = {
    cid, m: s.mediaType === "video" ? "video" : "audio", r: s.reason || "error",
  };
  const d = Number.isFinite(s.durationSec) && s.durationSec > 0 ? Math.min(Math.floor(s.durationSec), MAX_DURATION_SEC) : 0;
  out.d = d;
  if (s.isGroup) out.g = 1;
  return JSON.stringify(out);
}

/** 渲染输入：看的人相关的三个量。 */
export interface CallViewer {
  viewerIsSender: boolean;
  isGroup: boolean;
  /** 群系统条的发起人名（备注 > 群昵称 > 昵称 > @句柄，由调用方解析；本人写「你」由本函数处理）。 */
  senderName?: string;
}

/** 渲染一条通话记录；解析失败返回 null。`translate` 默认取模块级 `t()`（调用时刻取语言）；
 *  组件内渲染要传 `useT()` 的 `tr`，否则切语言不会立即重渲染这条气泡/系统条（见文件头 2026-09-22 注）。 */
export function renderCallRecord(content: string | undefined | null, v: CallViewer, translate: Translate = i18nT): CallRender | null {
  const rec = parseCallRecord(content);
  if (!rec) return null;
  const reason = KNOWN_REASONS.has(rec.reason) ? rec.reason : "error";
  return v.isGroup ? renderGroup(rec, reason, v, translate) : renderSingle(rec, reason, v, translate);
}

function renderSingle(rec: CallRecord, reason: string, v: CallViewer, t: Translate): CallRender {
  let text: string;
  let tone: CallTone = "normal";
  const row = UNANSWERED_KEYS[reason];
  if (rec.durationSec > 0) {
    text = t("call.record.duration", { duration: formatCallDuration(rec.durationSec) });
  } else if (row) {
    text = t(v.viewerIsSender ? row[0] : row[1]);
    // 只有被叫侧真正错过的才红；被叫自己拒绝不红。
    if (!v.viewerIsSender && reason !== "reject") tone = "missed";
  } else {
    text = t("call.record.not_connected");
  }
  const previewKey = rec.media === "video" ? "call.record.preview_video" : "call.record.preview_voice";
  return { icon: rec.media, text, tone, tappable: true, preview: t(previewKey, { text }) };
}

function renderGroup(rec: CallRecord, reason: string, v: CallViewer, t: Translate): CallRender {
  // senderName 缺失（理论上不该发生，防御性兜底）→ 退「对方」，与 iOS IMCallRecordRender.groupText 同口径
  // （此前这里是裸 `?? ""`，会渲染成缺主语的空洞句子——顺手一并修的 SYMMETRY 缺口）。
  const who = v.viewerIsSender ? t("call.record.who_self") : (v.senderName || t("call.record.who_peer"));
  const kind = t(rec.media === "video" ? "call.record.kind_video" : "call.record.kind_voice");
  let text: string;
  let brief: string;
  if (rec.durationSec > 0) {
    const duration = formatCallDuration(rec.durationSec);
    text = t("call.record.group_duration", { who, kind, duration });
    brief = t("call.record.tail_duration", { duration });
  } else if (reason === "no_answer") {
    text = t("call.record.group_no_answer", { who, kind });
    brief = t("call.record.tail_no_answer");
  } else if (reason === "cancel") {
    text = t("call.record.group_cancelled", { who, kind });
    brief = t("call.record.cancelled");
  } else {
    text = t("call.record.group_ended");
    brief = t("call.record.tail_ended");
  }
  const previewKey = rec.media === "video" ? "call.record.preview_group_video" : "call.record.preview_group_voice";
  return { icon: rec.media, text, tone: "normal", tappable: false, preview: t(previewKey, { tail: brief }) };
}

/** 会话列表预览用：解析失败回落 `[音视频通话]`（不漏 JSON）。 */
export function callRecordPreview(content: string | undefined | null, v: CallViewer, translate: Translate = i18nT): string {
  return renderCallRecord(content, v, translate)?.preview ?? translate("quote.snapshot.call");
}

/** 会话列表这一行是否整行红（被叫侧未接来电）。 */
export function isMissedCall(content: string | undefined | null, v: CallViewer): boolean {
  return renderCallRecord(content, v)?.tone === "missed";
}

/** content 里的 g 标记（群通话）；只给「手里没有会话信息」的场景（桌面通知）用，渲染以会话为准。 */
export function callRecordIsGroup(content: string | undefined | null): boolean {
  try {
    const o: unknown = JSON.parse(content ?? "");
    return !!o && typeof o === "object" && (o as Record<string, unknown>).g === 1;
  } catch {
    return false;
  }
}
