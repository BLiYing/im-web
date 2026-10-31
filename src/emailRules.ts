// 邮箱登录的纯规则（无 React / 无网络）：邮箱轻量预检、错误码 → 文案、重发倒计时、隐私页行右值。
// 与 iOS / Android 同口径（设计 EMAIL_LOGIN_DESIGN §2.2/§3.4/§5.3）。权威校验在服务端，这里只拦明显不对的。
import { EM_CODE, type EmailInfo } from "./sdk/emailApi";

type Translate = (key: string, params?: Record<string, string | number>) => string;

export const RESEND_SECS = 60;
export const EMAIL_MAX_LEN = 254;

/** 去首尾空白（服务端同样 TrimSpace）。提交与展示都用它的结果。 */
export function trimEmail(raw: string): string { return raw.trim(); }

/** 轻量预检：恰一个 @、@ 后有 .、无空白、总长 ≤254。入参应已 trim；空串不合规。 */
export function isPlausibleEmail(email: string): boolean {
  if (!email || email.length > EMAIL_MAX_LEN || /\s/.test(email)) return false;
  const at = email.indexOf("@");
  if (at <= 0 || at !== email.lastIndexOf("@")) return false;
  return email.slice(at + 1).includes(".");
}

const numField = (data: unknown, key: string): number | null => {
  const n = (data as Record<string, unknown> | null | undefined)?.[key];
  return typeof n === "number" && Number.isFinite(n) ? n : null;
};

/** 服务端给的「距可重发秒数」（100002 间隔类 / 200033）；没有返回 null，0 = 现在就能重发。 */
export function retryAfterSecOf(data: unknown): number | null {
  const n = numField(data, "retry_after_sec");
  return n === null ? null : Math.max(0, Math.ceil(n));
}

/** 错误 → 展示文案。无专用文案退回服务端 message / 通用网络错误。 */
export function emailErrorText(e: unknown, t: Translate): string {
  const err = (e ?? {}) as { code?: number; data?: unknown; message?: string };
  switch (err.code) {
    case EM_CODE.wrongPassword: return t("email.err.password");
    case EM_CODE.invalid: return t("email.err.invalid");
    case EM_CODE.taken: return t("email.err.taken");
    case EM_CODE.codeWrong: {
      const left = numField(err.data, "attempts_left");
      return left !== null && left <= 2 ? t("email.code.wrong_left", { n: Math.max(0, left) }) : t("email.code.wrong");
    }
    case EM_CODE.codeExpired: return t("email.code.expired");
    case EM_CODE.notBound: return t("email.err.not_bound");
    case EM_CODE.same: return t("email.err.same");
    case EM_CODE.unavailable: return t("email.err.unavailable");
    case EM_CODE.sendFailed: return t("email.err.send_failed");
    case EM_CODE.rateLimited: {
      const secs = retryAfterSecOf(err.data);
      return secs !== null && secs > 0 ? t("email.err.too_frequent_secs", { n: secs }) : t("email.err.too_frequent");
    }
    default: return err.message || t("net.error.cannot_connect");
  }
}

/** 重发截止时刻（ms epoch）。secs 非法/≤0 → 0（立即可重发）。 */
export function resendDeadline(now: number, secs: number): number {
  return Number.isFinite(secs) && secs > 0 ? now + Math.ceil(secs) * 1000 : 0;
}

/** 距重发还剩几秒（向上取整，≥0）。 */
export function resendRemaining(deadline: number, now: number): number {
  return deadline > now ? Math.ceil((deadline - now) / 1000) : 0;
}

/** 隐私页那一行的右值：未加载 → 留空；已绑定 → 邮箱；未绑定 → 「未绑定」。 */
export function emailRowValue(info: EmailInfo | null, t: Translate): string | undefined {
  if (!info) return undefined;
  return info.bound ? info.email : t("email.status.unbound");
}
