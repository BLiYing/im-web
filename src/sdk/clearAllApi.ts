// 「清除所有对话」REST 契约（设计 IMServer/docs/design/CLEAR_ALL_CONVERSATIONS_DESIGN.md §3，PROTOCOL §6.8）：
//   POST /api/v1/users/me/conversations/clear   无 body，Bearer → data={cleared:N, items:[{conv_id, cleared_at}]}
// 限流超限 code=100002（callJson 已译成本地化文案）。无状态一次性请求，不碰 socket / 本地库。
import { callJson } from "./http";

export interface ClearedItem { convId: string; clearedAt: number }
export interface ClearAllResult { cleared: number; items: ClearedItem[] }

/** 回包解析（脏数据安全）：丢掉缺 conv_id 的项；cleared 缺失时取 items 条数。位点一律取服务端值，客户端不自造。 */
export function parseClearAll(raw: unknown): ClearAllResult {
  const r = (raw && typeof raw === "object" ? raw : {}) as { cleared?: unknown; items?: unknown };
  const items: ClearedItem[] = (Array.isArray(r.items) ? r.items : [])
    .map((i: { conv_id?: unknown; cleared_at?: unknown } | null) => ({ convId: typeof i?.conv_id === "string" ? i.conv_id : "", clearedAt: Number(i?.cleared_at) || 0 }))
    .filter((i) => i.convId !== "");
  const cleared = typeof r.cleared === "number" && Number.isFinite(r.cleared) && r.cleared >= 0 ? r.cleared : items.length;
  return { cleared, items };
}

export async function clearAllConversations(token: string): Promise<ClearAllResult> {
  return parseClearAll(await callJson("/api/v1/users/me/conversations/clear", { method: "POST", headers: { Authorization: `Bearer ${token}` } }));
}
