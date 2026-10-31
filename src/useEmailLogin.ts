// 邮箱登录（设置侧）状态机：说明页 → 填邮箱 + 密码 → 验证码页 → 已绑定页；已绑定页 → 更换（同一表单页）/ 解绑密码页。
// 设计 IMServer/docs/design/EMAIL_LOGIN_DESIGN.md §2。挂在 SettingsPanelsHost（隐私页行右值要用）；换账号整体复位。
// 倒计时只存「截止时刻」，秒级重绘由面板里的 ResendButton 的 setInterval 负责（卸载即清），本 hook 不持有定时器。
// 日志纪律：验证码 / 密码 / 邮箱不进日志——只记业务码；密码仅存在 ref 里（重发要用），离开验证码页即清。
import { useCallback, useEffect, useRef, useState } from "react";
import { getLang, t } from "./i18n";
import { LOG_TAG, logger } from "./logging/logger";
import {
  EM_CODE, getEmailInfo, sendEmailCode, unbindEmail, verifyEmailCode,
  type EmailInfo, type EmailLang, type SendCodeResult,
} from "./sdk/emailApi";
import { RESEND_SECS, emailErrorText, isPlausibleEmail, resendDeadline, retryAfterSecOf, trimEmail } from "./emailRules";

type AskConfirm = (message: string, opts?: { title?: string; okText?: string; danger?: boolean }) => Promise<boolean>;

export type EmailFlow = "form" | "code" | "unbind";
export type EmailPage = EmailFlow | "loading" | "loadFailed" | "intro" | "bound";

export interface EmailApiLike {
  info: (token: string) => Promise<EmailInfo>;
  send: (token: string, p: { email: string; password: string; lang: EmailLang }) => Promise<SendCodeResult>;
  verify: (token: string, p: { email: string; code: string; lang: EmailLang }) => Promise<{ email: string; verifiedAt: number }>;
  unbind: (token: string, password: string) => Promise<void>;
}
const REAL_API: EmailApiLike = { info: getEmailInfo, send: sendEmailCode, verify: verifyEmailCode, unbind: unbindEmail };

export interface EmailLoginDeps {
  owner: string; // 当前账号 uid：变化即整体复位
  token: () => string;
  askConfirm: AskConfirm;
  setToast: (msg: string | null) => void;
  api?: EmailApiLike;
  now?: () => number;
}

export interface EmailLoginState {
  info: EmailInfo | null; // null = 尚未加载（或加载失败）
  page: EmailPage;
  email: string; // 表单里的邮箱（返回上一步保留）
  setEmail: (v: string) => void;
  sentTo: string; // 验证码已发往的邮箱
  busy: boolean;
  error: string;
  codeTick: number; // 错码 +1：验证码框据此清空并重聚焦
  resendTick: number; // 过期 +1：焦点回「重新发送」
  resendAt: number; // 可重发时刻（ms epoch；0 = 现在就能）
  refresh: () => Promise<void>;
  reset: () => void;
  start: () => void; // 说明页 / 已绑定页 → 表单
  back: () => void; // 表单 / 验证码 / 解绑页 → 上一步
  sendCode: (email: string, password: string) => Promise<void>;
  resend: () => Promise<void>;
  verify: (code: string) => Promise<void>;
  openUnbind: () => void;
  unbind: (password: string) => Promise<void>;
}

const lang = (): EmailLang => (getLang() === "en" ? "en" : "zh-Hans");

