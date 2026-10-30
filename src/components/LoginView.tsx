import { useEffect, useState } from "react";
import { MessageCircle } from "lucide-react";
import { QRLoginTab } from "../QRUI";
import { useT } from "../i18n";
import { TwoStepLogin } from "./TwoStepLogin";
import type { TwoStepLogin as TwoStepLoginApi } from "../useTwoStepLogin";

/**
 * 登录页（含恢复登录过渡态 + 登录/注册/扫码三页签（结构对齐 Android，扫码为 Web 独有））。从 App.tsx 抽出的纯展示组件：
 * 状态与动作全部由 App 注入，JSX 与原实现逐字一致。
 */
export function LoginView({ restoring, uid, nickname, password, authErr, authNotice, onInput, authBusy, loginTab, onUid, onNickname, onPassword, onLoginTab, onLogin, onRegister, onQRLogin, twoStep }: {
  restoring: boolean;
  uid: string;      // 这里的 uid 实为 **username**（公开句柄）——登录接口只认它
  nickname: string; // 仅注册用：显示名
  password: string;
  authErr: string;
  authNotice?: string; // 非红通知的 i18n 键（如注销成功）；与 authErr 互斥
  onInput?: () => void; // 用户改动任一输入框：清掉通知
  authBusy: boolean;
  loginTab: "password" | "register" | "qr";
  onUid: (v: string) => void;
  onNickname: (v: string) => void;
  onPassword: (v: string) => void;
  onLoginTab: (t: "password" | "register" | "qr") => void;
  onLogin: (pwd: string) => void; // 密码登录（空串=免密）
  onRegister: () => void;
  onQRLogin: (uid: string, token: string, refreshToken: string) => void;
  twoStep?: TwoStepLoginApi; // 登录二步页状态（useTwoStepLogin）；active 时整页换成二步表单
}) {
  const tr = useT();
  // 哪个入口在转圈。三个按钮共用 App 的 authBusy，不记来源就会三个一起转。
  // **必须声明在 restoring 早退之前**——Hook 顺序不能被早退打断。
  const [busyAction, setBusyAction] = useState<"login" | "register" | "dev" | null>(null);
  useEffect(() => { if (!authBusy) setBusyAction(null); }, [authBusy]);
  const spinning = (action: "login" | "register" | "dev") => authBusy && busyAction === action;
  const label = (action: "login" | "register" | "dev", idle: string, busy: string) =>
    spinning(action) ? <><span className="btn-spinner keep-anim" aria-hidden="true" />{busy}</> : <>{idle}</>;

  if (restoring) {
    // 恢复登录过渡态（Web #4）：有已存会话时不闪登录表单，静默重登成功直达主界面。
    return (
      <div className="login">
        <div className="login-logo-box" aria-hidden="true"><MessageCircle size={40} /></div>
        <h1>IM Web</h1>
        {/* uid 这个 prop 实为 username（见类型注释）；即便如此也别在恢复提示里显身份，简洁即可。 */}
        <p className="hint restoring-hint">{tr("login.restoring")}</p>
      </div>
    );
  }
  if (twoStep?.view.active) return <TwoStepLogin api={twoStep} authBusy={authBusy} onLogin={() => onLogin(password)} />;
  return (
    <div className="login">
      <div className="login-logo-box" aria-hidden="true"><MessageCircle size={40} /></div>
      <h1>{tr("web.login.title")}</h1>
      <div className="login-tabs">
        <button className={`login-tab${loginTab === "password" ? " on" : ""}`} onClick={() => onLoginTab("password")}>{tr("login.tab_password")}</button>
        <button className={`login-tab${loginTab === "register" ? " on" : ""}`} onClick={() => onLoginTab("register")}>{tr("login.tab_register")}</button>
        <button className={`login-tab${loginTab === "qr" ? " on" : ""}`} onClick={() => onLoginTab("qr")}>{tr("login.tab_qr")}</button>
      </div>
      {/* 鉴权失效原因（如被踢下线）在两个页签下都要可见——被踢时可能正停在扫码页。 */}
      {authErr && <p className="auth-err">{authErr}</p>}
      {!authErr && authNotice && <p className="auth-info">{tr(authNotice)}</p>} {/* 注销成功提示：非红（设计 §3.4），存键随语言重译 */}
      {loginTab !== "qr" ? (
        <>
          <label>{tr("settings.info.username")}<input value={uid} autoFocus placeholder={loginTab === "register" ? tr("web.login.username_placeholder") : undefined}
            onChange={(e) => { onInput?.(); onUid(e.target.value.trim()); }} /></label>
          <label>{tr("login.password")}<input type="password" value={password} placeholder={loginTab === "register" ? tr("web.login.password_placeholder") : undefined}
            onChange={(e) => { onInput?.(); onPassword(e.target.value); }}
            onKeyDown={(e) => {
              if (e.key !== "Enter" || !password || authBusy) return;
              if (loginTab === "password") { setBusyAction("login"); onLogin(password); }
              else if (nickname.trim()) { setBusyAction("register"); onRegister(); }
            }} /></label>
          {/* 昵称只在注册页签出现：它是别人看到的名字，可中文/emoji，与用户名规则完全不同。 */}
          {loginTab === "register" && <>
            <label>{tr("login.nickname")}<input value={nickname} placeholder={tr("web.login.nickname_placeholder")}
              onChange={(e) => { onInput?.(); onNickname(e.target.value); }} /></label>
            <p className="hint">{tr("login.register_format_hint")}</p>
          </>}
          {/* 「登录」按钮强制要求密码非空——空密码只能走「免密登录」明示入口（且需后端 -dev-login），
              避免开发期免密开关下点「登录」变成静默走免密。 */}
          {loginTab === "password" ? (
            <button className="login-submit" disabled={authBusy || !password}
              onClick={() => { setBusyAction("login"); onLogin(password); }}>{label("login", tr("login.button.login"), tr("login.submitting"))}</button>
          ) : (
            <button className="login-submit" disabled={authBusy || !uid || !password || !nickname.trim()}
              onClick={() => { setBusyAction("register"); onRegister(); }}>{label("register", tr("login.button.register"), tr("login.registering"))}</button>
          )}
          {/* 开发期入口：只在 vite dev 显示（对应 Android 仅 debug 包显示），生产构建不带。 */}
          {import.meta.env.DEV && loginTab === "password" && (
            <button className="login-submit secondary" disabled={authBusy || !uid}
              onClick={() => { setBusyAction("dev"); onLogin(""); }}>{label("dev", tr("login.dev_login"), tr("login.submitting"))}</button>
          )}
        </>
      ) : (
        <QRLoginTab onLogin={onQRLogin} />
      )}
    </div>
  );
}
