import { useEffect, useRef, useState } from "react";
import { ChevronRight, Mail } from "lucide-react";
import { useT } from "../../i18n";
import { fullDate } from "../../time";
import { isCodeReady } from "../../twoStepRules";
import { resendRemaining } from "../../emailRules";
import type { EmailLoginState } from "../../useEmailLogin";
import { CodeInput } from "../CodeInput";
import { SubPanel } from "./SubPanel";
import "../twoStep.css";

/** 邮箱登录二级页（隐私与安全 ▸ 账号保护 ▸ 邮箱登录）：按状态机 `page` 在同一个面板里切页。
 *  状态与网络全在 useEmailLogin（挂在 SettingsPanelsHost）；本组件只做路由与各页展示。设计 EMAIL_LOGIN_DESIGN §2/§5.3。 */
export function EmailLoginPanel({ s, onClose }: { s: EmailLoginState; onClose: () => void }) {
  const t = useT();
  const title = s.page === "form" ? t(s.info?.bound ? "email.action.change" : "email.action.bind")
    : s.page === "code" ? t("email.code.title") : s.page === "unbind" ? t("email.action.unbind") : t("email.title");
  const back = () => { if (s.page === "form" || s.page === "code" || s.page === "unbind") s.back(); else onClose(); };
  return (
    <SubPanel className="twostep-panel" title={title} onBack={back}>
      {s.page === "loading" && <div className="settings-foot" role="status" aria-label={t("common.loading")}><span className="btn-spinner keep-anim" aria-hidden="true" /></div>}
      {s.page === "loadFailed" && (
        <div className="pwd-actions"><button className="mini-btn wide" onClick={() => void s.refresh()}>{t("common.retry")}</button></div>
      )}
      {s.page === "intro" && <IntroPage s={s} />}
      {s.page === "form" && <FormPage s={s} />}
      {s.page === "code" && <CodePage s={s} />}
      {s.page === "bound" && <BoundPage s={s} />}
      {s.page === "unbind" && <UnbindPage s={s} />}
    </SubPanel>
  );
}

function Busy({ on }: { on: boolean }) { return on ? <span className="btn-spinner keep-anim" aria-hidden="true" /> : null; }

function IntroPage({ s }: { s: EmailLoginState }) {
  const t = useT();
  const off = s.info?.available === false;
  return (
    <>
      <div className="ts-hero"><Mail size={48} aria-hidden="true" /><h3>{t("email.title")}</h3><p>{t("email.intro")}</p>
        {off && <p className="email-unavail">{t("email.unavailable")}</p>}</div>
      <div className="pwd-actions"><button className="mini-btn wide" disabled={off} onClick={s.start}>{t("email.action.bind")}</button></div>
    </>
  );
}

/** ② 邮箱 + 当前密码（绑定 / 更换同页）。错误一律不清空输入。 */
function FormPage({ s }: { s: EmailLoginState }) {
  const t = useT();
  const [pwd, setPwd] = useState("");
  const changing = !!s.info?.bound;
  const go = () => { if (!s.busy && pwd) void s.sendCode(s.email, pwd); };
  return (
    <>
      <form noValidate onSubmit={(e) => e.preventDefault()}>{/* noValidate：不要浏览器原生校验气泡，格式提示统一走 .pwd-error */}
      <div className="settings-group edit-fields">
        <label className="edit-field"><span>{t("email.field.email")}</span>
          <input type="email" autoComplete="email" autoCapitalize="off" spellCheck={false} autoFocus value={s.email} readOnly={s.busy}
            onChange={(e) => s.setEmail(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && !e.nativeEvent.isComposing) go(); }} /></label>
        <label className="edit-field"><span>{t("email.field.password")}</span>
          <input type="password" autoComplete="current-password" value={pwd} readOnly={s.busy}
            onChange={(e) => setPwd(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && !e.nativeEvent.isComposing) go(); }} /></label>
      </div>
      </form>
      {s.error && <div className="pwd-error" role="alert">{s.error}</div>}
      <div className="settings-foot">{t(changing ? "email.change.footer" : "email.bind.footer")}</div>
      <div className="pwd-actions">
        <button className="mini-btn wide" disabled={!pwd || s.busy} onClick={go}><Busy on={s.busy} />{t("email.action.send_code")}</button>
      </div>
    </>
  );
}

