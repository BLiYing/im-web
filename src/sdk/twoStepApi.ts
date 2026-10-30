// 两步验证（TOTP + 恢复码）REST 契约（PROTOCOL §7.1，设计 IMServer/docs/design/TWO_STEP_VERIFICATION_DESIGN.md）。
//   GET  /users/me/two-step                  → {enabled, enabled_at?, recovery_remaining?}
//   POST /users/me/two-step/setup            {password} → {secret, otpauth_uri, expires_in}
//   POST /users/me/two-step/enable           {code} → {recovery_codes:[10]}（唯一一次明文）
//   POST /users/me/two-step/disable          {password, code}
//   POST /users/me/two-step/recovery-codes   {password, code} → {recovery_codes:[10]}
//   POST /login → 业务错误 200020 + data{ticket, methods, expires_in}；POST /login/two-step {ticket, code} → 登录成功体
// 业务错误 HTTP 400 但响应体仍是标准信封：错误对象保留 `.code` 与 `.data`（登录第二步的 attempts_left 在 data 里）。
// 日志纪律：验证码 / 密钥 / 恢复码 / ticket 不进日志——请求体经 logging/sanitize 脱敏，本模块自己不打日志。
import { callJson, fetchEnvelope } from "./http";
import { friendlyMessage } from "./errcode";

export const TS_CODE = {
  wrongPassword: 200002,
  rateLimited: 100002,
  required: 200020,
  codeInvalid: 200021,
  ticketInvalid: 200022,
  notEnabled: 200023,
  alreadyEnabled: 200024,
  unavailable: 200025,
} as const;

export type TwoStepError = Error & { code?: number; data?: unknown };

export interface TwoStepStatus { enabled: boolean; enabledAt: number; recoveryRemaining: number }
export interface TwoStepSetup { secret: string; otpauthUri: string; expiresIn: number }
export interface TwoStepChallenge { ticket: string; methods: string[]; expiresIn: number }
/** 第二步提交：随 connect 一次性带入（SDK 用完即弃）。 */
export interface TwoStepSubmit { ticket: string; code: string }
export interface LoginSuccess { token: string; uid: string; refreshToken: string }

const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);
const ms = (v: unknown): number => { const n = num(v); return n > 0 && n < 1e12 ? n * 1000 : n; };
const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
const json = (token: string) => ({ ...auth(token), "Content-Type": "application/json" });
const BASE = "/api/v1/users/me/two-step";

export function parseStatus(raw: unknown): TwoStepStatus {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  return { enabled: r.enabled === true, enabledAt: ms(r.enabled_at), recoveryRemaining: num(r.recovery_remaining) };
}

export function parseCodes(raw: unknown): string[] {
  const list = (raw as { recovery_codes?: unknown } | null)?.recovery_codes;
  const codes = Array.isArray(list) ? list.filter((c): c is string => typeof c === "string" && c.length > 0) : [];
  if (codes.length === 0) throw new Error("two-step: recovery_codes missing");
  return codes;
}

export function parseChallenge(raw: unknown): TwoStepChallenge | null {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  if (typeof r.ticket !== "string" || !r.ticket) return null;
  return {
    ticket: r.ticket,
    methods: Array.isArray(r.methods) ? r.methods.filter((m): m is string => typeof m === "string") : [],
    expiresIn: num(r.expires_in),
  };
}

/** 信封错误 → 带 code / data 的 Error（登录前的免鉴权路径用；已鉴权路径由 callJson 挂 data）。 */
export function twoStepError(code: number, message: string, data?: unknown): TwoStepError {
  const e = new Error(friendlyMessage(code, message)) as TwoStepError;
  e.code = code;
  if (data !== undefined) e.data = data;
  return e;
}

export const getTwoStepStatus = async (token: string): Promise<TwoStepStatus> =>
  parseStatus(await callJson(BASE, { headers: auth(token) }));

export async function setupTwoStep(token: string, password: string): Promise<TwoStepSetup> {
  const d = await callJson(`${BASE}/setup`, { method: "POST", headers: json(token), body: JSON.stringify({ password }) }) as Record<string, unknown> | null;
  if (!d || typeof d.secret !== "string" || typeof d.otpauth_uri !== "string") throw new Error("two-step: setup payload invalid");
  return { secret: d.secret, otpauthUri: d.otpauth_uri, expiresIn: num(d.expires_in) };
}

export async function enableTwoStep(token: string, code: string): Promise<string[]> {
  return parseCodes(await callJson(`${BASE}/enable`, { method: "POST", headers: json(token), body: JSON.stringify({ code }) }));
}

export async function disableTwoStep(token: string, p: { password: string; code: string }): Promise<void> {
  await callJson(`${BASE}/disable`, { method: "POST", headers: json(token), body: JSON.stringify(p) });
}

export async function regenerateRecoveryCodes(token: string, p: { password: string; code: string }): Promise<string[]> {
  return parseCodes(await callJson(`${BASE}/recovery-codes`, { method: "POST", headers: json(token), body: JSON.stringify(p) }));
}

/** 登录第二步：免鉴权。成功体与 /login 逐字段相同；失败抛带 code/data 的 Error。 */
export async function loginTwoStep(s: TwoStepSubmit): Promise<LoginSuccess> {
  const body = await fetchEnvelope<{ token?: string; uid?: string; refresh_token?: string }>("/api/v1/login/two-step", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ticket: s.ticket, code: s.code }),
  });
  if (body.code !== 0 || !body.data?.token || !body.data?.uid) throw twoStepError(body.code, body.message ?? "", body.data);
  return { token: body.data.token, uid: body.data.uid, refreshToken: body.data.refresh_token ?? "" };
}
