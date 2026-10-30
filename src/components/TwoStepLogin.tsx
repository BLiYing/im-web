import { useEffect, useState } from "react";
import { MessageCircle } from "lucide-react";
import { useT } from "../i18n";
import { isCodeReady } from "../twoStepRules";
import type { TwoStepLogin as TwoStepLoginApi } from "../useTwoStepLogin";
import { CodeInput, RecoveryInput } from "./CodeInput";

/** 登录二步页（同登录页内切换，沿用 `.login` 布局与 `.login-submit` / `.auth-err`）：
 *  6 位输满自动提交；错码清空并重新聚焦；「使用恢复码」切文本框；「返回」丢弃 ticket 回密码页。
 *  `onLogin` 触发 App 的 enterApp（pending 已由 hook 记下，connect 前取走）。 */
export function TwoStepLogin({ api, authBusy, onLogin }: { api: TwoStepLoginApi; authBusy: boolean; onLogin: () => void }) {
  const t = useT();
  const { view } = api;
  const [raw, setRaw] = useState("");
  useEffect(() => { setRaw(""); }, [view.clearTick]); // 错码 / 切模式：清空（其余表单一律不清）
  const go = (value: string) => { if (api.submit(value, view.mode)) onLogin(); };
  const recovery = view.mode === "recovery";
  return (
    <div className="login">
      <div className="login-logo-box" aria-hidden="true"><MessageCircle size={40} /></div>
      <h1 className="ts-login-title">{t("twostep.login.title")}</h1>
      <p className="ts-login-hint">{t(recovery ? "twostep.login.hint_recovery" : "twostep.login.hint")}</p>
      {recovery
        ? <RecoveryInput value={raw} onChange={setRaw} onSubmit={() => go(raw)} readOnly={authBusy} invalid={!!view.error} autoFocus focusKey={view.clearTick} label={t("twostep.field.recovery")} />
        : <CodeInput value={raw} onChange={setRaw} onComplete={go} readOnly={authBusy} invalid={!!view.error} autoFocus focusKey={view.clearTick} label={t("twostep.field.code")} />}
      {view.error && <p className="auth-err" role="alert">{view.error}</p>}
      {view.waitHint && <p className="ts-login-hint">{t("twostep.bind.wait_next")}</p>}
      {recovery && (
        <button className="login-submit" disabled={authBusy || !isCodeReady("recovery", raw)} onClick={() => go(raw)}>
          {authBusy ? <><span className="btn-spinner keep-anim" aria-hidden="true" />{t("login.submitting")}</> : t("twostep.login.submit")}
        </button>
      )}
      {!recovery && authBusy && <p className="ts-login-hint" role="status"><span className="btn-spinner keep-anim" aria-hidden="true" /> {t("login.submitting")}</p>}
      <button className="ts-login-link" disabled={authBusy} onClick={() => api.setMode(recovery ? "code" : "recovery")}>{t(recovery ? "twostep.use_code" : "twostep.use_recovery")}</button>
      {recovery && <p className="ts-login-hint">{t("twostep.login.no_recovery")}</p>}
      <button className="ts-login-link muted" disabled={authBusy} onClick={api.back}>{t("twostep.login.back")}</button>
    </div>
  );
}
