// 会话置顶消息（G0）的 HTTP 调用 + 批量取消置顶广播帧的解析（PROTOCOL §11 `/pinned`、`/pinned/clear`，§6.7.2）。
// 无状态：只发请求 / 解析 JSON；本地落库与 UI 通知由 IMClient 负责。拆出来是因为 imSdk.ts 卡在体量基线（CODING_STYLE §7）。
// 设计见 IMServer docs/design/PINNED_PANEL_DESIGN.md §4。

import { callJson } from "./http";
import { parseIncomingMessage } from "./parseMessage";
import type { ChatMessage, PinnedMessage } from "./protocol";

const authed = (token: string, init?: RequestInit): RequestInit => ({
  ...init,
  headers: { Authorization: `Bearer ${token}`, ...(init?.body ? { "Content-Type": "application/json" } : {}) },
});

const pinnedPath = (convId: string) => `/api/v1/conversations/${encodeURIComponent(convId)}/pinned`;

/** 每项附带的完整消息对象（与 new_msg / 历史接口同形）→ ChatMessage；缺失 / 非对象 / 无 conv_seq（旧服务端、脏数据）一律 undefined。 */
function parseFullMessage(raw: unknown, convId: string): ChatMessage | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const m = parseIncomingMessage(raw);
  if (!m.convSeq) return undefined;
  return { ...m, convId: m.convId || convId };
}

/** `GET /pinned` 的 data → 置顶集合（服务端已按 pinned_at 倒序）。入参未经校验，一切取值自带兜底。 */
export function parsePinnedItems(data: unknown, convId: string): PinnedMessage[] {
  const items = ((data as { items?: unknown } | undefined)?.items ?? []) as Array<Record<string, any>>; // eslint-disable-line @typescript-eslint/no-explicit-any
  if (!Array.isArray(items)) return [];
  return items.map((it) => ({
    convSeq: it.conv_seq ?? 0,
    serverMsgId: it.server_msg_id ?? "",
    from: it.sender ?? "",
    fromNickname: it.from_nickname || undefined,
    contentType: it.content_type ?? "text",
    content: it.content ?? "",
    caption: it.caption || undefined, // 图说：置顶横幅「有字显字」
    timestamp: it.timestamp ?? 0,
    pinnedAt: it.pinned_at ?? 0,
    message: parseFullMessage(it.message, convId),
  }));
}

/** 拉会话当前置顶集合（进会话回填横幅；之后靠实时 msg_op 帧触发重拉，不轮询）。 */
export async function fetchPinned(token: string, convId: string): Promise<PinnedMessage[]> {
  return parsePinnedItems(await callJson(pinnedPath(convId), authed(token)), convId);
}

/** 一键取消该会话全部置顶（一次请求）。返回服务端实际清除的条数；越权（300006）/ 非成员等整单失败抛错。
 *  成功后服务端另广播一帧 `msg_op{op:pin,pinned:false,targets}`，本端由 IMClient 按批量帧逐条应用。 */
export async function clearPinned(token: string, convId: string): Promise<number> {
  const data = await callJson(`${pinnedPath(convId)}/clear`, authed(token, { method: "POST", body: "{}" }));
  return Number((data as { cleared?: unknown } | undefined)?.cleared) || 0;
}

/** 批量取消置顶帧（`op:pin, pinned:false, targets:[{target_conv_seq,op_conv_seq}…]`）→ 目标与事件行 seq；不是该帧返回 null。
 *  与批量删除帧（selectDelete.ts 的 batchDeleteTargetsOf）同形，只是 op 不同、语义是「逐条置为未置顶」。 */
export function batchUnpinTargetsOf(d: { op?: unknown; pinned?: unknown; targets?: unknown }): { seqs: number[]; opSeqs: number[] } | null {
  if (d.op !== "pin" || d.pinned !== false || !Array.isArray(d.targets)) return null;
  const seqs: number[] = [], opSeqs: number[] = [];
  for (const it of d.targets as Array<{ target_conv_seq?: unknown; op_conv_seq?: unknown }>) {
    const s = Number(it?.target_conv_seq), o = Number(it?.op_conv_seq);
    if (s > 0) seqs.push(s);
    if (o > 0) opSeqs.push(o);
  }
  return { seqs, opSeqs };
}
