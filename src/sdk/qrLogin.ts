// 扫码登录（QR P1）Web 侧 HTTP 调用：申请票据 + 长轮询状态。
// 登录页未登录、无 IMClient/token，故为模块级函数（与 registerAccount 同源）。语义与状态机全在服务端
// （internal/qrcode/login.go）；本模块只封装两个免鉴权 REST，poll_key 只在 loginNew 响应里出现一次。
import { callJson } from "./http";
import { platform } from "../platform";
import type { QRLoginTicket, QRLoginPollResult } from "./protocol";

/** 申请一枚扫码登录票据（免鉴权）：→ {ticket,url,expires_at,poll_key}。
 *  带上本机稳定 device_id：确认登录后服务端按 (uid,device_id) 登记会话，同一浏览器重复扫码登录顶替去重。 */
export async function loginNew(): Promise<QRLoginTicket> {
  return (await callJson("/api/v1/qr/login/new", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ device_id: platform().deviceId() }),
  })) as QRLoginTicket;
}

/**
 * 长轮询票据状态（免鉴权，须 poll_key）：state 相对 sinceState 一变即返回，否则服务端最多等 ~25s。
 * confirmed 首次领取时一次性下发 token（随后转 consumed，再拉不到 token）。
 */
export async function loginPoll(
  ticket: string,
  pollKey: string,
  sinceState: string,
): Promise<QRLoginPollResult> {
  const qs = new URLSearchParams({ ticket, poll_key: pollKey, state: sinceState });
  return (await callJson(`/api/v1/qr/login/poll?${qs.toString()}`)) as QRLoginPollResult;
}
