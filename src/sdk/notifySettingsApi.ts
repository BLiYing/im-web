// 账号级通知设置（M5）的 HTTP 读写。PROTOCOL.md §6.13 / §11、PUSH_M5_DESIGN.md §3.3。
//
// 与 downloadSettingsApi 同理：无状态一次性查询，不碰 socket 也不碰本地库，挂在 IMClient 上只会让
// 那个已超预算的文件继续长（CODING_STYLE §7）。IMClient 仍保留同名薄方法转调，调用方无需改动。
//
// 只覆盖 private/group/badge.include_muted 这三项——inApp.*/desktop.* 仍是每设备本地，不上这个接口
// （见 src/notifySettingsSync.ts 的 AccountNotifyFields，只挑这三项出来）。

import { callJson } from "./http";
import type { NotifySettingsWire } from "../notifySettingsSync";

/** `{version, exists, settings}`：exists=false 表示服务端还没有这份设置（settings 是默认值，version=0）。 */
export interface NotifySettingsResult {
  version: number;
  exists: boolean;
  settings: unknown;
}

/** 拉账号级通知设置；未设置过时 exists=false + 默认值。 */
export async function fetchNotifySettings(token: string): Promise<NotifySettingsResult> {
  return (await callJson("/api/v1/notify-settings", {
    headers: { Authorization: `Bearer ${token}` },
  })) as NotifySettingsResult;
}

/**
 * 整体替换：后端规整（未知 sound → default）+ bump 版本 + 推 notify_settings_update 给本账号其它端。
 * 请求体按 PROTOCOL §11 包一层 `{settings}`（与 GET 响应同形；iOS/Android 也这样发）——
 * 与 downloadSettingsApi 的「body 就是 settings 本身」**不同**，别照那边改回去。
 */
export async function putNotifySettings(token: string, settings: NotifySettingsWire): Promise<NotifySettingsResult> {
  return (await callJson("/api/v1/notify-settings", {
    method: "PUT",
    body: JSON.stringify({ settings }),
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
  })) as NotifySettingsResult;
}
