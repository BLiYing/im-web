// 账号级自动下载策略（M4-7）的 HTTP 读写。
//
// 与 serverConfigApi 同理：无状态一次性查询，不碰 socket 也不碰本地库，
// 挂在 IMClient 上只会让那个已超预算的文件继续长（CODING_STYLE §7）。
// IMClient 仍保留同名薄方法转调，调用方无需改动。

import { callJson } from "./http";

/** `{version, settings}`：version 用于与 capabilities_update 帧去重。 */
export interface DownloadSettingsResult {
  version: number;
  settings: unknown;
}

/** 拉当前策略；未设置过时后端回出厂默认（version=0）。 */
export async function fetchDownloadSettings(token: string): Promise<DownloadSettingsResult> {
  return (await callJson("/api/v1/download-settings", {
    headers: { Authorization: `Bearer ${token}` },
  })) as DownloadSettingsResult;
}

/**
 * 整体替换策略：后端规整（夹紧大小上限）+ bump 版本 + 推 capabilities_update 给本账号其它端。
 * 请求体**就是 settings 本身**（后端直接 Decode 进 downloadsettings.Settings），不要再包一层。
 */
export async function putDownloadSettings(token: string, settings: unknown): Promise<DownloadSettingsResult> {
  return (await callJson("/api/v1/download-settings", {
    method: "PUT",
    body: JSON.stringify(settings),
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
  })) as DownloadSettingsResult;
}