/** 「重新发送」：倒计时中灰置 `重新发送（59s）`；setInterval 只在有剩余秒时存在，卸载 / 归零即清。 */
function ResendButton({ s }: { s: EmailLoginState }) {
  const t = useT();
  const [now, setNow] = useState(() => Date.now());
  const ref = useRef<HTMLButtonElement>(null);
  const left = resendRemaining(s.resendAt, now);
  useEffect(() => {
    setNow(Date.now());
    if (resendRemaining(s.resendAt, Date.now()) <= 0) return;
    const id = setInterval(() => {
      const n = Date.now(); setNow(n);
      if (resendRemaining(s.resendAt, n) <= 0) clearInterval(id);
    }, 1000);
    return () => clearInterval(id);
  }, [s.resendAt]);
  useEffect(() => { if (s.resendTick > 0 && left === 0) ref.current?.focus(); }, [s.resendTick, left]);
  return (
    <button ref={ref} className="ts-link" disabled={left > 0 || s.busy} onClick={() => void s.resend()}>
      {left > 0 ? t("email.code.resend_wait", { n: left }) : t("email.code.resend")}
    </button>
  );
}

/** ③ 6 位验证码（复用两步验证的 CodeInput：组词期间不过滤）；满 6 位自动提交，错码清空重聚焦。 */
function CodePage({ s }: { s: EmailLoginState }) {
  const t = useT();
  const [code, setCode] = useState("");
  useEffect(() => { if (s.codeTick > 0) setCode(""); }, [s.codeTick]);
  const submit = (v: string) => { if (!s.busy && isCodeReady("code", v)) void s.verify(v); };
  return (
    <>
      <div className="settings-foot">{t("email.code.sent_to", { email: s.sentTo })}</div>
      <div className="settings-group edit-fields">
        <label className="edit-field"><span>{t("twostep.field.code")}</span>
          <CodeInput value={code} onChange={setCode} onComplete={submit} readOnly={s.busy} invalid={!!s.error} autoFocus focusKey={s.codeTick} label={t("twostep.field.code")} />
        </label>
      </div>
      {s.error && <div className="pwd-error" role="alert">{s.error}</div>}
      <div className="settings-foot" style={{ textAlign: "center" }}>
        <ResendButton s={s} /> · <button className="ts-link" onClick={s.back}>{t("email.action.change")}</button>
      </div>
    </>
  );
}

function BoundPage({ s }: { s: EmailLoginState }) {
  const t = useT();
  const info = s.info!;
  return (
    <>
      <div className="ts-hero"><Mail size={48} aria-hidden="true" /><h3 className="email-addr">{info.email}</h3>
        {info.verifiedAt > 0 && <p>{t("email.bound.since", { date: fullDate(new Date(info.verifiedAt)) })}</p>}</div>
      <div className="settings-group">
        <button className="settings-row" onClick={s.start}>
          <span className="row-label">{t("email.action.change")}</span><ChevronRight size={18} className="row-chevron" />
        </button>
        <button className="settings-row danger ts-center" onClick={s.openUnbind}>{t("email.action.unbind")}</button>
      </div>
      <div className="settings-foot">{t("email.bound.footer")}</div>
    </>
  );
}

function UnbindPage({ s }: { s: EmailLoginState }) {
  const t = useT();
  const [pwd, setPwd] = useState("");
  const go = () => { if (pwd && !s.busy) void s.unbind(pwd); };
  return (
    <>
      <div className="settings-group edit-fields">
        <label className="edit-field"><span>{t("email.field.password")}</span>
          <input type="password" autoComplete="current-password" autoFocus value={pwd} readOnly={s.busy}
            onChange={(e) => setPwd(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && !e.nativeEvent.isComposing) go(); }} /></label>
      </div>
      {s.error && <div className="pwd-error" role="alert">{s.error}</div>}
      <div className="pwd-actions">
        <button className="mini-btn wide danger" disabled={!pwd || s.busy} onClick={go}><Busy on={s.busy} />{t("email.action.unbind")}</button>
      </div>
    </>
  );
}
