// 邮箱登录 REST 契约（PROTOCOL §7.2，设计 IMServer/docs/design/EMAIL_LOGIN_DESIGN.md §3.3）。
//   GET  /users/me/email                → {available, bound, email?, verified_at?}
//   POST /users/me/email/send-code      {email, password, lang} → {expires_in, resend_after}
//   POST /users/me/email/verify         {email, code, lang} → {email, verified_at}
//   POST /users/me/email/unbind         {password} → {ok:true}
// 业务错误经 callJson 抛出，保留 `.code` 与 `.data`（attempts_left / retry_after_sec 在 data 里）。
// 日志纪律：验证码 / 密码不进日志——请求体经 logging/sanitize 脱敏（password、字符串 code），本模块自己不打日志。
import { callJson } from "./http";

export const EM_CODE = {
  rateLimited: 100002,
  wrongPassword: 200002,
  invalid: 200030,
  taken: 200031,
  codeWrong: 200032,
  codeExpired: 200033,
  notBound: 200034,
  same: 200035,
  unavailable: 200036,
  sendFailed: 200037,
} as const;

export type EmailLang = "en" | "zh-Hans";
export interface EmailInfo { available: boolean; bound: boolean; email: string; verifiedAt: number }
export interface SendCodeResult { expiresIn: number; resendAfter: number }

const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);
const ms = (v: unknown): number => { const n = num(v); return n > 0 && n < 1e12 ? n * 1000 : n; };
const json = (token: string) => ({ Authorization: `Bearer ${token}`, "Content-Type": "application/json" });
const BASE = "/api/v1/users/me/email";
const obj = (raw: unknown): Record<string, unknown> => (raw && typeof raw === "object" ? raw as Record<string, unknown> : {});

export function parseEmailInfo(raw: unknown): EmailInfo {
  const r = obj(raw);
  const email = typeof r.email === "string" ? r.email : "";
  return { available: r.available === true, bound: r.bound === true && email !== "", email, verifiedAt: ms(r.verified_at) };
}

export const getEmailInfo = async (token: string): Promise<EmailInfo> =>
  parseEmailInfo(await callJson(BASE, { headers: { Authorization: `Bearer ${token}` } }));

export async function sendEmailCode(token: string, p: { email: string; password: string; lang: EmailLang }): Promise<SendCodeResult> {
  const d = obj(await callJson(`${BASE}/send-code`, { method: "POST", headers: json(token), body: JSON.stringify(p) }));
  return { expiresIn: num(d.expires_in), resendAfter: num(d.resend_after) };
}

export async function verifyEmailCode(token: string, p: { email: string; code: string; lang: EmailLang }): Promise<{ email: string; verifiedAt: number }> {
  const d = obj(await callJson(`${BASE}/verify`, { method: "POST", headers: json(token), body: JSON.stringify(p) }));
  return { email: typeof d.email === "string" ? d.email : p.email, verifiedAt: ms(d.verified_at) };
}

export async function unbindEmail(token: string, password: string): Promise<void> {
  await callJson(`${BASE}/unbind`, { method: "POST", headers: json(token), body: JSON.stringify({ password }) });
}
