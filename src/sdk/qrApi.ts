// 二维码体系（QRCODE P0）的 HTTP 读写：名片码 / 群码 / 扫码解析。
//
// 与 devicesApi / favoritesApi 等同一类：无状态一次性请求，不碰 socket 也不碰本地库。
// IMClient 保留同名薄方法转调，调用方零改动。

import { callJson } from "./http";
import type { QRCard, QRResolved } from "./protocol";

function auth(token: string, init?: RequestInit): RequestInit {
  return {
    ...init,
    headers: { Authorization: `Bearer ${token}`, ...(init?.body ? { "Content-Type": "application/json" } : {}) },
  };
}

/** 我的名片码（懒生成，长期有效）。 */
export async function qrMyCard(token: string): Promise<QRCard> {
  return (await callJson("/api/v1/qr/me", auth(token))) as QRCard;
}

/** 重置名片码（旧码立即失效）。 */
export async function qrResetMyCard(token: string): Promise<QRCard> {
  return (await callJson("/api/v1/qr/me/reset", auth(token, { method: "POST" }))) as QRCard;
}

/** 群二维码（须成员；perm_invite=1 时仅群主/管理员；7 天内复用同一枚）。 */
export async function groupQR(token: string, convId: string): Promise<QRCard> {
  return (await callJson(`/api/v1/groups/${encodeURIComponent(convId)}/qr`, auth(token))) as QRCard;
}

/** 重置群码（群主/管理员）。 */
export async function groupQRReset(token: string, convId: string): Promise<QRCard> {
  return (await callJson(`/api/v1/groups/${encodeURIComponent(convId)}/qr/reset`,
    auth(token, { method: "POST" }))) as QRCard;
}

/** 扫码解析管道：raw=扫到的原文（URL 或裸 token）→ {kind, data}。失效码抛 200110。 */
export async function qrResolve(token: string, raw: string): Promise<QRResolved> {
  return (await callJson("/api/v1/qr/resolve",
    auth(token, { method: "POST", body: JSON.stringify({ raw }) }))) as QRResolved;
}
