// 注销账号 / 冷静期恢复的 HTTP 契约（设计 IMServer/docs/design/DELETE_ACCOUNT_DESIGN.md §5）。
//
// 契约以 PROTOCOL.md §6.16 为准（已对账）：
//   · POST /api/v1/account/delete  {password}（Bearer）→ {purge_at ms}；群主阻断 100103 + data.owned_groups:[{conv_id,name}]
//   · POST /api/v1/account/restore {username,password}（免鉴权）→ {restored}；**不签 token**，成功后用同一凭据再 /login
//   · 登录遇冷静期账号：200005 AccountPendingDeletion + data.delete_at（unix 毫秒）
// 无状态一次性请求，不碰 socket / 本地库（同 devicesApi 的口径）。
import { fetchEnvelope } from "./http";
import { friendlyMessage } from "./errcode";

export const CODE_ACCOUNT_PENDING_DELETION = 200005;

export interface OwnedGroup { conv_id: string; name: string }

export type AccountError = Error & { code?: number; ownedGroups?: OwnedGroup[]; deleteAt?: number };

export function accountError(code: number, message: string, data?: unknown): AccountError {
  const e = new Error(friendlyMessage(code, message)) as AccountError;
  e.code = code;
  const d = (data ?? {}) as { owned_groups?: unknown; delete_at?: unknown };
  if (Array.isArray(d.owned_groups)) {
    e.ownedGroups = (d.owned_groups as Partial<OwnedGroup>[])
      .filter((g) => !!g && typeof g.conv_id === "string")
      .map((g) => ({ conv_id: g.conv_id as string, name: g.name ?? "" }));
  }
  if (typeof d.delete_at === "number") e.deleteAt = d.delete_at;
  return e;
}

async function post(path: string, body: object, token?: string): Promise<void> {
  const res = await fetchEnvelope(path, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  });
  if (res.code !== 0) throw accountError(res.code, res.message ?? "", res.data);
}

/** 申请注销（进入 7 天冷静期，服务端吊销全部 session）。失败抛 AccountError（带 ownedGroups 即群主阻断）。 */
export const deleteAccount = (token: string, password: string): Promise<void> =>
  post("/api/v1/account/delete", { password }, token);

/** 冷静期内凭密码恢复。 */
export const restoreAccount = (username: string, password: string): Promise<void> =>
  post("/api/v1/account/restore", { username, password });

/** delete_at 可能是秒或毫秒：<1e12 视为秒。 */
export function deleteAtMs(v: number): number { return v < 1e12 ? v * 1000 : v; }
