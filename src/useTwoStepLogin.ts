// 登录二步页状态（App 只接线）：密码登录遇 200020 → 记下 ticket（只在内存）→ 用户输码 → 把 {ticket, code} 一次性交给下一次 enterApp。
// 设计 IMServer/docs/design/TWO_STEP_VERIFICATION_DESIGN.md §2.3。流程：
//   enterApp 的 catch 先问 `intercept(e)`：200020 → 进二步页；二步请求在途时的 200021/200022/限流/网络错 → 本 hook 接管文案并返回 true。
//   二步页提交 `submit()` 记下 pending，随后 LoginView 调 onLogin → enterApp 在 connect 前 `take()` 取走 pending。
// 日志纪律：ticket / 验证码 / 恢复码不进日志；本文件不打日志。
import { useCallback, useEffect, useRef, useState } from "react";
import { t } from "./i18n";
import { TS_CODE, parseChallenge, type TwoStepSubmit } from "./sdk/twoStepApi";
import { codeForSubmit, isCodeReady, twoStepErrorText, type CodeMode } from "./twoStepRules";

export interface TwoStepLoginView {
  active: boolean;
  mode: CodeMode;
  error: string;
  /** 码错过一次：提示「等认证器刷新后输入新的验证码」（刚用某个码开启 / 登录过，同一个 30 秒窗口里不能再用）。 */
  waitHint: boolean;
  /** 每次错码 +1：输入框据此清空并重新聚焦。 */
  clearTick: number;
}

const IDLE: TwoStepLoginView = { active: false, mode: "code", error: "", waitHint: false, clearTick: 0 };

export function useTwoStepLogin(deps: { phase: string; setAuthErr: (msg: string) => void }) {
  const [view, setView] = useState<TwoStepLoginView>(IDLE);
  const ticket = useRef<string | null>(null);
  const pending = useRef<TwoStepSubmit | null>(null);
  const inFlight = useRef(false);
  const setAuthErr = useRef(deps.setAuthErr); setAuthErr.current = deps.setAuthErr;

  const reset = useCallback(() => { ticket.current = null; pending.current = null; inFlight.current = false; setView(IDLE); }, []);
  useEffect(() => { if (deps.phase !== "login") reset(); }, [deps.phase, reset]);

  /** 提交：输入满足条件才记 pending；返回 true 表示调用方可以触发登录。 */
  const submit = useCallback((raw: string, mode: CodeMode): boolean => {
    if (!ticket.current || inFlight.current || !isCodeReady(mode, raw)) return false;
    pending.current = { ticket: ticket.current, code: codeForSubmit(mode, raw) };
    inFlight.current = true;
    setView((v) => ({ ...v, error: "" }));
    return true;
  }, []);

  /** enterApp 在 connect 前取走（一次性）。 */
  const take = useCallback((): TwoStepSubmit | undefined => {
    const p = pending.current ?? undefined; pending.current = null; return p;
  }, []);

  /** enterApp 失败时先问：true = 本 hook 已处理（调用方只需收尾 busy，别再显示通用登录错误）。 */
  const intercept = useCallback((e: unknown): boolean => {
    const err = e as { code?: number; data?: unknown };
    if (err.code === TS_CODE.required) {
      const ch = parseChallenge(err.data);
      if (!ch) return false;
      ticket.current = ch.ticket; inFlight.current = false;
      setView({ ...IDLE, active: true });
      return true;
    }
    if (!inFlight.current) return false;
    inFlight.current = false;
    if (err.code === TS_CODE.ticketInvalid) { // ticket 过期 / 用完 / 错满：回密码页并说明
      reset();
      setAuthErr.current(t("twostep.error.login_expired"));
      return true;
    }
    const wrong = err.code === TS_CODE.codeInvalid;
    setView((v) => ({ ...v, error: twoStepErrorText(e, "login", t), waitHint: wrong && v.mode === "code", clearTick: wrong || v.mode === "code" ? v.clearTick + 1 : v.clearTick })); // 动态码模式没有提交钮（输满即交），网络 / 限流失败后也清空重输，否则满 6 位的旧码无法再次提交
    return true;
  }, [reset]);

  const back = useCallback(() => { reset(); setAuthErr.current(""); }, [reset]);
  const setMode = useCallback((mode: CodeMode) => setView((v) => ({ ...v, mode, error: "", waitHint: false, clearTick: v.clearTick + 1 })), []);

  return { view, submit, take, intercept, back, setMode };
}

export type TwoStepLogin = ReturnType<typeof useTwoStepLogin>;
