// 账号级隐私设置的 HTTP 读写（PROTOCOL §6.8.1）：GET/PUT /api/v1/users/me/privacy ↔ {auto_delete_default_sec}。
// 无状态一次性请求（同 contactApi）；不推帧，其它端改了靠重新进页刷新。PUT 必须带该字段，档位白名单 0/86400/604800/2592000。
import { callJson } from "./http";

const PATH = "/api/v1/users/me/privacy";

/** 取账号「新会话默认」自动删除档位（秒；缺字段按 0）。 */
export async function getAutoDeleteDefault(token: string): Promise<number> {
  const data = await callJson(PATH, { headers: { Authorization: `Bearer ${token}` } });
  return Number(data?.auto_delete_default_sec) || 0;
}

/** 保存账号默认档位；失败抛带 .code 的 Error（非白名单 100001）。 */
export async function putAutoDeleteDefault(token: string, sec: number): Promise<void> {
  await callJson(PATH, {
    method: "PUT",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ auto_delete_default_sec: sec }),
  });
}
