// 扫码登录（QR P1）Web 侧 HTTP 调用：申请票据 + 长轮询状态。
// 登录页未登录、无 IMClient/token，故为模块级函数（与 registerAccount 同源）。语义与状态机全在服务端
// （internal/qrcode/login.go）；本模块只封装两个免鉴权 REST，poll_key 只在 loginNew 响应里出现一次。
import { tracedFetch } from "./http";
import { friendlyMessage } from "./imSdk";
import type { QRLoginTicket, QRLoginPollResult } from "./protocol";

/** fetch + 解析统一响应信封（code!=0 抛带业务码的 Error）；传输层失败转友好中文。 */
async function call(path: string, init?: RequestInit): Promise<any> {
  let resp: Response;
  try {
    resp = await tracedFetch(path, init);
  } catch {
    throw new Error("无法连接服务器，请确认后端已启动");
  }
  let body: any;
  try {
    body = await resp.json();
  } catch {
    throw new Error("服务器无响应，请确认后端已启动");
  }
  if (body.code !== 0) {
    const err = new Error(friendlyMessage(body.code, body.message)) as Error & { code?: number };
    err.code = body.code; // 保留业务码（如 100002 限流），调用方据码分支
    throw err;
  }
  return body.data;
}

/** 申请一枚扫码登录票据（免鉴权）：→ {ticket,url,expires_at,poll_key}。 */
export async function loginNew(): Promise<QRLoginTicket> {
  return (await call("/api/v1/qr/login/new", { method: "POST" })) as QRLoginTicket;
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
  return (await call(`/api/v1/qr/login/poll?${qs.toString()}`)) as QRLoginPollResult;
}
