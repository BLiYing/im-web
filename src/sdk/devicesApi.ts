// 已登录设备 / 多设备管理（P2）的 HTTP 读写。
//
// 与 serverConfigApi / downloadSettingsApi / favoritesApi 同一类：无状态一次性请求，
// 不碰 socket 也不碰本地库。从 imSdk.ts 抽出来是为了让那个已达体量上限的文件
// 不再因为"又加一个 REST 接口"而长（CODING_STYLE §7）。
// IMClient 保留同名薄方法转调，调用方零改动。

import { callJson } from "./http";
import type { DeviceView } from "./protocol";

function auth(token: string, init?: RequestInit): RequestInit {
  return { ...init, headers: { Authorization: `Bearer ${token}` } };
}

/** 我的登录设备列表（本机置顶、在线优先）：GET /api/v1/devices。 */
export async function listDevices(token: string): Promise<DeviceView[]> {
  const data = await callJson("/api/v1/devices", auth(token));
  return (data?.devices ?? []) as DeviceView[];
}

/** 踢下线某设备（吊销 sid + 断活连接）：POST /api/v1/devices/{sid}/revoke。踢本机=退出登录。 */
export async function revokeDevice(token: string, sid: string): Promise<void> {
  await callJson(`/api/v1/devices/${encodeURIComponent(sid)}/revoke`, auth(token, { method: "POST" }));
}

/** 退出除本机外的所有设备（换密码后常见动作）：POST /api/v1/devices/revoke-others。 */
export async function revokeOtherDevices(token: string): Promise<void> {
  await callJson("/api/v1/devices/revoke-others", auth(token, { method: "POST" }));
}
