// 超级群相关的 HTTP 接口（部署能力下发 + 群成员分页）。
//
// 单独成模块而不是挂在 IMClient 上：这两个都是**无状态的一次性查询**，不碰 socket、不碰本地库，
// 只需要一个 token。挂进 imSdk.ts 只会让那个已经超预算的文件继续长
// （CODING_STYLE §7），而它们与长连接生命周期毫无关系。
//
// 后端对应：IMServer/cmd/imserver/handlers_serverconfig.go、handlers_group.go。
// 设计见 IMServer/docs/design/SUPERGROUP_DESIGN.md §3.1 / §9。

import { callJson } from "./http";
import type { GroupMember, ServerConfig } from "./protocol";

/** 带 Bearer 的 GET（信封解包与业务码转文案由 callJson 统一负责）。 */
async function get<T>(token: string, path: string): Promise<T> {
  return (await callJson(path, { headers: { Authorization: `Bearer ${token}` } })) as T;
}

/**
 * 拉**部署级**能力/配额（超级群开关、群成员上限）。
 *
 * 与账号级的 `capabilities_update` 不是一回事：那个随账号走、多端同步；
 * 这个随部署走，同一部署下所有账号一致、本次会话内不会变，**登录后拉一次即可**。
 *
 * 用途：客户端**不得硬编码群成员上限**——它是部署配置（后端 `-max-group-members`），
 * 端上写死会导致提示与服务端实际拒绝的口径对不上（本仓就发生过：端上 500、后端已 2000）。
 */
export function fetchServerConfig(token: string): Promise<ServerConfig> {
  return get<ServerConfig>(token, "/api/v1/server-config");
}

/**
 * 群成员分页的一页。
 *
 * ⚠️ 服务端把成员数组放在 **`items`** 里（不是 `members`）——`GET /groups/{id}` 用 `members`，
 * 这个分页接口用 `items`，两者不同名。第一版照着直觉写成 `members`，结果拿到 `undefined`
 * 一路传进 React state，界面直接白屏（`undefined.map`）。这里解析时归一成 `members`，
 * 免得每个调用方各踩一次。
 */
export interface GroupMembersPage {
  members: GroupMember[];
  next_cursor: string;
  has_more: boolean;
}

/** 服务端原始返回（字段名以后端 handlers_group.go 为准）。 */
interface RawMembersPage {
  items?: GroupMember[];
  next_cursor?: string;
  has_more?: boolean;
}

/**
 * 群成员目录**分页 + 搜索**（G5-c）。超级群必须走这条——那时 `GET /groups/{id}` 的
 * `members` 只含我自己（2 万人约 2.5MB，服务端不再全量下发）。
 *
 * cursor 传上一页的 `next_cursor`，空=首页；q 为空则按 user_id 升序列全部。
 */
export async function fetchGroupMembersPage(
  token: string, convId: string, opts?: { cursor?: string; limit?: number; q?: string },
): Promise<GroupMembersPage> {
  const qs = new URLSearchParams();
  if (opts?.cursor) qs.set("cursor", opts.cursor);
  if (opts?.limit) qs.set("limit", String(opts.limit));
  if (opts?.q) qs.set("q", opts.q);
  const suffix = qs.toString() ? `?${qs}` : "";
  const raw = await get<RawMembersPage>(token, `/api/v1/groups/${encodeURIComponent(convId)}/members${suffix}`);
  // 兜底成空数组：调用方会把它塞进 state 再 .map，拿到 undefined 就是白屏。
  return { members: raw.items ?? [], next_cursor: raw.next_cursor ?? "", has_more: !!raw.has_more };
}
