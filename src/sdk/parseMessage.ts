// 线上帧 → ChatMessage 的解析（new_msg / sync_resp / window_resp 共用一份）。
//
// 从 imSdk.processIncoming 里原样搬出来（CODING_STYLE §7 体量门禁）。这一大段全是**脏数据安全**
// 的收口规则——哪些字段允许缺、非法值该退化成什么——单独成文件后可以直接单测，
// 也免得它继续在那个已经很长的收帧 switch 里滚雪球。行为逐字不变。
import type { ChatMessage } from "./protocol";
import { parseSysSegments } from "../sysSegments";
import { parseMentionSpans } from "../mention";

/* eslint-disable @typescript-eslint/no-explicit-any */

/** 脏数据安全地把一个 JSON 值收成 `Record<string,string>`：非对象一律 undefined；非字符串的值丢弃（P3 sys_args/reply_snapshot_args）。 */
function parseStringRecord(raw: unknown): Record<string, string> | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof v === "string") out[k] = v;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

/** 把一帧消息负载解析成 ChatMessage。入参是**未经校验**的服务端 JSON，一切取值都要自带兜底。 */
export function parseIncomingMessage(d: any): ChatMessage {
  return {
    serverMsgId: d.server_msg_id,
    convId: d.conv_id,
    from: d.from,
    fromNickname: d.from_nickname || undefined, // 群消息冗余带发送者昵称（空不占字段）
    fromRole: d.from_role || undefined,         // 群主/管理员气泡徽标兜底（仅 owner/admin 带）
    content: typeof d.content === "string" ? d.content : "",
    contentType: d.content_type || "text",
    fileName: d.file_name || undefined,
    fileSize: d.file_size !== undefined && Number(d.file_size) >= 0 ? Number(d.file_size) : undefined,
    caption: typeof d.caption === "string" && d.caption ? d.caption : undefined, // 图文/视频文/文件文随附文本（Telegram 图说模型）
    convSeq: d.conv_seq || 0,
    timestamp: d.timestamp || 0,
    status: "received",
    // 直加载/同步已带派生状态（服务端冗余下发）：撤回消息直接渲染墓碑，不依赖回放 op 事件。
    recalledAt: d.recalled_at || undefined,
    recalledBy: d.recalled_by || undefined,
    editedAt: d.edited_at || undefined,
    pinnedAt: d.pinned_at || undefined,
    replyToConvSeq: d.reply_to_conv_seq || undefined,
    replySnapshot: d.reply_snapshot || undefined,
    // P3：引用快照结构化种类 + 参数（脏数据安全：非字符串/空串一律按未识别处理，渲染回退 replySnapshot 整句）。
    replySnapshotKind: typeof d.reply_snapshot_kind === "string" && d.reply_snapshot_kind ? d.reply_snapshot_kind : undefined,
    replySnapshotArgs: parseStringRecord(d.reply_snapshot_args),
    replyToFrom: d.reply_to_from || undefined,
    forwardFrom: d.forward_from || undefined,
    groupId: d.group_id || undefined,
    posterUrl: d.poster || undefined,
    mediaW: Number(d.media_w) > 0 ? Number(d.media_w) : undefined,
    mediaH: Number(d.media_h) > 0 ? Number(d.media_h) : undefined,
    duration: Number(d.duration) > 0 ? Number(d.duration) : undefined,
    // 未下载卡片的模糊占位（M4-7）：**只认内联 data:image/ 的 JPEG/PNG**。门控的意义就是"用户点之前绝不碰网络"，
    // 若放行远程 URL，渲染 <img src> 时会在用户未下载前就去拉对端内容（追踪像素 / 泄漏 IP）——必须挡掉。
    thumb: typeof d.thumb === "string" && /^data:image\//.test(d.thumb) ? d.thumb : undefined,
    // voice 振幅指纹（P0，base64）：服务端已校验解码后 ≤120 字节；本地只做类型收口，不再验长度。
    waveform: typeof d.waveform === "string" ? d.waveform : undefined,
    // @提及（M4-8）：脏数据安全——只收字符串数组，非数组一律按"未 @ 任何人"。
    mentions: Array.isArray(d.mentions) ? (d.mentions as unknown[]).filter((x): x is string => typeof x === "string") : undefined,
    mentionAll: d.mention_all === true || undefined, mentionSpans: parseMentionSpans(d.mention_spans),
    // 系统消息分段（名字可点 + 换本地显示名）：脏数据安全——非数组/无 text 的项一律丢弃，
    // 一段都不剩就按"无分段"处理，渲染回退 content 整句（与历史系统消息同款）。
    sysSegments: parseSysSegments(d.sys_segments),
    // P3：系统消息/系统通知的结构化事件 + 参数（脏数据安全同上；空/未识别时渲染回退 sysSegments/content）。
    sysEvent: typeof d.sys_event === "string" && d.sys_event ? d.sys_event : undefined,
    sysArgs: parseStringRecord(d.sys_args),
  };
}
