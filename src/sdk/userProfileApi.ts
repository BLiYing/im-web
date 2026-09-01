// uid → 公开名片的**批量解析**接口（POST /api/v1/users/batch）。
//
// 与 `GET /users/{id}` 的区别只在吞吐：一屏群消息里可能有几十个不同发送者，
// 逐个查就是几十个请求。后端底层是同一个查询（store.GetUsersByIDs）。
//
// 为什么需要这条路：端上此前把「群成员表」当身份字典用（拿 uid 回查 members 取头像/昵称）。
// 超级群不下发成员表（2 万人，只发群主+管理员），普通群里退群者的历史消息同样查不到。
// Telegram 的对应物是 `users.getUsers`（配合每个响应自带的 users:Vector<User>）。
//
// 后端对应：IMServer/internal/profile/batch.go、cmd/imserver/handlers_profile.go。

import { callJson } from "./http";
import type { UserCard } from "./protocol";

/** 单次请求的 uid 上限，**必须 ≤ 后端 profile.MaxBatchProfiles**；超了整批被拒（100001）。 */
export const USER_BATCH_MAX = 100;

export interface UserProfileBatch {
  users: UserCard[];
  /** 查无此人的 uid（已注销 / 脏数据）。端上据此做负缓存，别反复重试。 */
  missing: string[];
}

/**
 * 批量解析 uid。调用方负责去重与切片（≤ USER_BATCH_MAX）；本函数只做一次往返。
 *
 * 名片口径同 `/users/search`：**不带 phone / 在线态 / remark**。
 * 备注要在结果之上由本地 remarks 覆盖（备注是本机私有数据，服务端不下发）。
 */
export async function fetchUserProfilesBatch(token: string, ids: string[]): Promise<UserProfileBatch> {
  const raw = (await callJson("/api/v1/users/batch", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ ids }),
  })) as { users?: UserCard[]; missing?: string[] };
  // 兜底成空数组：调用方会 .map / 展开进 state，拿到 undefined 就是白屏（同 fetchGroupMembersPage 的教训）。
  return { users: raw.users ?? [], missing: raw.missing ?? [] };
}
