// 两步验证的纯规则（无 React / 无网络）：输入清洗、恢复码归一、密钥分组、错误码 → 文案键、
// 状态页文案、离开拦截条件、恢复码文件内容。与 iOS / Android 同口径（设计 TWO_STEP_VERIFICATION_DESIGN §2/§5）。
import { TS_CODE } from "./sdk/twoStepApi";

type Translate = (key: string, params?: Record<string, string | number>) => string;

export const CODE_LEN = 6;
export const RECOVERY_LEN = 10;

/** 6 位动态码输入清洗：只留 ASCII 数字、截 6 位（「123 456」「123-456」粘贴都能还原）。 */
export function sanitizeCode6(raw: string): string {
  return raw.replace(/[^0-9]/g, "").slice(0, CODE_LEN);
}

/** 恢复码归一：小写、去连字符与所有空白（服务端同规则，大小写 / 连字符 / 空格不敏感）。只在提交时用，输入中不改写文本。 */
export function normalizeRecovery(raw: string): string {
  return raw.toLowerCase().replace(/[-\s]/g, "");
}

const RC = "[a-hj-km-np-z2-9]";
const RC_DASHED = new RegExp(`(?<![a-z0-9])(${RC}{5})-(${RC}{5})(?![a-z0-9])`, "i");
const RC_PLAIN = new RegExp(`(?<![a-z0-9])${RC}{10}(?![a-z0-9])`, "i");

/** 从粘贴的任意文本里取第一个恢复码，规整成 `xxxxx-xxxxx`；取不到返回 null。
 *  复制自「复制全部」的 10 行清单、带「1.」前缀、带首尾空白 / 换行的粘贴都能取到；优先认带连字符的形态。 */
export function extractRecoveryCode(text: string): string | null {
  const dashed = text.match(RC_DASHED);
  if (dashed) return `${dashed[1]}-${dashed[2]}`.toLowerCase();
  const plain = text.match(RC_PLAIN);
  return plain ? `${plain[0].slice(0, 5)}-${plain[0].slice(5)}`.toLowerCase() : null;
}

export type CodeMode = "code" | "recovery";

/** 当前输入是否可提交。 */
export function isCodeReady(mode: CodeMode, raw: string): boolean {
  return mode === "code" ? sanitizeCode6(raw).length === CODE_LEN : normalizeRecovery(raw).length === RECOVERY_LEN;
}

/** 提交给服务端的 code 字段：动态码取清洗后的 6 位，恢复码取归一形态。 */
export function codeForSubmit(mode: CodeMode, raw: string): string {
  return mode === "code" ? sanitizeCode6(raw) : normalizeRecovery(raw);
}

/** Base32 密钥按 4 位一组展示（大写，空格分隔）；复制时用 `secretForCopy`（同样分组，认证器接受空格）。 */
export function groupSecret(secret: string): string {
  const clean = secret.replace(/[\s-]/g, "").toUpperCase();
  return clean.replace(/(.{4})(?=.)/g, "$1 ");
}

export type ErrorScene = "password" | "bind" | "verify" | "login";

/** 业务码 → 文案键。undefined = 无专用文案（调用方退回服务端 message / 通用错误）。 */
export function twoStepErrorKey(code: number | undefined, scene: ErrorScene): string | undefined {
  switch (code) {
    case TS_CODE.wrongPassword: return "twostep.error.password_wrong";
    case TS_CODE.codeInvalid: return scene === "bind" ? "twostep.error.code_invalid" : "twostep.error.code_invalid_short";
    case TS_CODE.ticketInvalid: return scene === "login" ? "twostep.error.login_expired" : "twostep.error.expired";
    case TS_CODE.alreadyEnabled: return "twostep.error.already_enabled";
    case TS_CODE.unavailable: return "twostep.error.unavailable";
    case TS_CODE.notEnabled: return "twostep.error.not_enabled";
    case TS_CODE.rateLimited: return "twostep.error.rate_limited";
    default: return undefined;
  }
}

/** 登录第二步「还可尝试 N 次」：只在 1~2 次时提示（更多无需吓用户，0 次 ticket 已作废走 200022）。 */
export function attemptsLeftOf(data: unknown): number | null {
  const n = (data as { attempts_left?: unknown } | null | undefined)?.attempts_left;
  return typeof n === "number" && Number.isFinite(n) && n >= 1 && n <= 2 ? n : null;
}

/** 错误 → 展示文案。 */
export function twoStepErrorText(e: unknown, scene: ErrorScene, t: Translate): string {
  const err = e as { code?: number; data?: unknown; message?: string };
  if (err.code === TS_CODE.codeInvalid && scene === "login") {
    const left = attemptsLeftOf(err.data);
    if (left !== null) return t("twostep.error.attempts_left", { count: left });
  }
  const key = twoStepErrorKey(err.code, scene);
  return key ? t(key) : (err.message || t("net.error.cannot_connect"));
}

/** 隐私页那一行的右值：未加载 → 留空；失败按「关闭」处理由调用方在 catch 里置 false。 */
export function statusValue(enabled: boolean | null, t: Translate): string | undefined {
  if (enabled === null) return undefined;
  return t(enabled ? "twostep.status.on" : "twostep.status.off");
}

/** 剩余恢复码 ≤2 → 橙色 + footer 提示。 */
export function isRecoveryLow(remaining: number): boolean { return remaining <= 2; }

/** 状态页 footer：库存告急优先；其次「开启时没保存恢复码」。 */
export function statusFooterKey(remaining: number, unsaved: boolean): string | null {
  if (isRecoveryLow(remaining)) return "twostep.recovery.low_footer";
  return unsaved ? "twostep.recovery.unsaved_footer" : null;
}

/** 恢复码页：未勾选「我已保存」时，返回 / 关闭必须二次确认。 */
export function shouldBlockLeave(saved: boolean): boolean { return !saved; }

/** 「保存为文件」内容：头行 + 每行一个码。 */
export function recoveryFileText(codes: readonly string[], header: string): string {
  return `${header}\n\n${codes.join("\n")}\n`;
}

/** 「复制全部」内容：每行一个码。 */
export function recoveryCopyText(codes: readonly string[]): string { return codes.join("\n"); }
