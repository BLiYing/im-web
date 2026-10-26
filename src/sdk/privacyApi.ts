// 账号级隐私设置的 HTTP 读写（PROTOCOL §6.8.1 / §11；PRIVACY_VISIBILITY_DESIGN §2）：GET/PUT /api/v1/users/me/privacy。
// 对象字段：auto_delete_default_sec、last_seen_visibility、avatar_visibility。PUT 是**部分更新**：只带被改的那一项，
// 缺省=保持不变（别用一项覆盖另一项）。无状态一次性请求（同 contactApi）；不推帧，其它端改了靠重新进页刷新。
import { callJson } from "./http";

const PATH = "/api/v1/users/me/privacy";

/** 「谁能看到」三档。 */
export type Visibility = "everyone" | "contacts" | "nobody";
export const VISIBILITY_LEVELS: readonly Visibility[] = ["everyone", "contacts", "nobody"];
/** 服务端缺字段 / 脏值时的默认档（上次上线=contacts，头像=everyone，同服务端 LastSeenLevel/AvatarLevel）。 */
export const DEFAULT_LAST_SEEN: Visibility = "contacts";
export const DEFAULT_AVATAR: Visibility = "everyone";

/** 隐私设置的服务端对象（已解析为具体值）。 */
export interface PrivacySettings {
  autoDeleteSec: number;
  lastSeen: Visibility;
  avatar: Visibility;
}
/** PUT 入参：每项可缺省，至少给一项。 */
export interface PrivacyPatch {
  autoDeleteSec?: number;
  lastSeen?: Visibility;
  avatar?: Visibility;
}

/** 脏数据安全的档位解析：非三值 → fallback。 */
export function parseVisibility(v: unknown, fallback: Visibility): Visibility {
  return typeof v === "string" && (VISIBILITY_LEVELS as readonly string[]).includes(v) ? (v as Visibility) : fallback;
}

/** 把部分更新入参转成请求体：只含被给出的字段。 */
export function patchBody(p: PrivacyPatch): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  if (p.autoDeleteSec !== undefined) body.auto_delete_default_sec = p.autoDeleteSec;
  if (p.lastSeen !== undefined) body.last_seen_visibility = p.lastSeen;
  if (p.avatar !== undefined) body.avatar_visibility = p.avatar;
  return body;
}

/** 取全部隐私设置（缺字段按默认）。 */
export async function getPrivacy(token: string): Promise<PrivacySettings> {
  const data = await callJson(PATH, { headers: { Authorization: `Bearer ${token}` } });
  return {
    autoDeleteSec: Number(data?.auto_delete_default_sec) || 0,
    lastSeen: parseVisibility(data?.last_seen_visibility, DEFAULT_LAST_SEEN),
    avatar: parseVisibility(data?.avatar_visibility, DEFAULT_AVATAR),
  };
}

/** 部分更新；失败抛带 .code 的 Error（非法档位 100001）。 */
export async function putPrivacy(token: string, patch: PrivacyPatch): Promise<void> {
  await callJson(PATH, {
    method: "PUT",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(patchBody(patch)),
  });
}

/** 取账号「新会话默认」自动删除档位（秒；缺字段按 0）。 */
export async function getAutoDeleteDefault(token: string): Promise<number> {
  return (await getPrivacy(token)).autoDeleteSec;
}

/** 保存账号默认档位（只带该字段）；失败抛带 .code 的 Error（非白名单 100001）。 */
export function putAutoDeleteDefault(token: string, sec: number): Promise<void> {
  return putPrivacy(token, { autoDeleteSec: sec });
}
