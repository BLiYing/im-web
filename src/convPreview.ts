// convPreview：会话列表那一行「最后一条消息」的预览文本。
//
// 从 App.tsx 抽出（2026-09-05，CODING_STYLE §7 ③）。它是纯派生——一条 Conversation 进、
// 一行字出——却踩过好几个只在真实数据上才暴露的坑，值得有自己的位置和单测：
//
//  · **contact 必须带 content 进来**：曾漏传，会话列表上直接显出 `{"u":"1002",…}` 整串 JSON
//    （用户实测发现；iOS 当时已按 lastContent 处理，两端不一致）。
//  · **名字走本机显示名**：否则列表显真名、点进会话显备注，同一句话两副面孔。
//  · **系统消息按分段拼**：分段里的名字要换成本机显示名，自己那段显「我」；
//    历史消息没有分段 → 回退整句（别渲染成空）。
import type { Conversation } from "./sdk/protocol";
import { CONTACT_CONTENT_TYPE, contactCardPreview } from "./contactCard";
import { CALL_CONTENT_TYPE, callRecordPreview, isMissedCall } from "./callRecord";
import { sysSegmentName } from "./sysSegments";
import { t, getLang } from "./i18n"; // 非组件文件：模块级 t()，调用时刻取语言，不在模块顶层求值
import { buildGroupSysSegments } from "./sysEventRender";

/** 会话列表预览的类型占位。
 *
 *  `extra` 不是可选的点缀：**voice 与 contact 需要 content_type 之外的东西**
 *  （时长 / 名片快照里的昵称），不给就分别退化成没有时长的 `[语音]` 和一整串 JSON。
 *  2026-09-22 P3 修复：此前硬编码中文，不跟 App 语言；改用模块级 t()（同文件已有先例，见下方 convPreview）。 */
export function mediaPreview(ct: string, extra?: { duration?: number; content?: string; viewerIsSender?: boolean; isGroup?: boolean }): string | null {
  if (ct === "image") return t("preview.image");
  if (ct === "video") return t("preview.video");
  if (ct === "file") return t("preview.file");
  if (ct === "chat_record") return t("preview.chat_record");
  if (ct === CONTACT_CONTENT_TYPE) return contactCardPreview(extra?.content, t);
  // 通话记录：文案按「看的人」的视角（主叫 / 被叫两套），所以必须带上 viewerIsSender。
  if (ct === CALL_CONTENT_TYPE) return callRecordPreview(extra?.content, { viewerIsSender: !!extra?.viewerIsSender, isGroup: !!extra?.isGroup }, t);
  if (ct === "voice") {
    const ms = extra?.duration ?? 0;
    const s = Math.max(0, Math.floor(ms / 1000));
    return t("preview.voice_duration", { duration: `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}` });
  }
  return null;
}

export interface ConvPreviewDeps {
  /** 我的 uid：判「你/我」用。 */
  uid: string;
  /** 某人在本机的显示名（备注 > 群昵称/全局昵称 > fallback > 占位）——见 chatNaming 的 `localNameOf`。 */
  localNameOf: (id: string, convId: string, fallback?: string) => string;
}

/** 一条会话的预览行。 */
export function convPreview(c: Conversation, d: ConvPreviewDeps): string {
  if (!c.last_message) return "（无消息）";
  const m = c.last_message;
  const lastName = (fallback?: string) => d.localNameOf(m.from, c.conv_id, fallback);
  // 撤回消息预览（后端已脱敏 content）：显示"撤回了一条消息"（微信式）。
  if (m.recalled_at) {
    const who = m.from === d.uid ? "你" : (c.is_group ? lastName(m.from_nickname) : "对方");
    return `${who}撤回了一条消息`;
  }
  const media = mediaPreview(m.content_type, { duration: m.duration, content: m.content, viewerIsSender: m.from === d.uid, isGroup: c.is_group });
  // 系统消息：P3 起 sys_event 认识就先按 App 语言重建分段（不挂点击，纯文本），不认识/为空回退
  // 原始 sys_segments；再按分段拼，名字换成本机显示名，无分段（更老的历史消息）回退整句。无发送者前缀。
  if (m.content_type === "system") {
    const segs = buildGroupSysSegments(
      { sysEvent: m.sys_event, sysArgs: m.sys_args, sysSegments: m.sys_segments, convId: c.conv_id },
      t, d.uid, d.localNameOf, getLang(),
    ) ?? m.sys_segments;
    return segs?.length
      // 我自己 → 「我」，与聊天页系统行同口径（sysSegmentName）。
      ? segs.map((seg) => (seg.uid ? sysSegmentName(seg.uid, d.uid, (id) => d.localNameOf(id, c.conv_id, seg.text)) : seg.text)).join("")
      : m.content;
  }
  // 图说 caption「有字显字」（Telegram 模型）：带 caption 时直接显 caption，否则回退 [图片]/[视频]/[文件]。
  const text = m.caption || media || m.content;
  if (!c.is_group) return text;
  const who = m.from === d.uid ? "我" : lastName(m.from_nickname);
  return `${who}: ${text}`;
}

/** 会话列表这一行是否整行红：最后一条是「我」作为被叫错过的来电（UX 稿 §06）。 */
export function isMissedCallPreview(c: Conversation, uid: string): boolean {
  const m = c.last_message;
  if (!m || m.content_type !== CALL_CONTENT_TYPE || m.recalled_at) return false;
  return isMissedCall(m.content, { viewerIsSender: m.from === uid, isGroup: !!c.is_group });
}