export function useEmailLogin(deps: EmailLoginDeps): EmailLoginState {
  const depsRef = useRef(deps); depsRef.current = deps;
  const api = () => depsRef.current.api ?? REAL_API;
  const nowMs = () => (depsRef.current.now ?? Date.now)();
  const [info, setInfo] = useState<EmailInfo | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [flow, setFlow] = useState<EmailFlow | null>(null);
  const [email, setEmail] = useState("");
  const [sentTo, setSentTo] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [codeTick, setCodeTick] = useState(0);
  const [resendTick, setResendTick] = useState(0);
  const [resendAt, setResendAt] = useState(0);
  const inFlight = useRef(false);
  const epoch = useRef(0); // 账号代：换账号后上个账号在途请求的回包一律丢弃
  const pwd = useRef(""); // 重发要再带一次当前密码；离开验证码页 / 成功 / 复位即清

  const softReset = useCallback(() => {
    setFlow(null); setError(""); setSentTo(""); setResendAt(0); pwd.current = "";
  }, []);
  /** 作废在途请求：回包一律丢弃（面板已关 / 已退一步 / 换了账号），释放占位。 */
  const invalidate = useCallback(() => { epoch.current++; inFlight.current = false; setBusy(false); }, []);
  const hardReset = useCallback(() => {
    invalidate(); setInfo(null); setLoadFailed(false); setEmail(""); softReset();
  }, [invalidate, softReset]);
  const closePanel = useCallback(() => { invalidate(); softReset(); }, [invalidate, softReset]); // 关面板：在途 send 回包不得再把页面切到验证码页 / 留下密码
  useEffect(() => { hardReset(); }, [deps.owner, hardReset]);

  const refresh = useCallback(async () => {
    const ep = epoch.current;
    try { const v = await api().info(depsRef.current.token()); if (ep === epoch.current) { setInfo(v); setLoadFailed(false); } }
    catch (e) { if (ep === epoch.current) { logger.warn(LOG_TAG.http, "email_info_failed", { code: (e as { code?: number }).code }); setLoadFailed(true); } }
  }, []);

  /** 一次一发 + busy + 错误文案外壳；返回 true=成功。 */
  const run = useCallback(async (fn: () => Promise<void>, onError?: (e: { code?: number; data?: unknown }) => void): Promise<boolean> => {
    if (inFlight.current) return false;
    const ep = epoch.current;
    inFlight.current = true; setBusy(true); setError("");
    try { await fn(); return true; }
    catch (e) {
      if (ep === epoch.current) {
        const err = e as { code?: number; data?: unknown };
        logger.warn(LOG_TAG.http, "email_request_failed", { code: err.code });
        setError(emailErrorText(e, t));
        const secs = retryAfterSecOf(err.data);
        if (secs !== null && (err.code === EM_CODE.rateLimited || err.code === EM_CODE.codeExpired)) setResendAt(resendDeadline(nowMs(), secs)); // 服务端口径重建倒计时
        onError?.(err);
      }
      return false;
    } finally { if (ep === epoch.current) { inFlight.current = false; setBusy(false); } }
  }, []);

  const doSend = useCallback(async (rawEmail: string, password: string, resending: boolean) => {
    const to = trimEmail(rawEmail);
    if (!isPlausibleEmail(to)) { setError(t("email.err.invalid")); return; } // 预检不过：不发请求，输入不清空
    if (!password) return;
    const ep = epoch.current;
    await run(async () => {
      const r = await api().send(depsRef.current.token(), { email: to, password, lang: lang() });
      if (ep !== epoch.current) return;
      pwd.current = password; setSentTo(to); setFlow("code");
      setResendAt(resendDeadline(nowMs(), r.resendAfter || RESEND_SECS));
    }, (e) => { if (resending && e.code === EM_CODE.wrongPassword) { pwd.current = ""; setFlow("form"); } }); // 重发时密码失效（别处改了）：回表单重填
  }, [run]);

  const sendCode = useCallback((e: string, p: string) => doSend(e, p, false), [doSend]);
  const resend = useCallback(() => doSend(sentTo, pwd.current, true), [doSend, sentTo]);

  const verify = useCallback(async (code: string) => {
    const ep = epoch.current;
    await run(async () => {
      const r = await api().verify(depsRef.current.token(), { email: sentTo, code, lang: lang() });
      if (ep !== epoch.current) { void refresh(); return; } // 回包时页面已关：服务端已绑定，重取一次让右值不陈旧
      setInfo((cur) => ({ available: cur?.available ?? true, bound: true, email: r.email, verifiedAt: r.verifiedAt || nowMs() }));
      softReset(); setEmail("");
      depsRef.current.setToast(t("email.toast.bound"));
    }, (e) => {
      if (e.code === EM_CODE.codeWrong) setCodeTick((n) => n + 1);
      else if (e.code === EM_CODE.codeExpired) { setCodeTick((n) => n + 1); setResendTick((n) => n + 1); }
    });
  }, [run, sentTo, softReset, refresh]);

  const unbind = useCallback(async (password: string) => {
    if (inFlight.current || !password) return;
    inFlight.current = true; // 确认弹窗期间也占位：连点不叠弹窗
    const ep = epoch.current;
    let ok = false;
    try { ok = await depsRef.current.askConfirm(t("email.unbind.body"), { title: t("email.unbind.confirm_title"), okText: t("email.action.unbind"), danger: true }); }
    finally { inFlight.current = false; }
    if (!ok || ep !== epoch.current) return; // 确认期间面板被关 / 换账号：不再发解绑
    await run(async () => {
      await api().unbind(depsRef.current.token(), password);
      if (ep !== epoch.current) { void refresh(); return; }
      setInfo((cur) => ({ available: cur?.available ?? true, bound: false, email: "", verifiedAt: 0 }));
      softReset();
      depsRef.current.setToast(t("email.toast.unbound"));
    }, (e) => { if (e.code === EM_CODE.notBound) { setInfo((cur) => cur && { ...cur, bound: false, email: "" }); setFlow(null); } });
  }, [run, softReset, refresh]);

  const back = useCallback(() => {
    invalidate(); setError(""); pwd.current = ""; // 退一步即放弃在途请求（含迟到的发码回包）
    setFlow((f) => (f === "code" ? "form" : null)); // 验证码页回表单（邮箱保留、密码清空），其余回根页
  }, [invalidate]);

  const page: EmailPage = flow ?? (info ? (info.bound ? "bound" : "intro") : loadFailed ? "loadFailed" : "loading");
  return {
    info, page, email, setEmail, sentTo, busy, error, codeTick, resendTick, resendAt, refresh,
    reset: closePanel,
    start: () => { setError(""); setFlow("form"); },
    back, sendCode, resend, verify,
    openUnbind: () => { setError(""); setFlow("unbind"); },
    unbind,
  };
}
