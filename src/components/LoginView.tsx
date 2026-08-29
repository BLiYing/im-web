import { useEffect, useState } from "react";
import { QRLoginTab } from "../QRUI";

/**
 * 登录页（含恢复登录过渡态 + 密码/扫码两页签）。从 App.tsx 抽出的纯展示组件：
 * 状态与动作全部由 App 注入，JSX 与原实现逐字一致。
 */
export function LoginView({ restoring, uid, nickname, password, authErr, authBusy, loginTab, onUid, onNickname, onPassword, onLoginTab, onLogin, onRegister, onQRLogin }: {
  restoring: boolean;
  uid: string;      // 这里的 uid 实为 **username**（公开句柄）——登录接口只认它
  nickname: string; // 仅注册用：显示名
  password: string;
  authErr: string;
  authBusy: boolean;
  loginTab: "password" | "qr";
  onUid: (v: string) => void;
  onNickname: (v: string) => void;
  onPassword: (v: string) => void;
  onLoginTab: (t: "password" | "qr") => void;
  onLogin: (pwd: string) => void; // 密码登录（空串=免密）
  onRegister: () => void;
  onQRLogin: (uid: string, token: string) => void;
}) {
  // 哪个入口在转圈。三个按钮共用 App 的 authBusy，不记来源就会三个一起转。
  // **必须声明在 restoring 早退之前**——Hook 顺序不能被早退打断。
  const [busyAction, setBusyAction] = useState<"login" | "register" | "dev" | null>(null);
  useEffect(() => { if (!authBusy) setBusyAction(null); }, [authBusy]);
  const spinning = (action: "login" | "register" | "dev") => authBusy && busyAction === action;
  const label = (action: "login" | "register" | "dev", idle: string, busy: string) =>
    spinning(action) ? <><span className="btn-spinner" aria-hidden="true" />{busy}</> : <>{idle}</>;

  if (restoring) {
    // 恢复登录过渡态（Web #4）：有已存会话时不闪登录表单，静默重登成功直达主界面。
    return (
      <div className="login">
        <img className="login-logo" src="/im-logo.png" alt="" aria-hidden="true" />
        <h1>IM Web</h1>
        <p className="hint restoring-hint">正在恢复登录（{uid}）…</p>
      </div>
    );
  }
  return (
    <div className="login">
      <img className="login-logo" src="/im-logo.png" alt="" aria-hidden="true" />
      <h1>IM Web 登录</h1>
      <div className="login-tabs">
        <button className={`login-tab${loginTab === "password" ? " on" : ""}`} onClick={() => onLoginTab("password")}>密码登录</button>
        <button className={`login-tab${loginTab === "qr" ? " on" : ""}`} onClick={() => onLoginTab("qr")}>扫码登录</button>
      </div>
      {/* 鉴权失效原因（如被踢下线）在两个页签下都要可见——被踢时可能正停在扫码页。 */}
      {authErr && <p className="auth-err">{authErr}</p>}
      {loginTab === "password" ? (
        <>
          <label>用户名<input value={uid} autoFocus placeholder="a-z、0-9、下划线，≥5 位"
            onChange={(e) => onUid(e.target.value.trim())} /></label>
          {/* 昵称只在注册时用得到：它是别人看到的名字，可中文/emoji，与用户名规则完全不同。 */}
          <label>昵称<input value={nickname} placeholder="注册用，可中文，≤32 字"
            onChange={(e) => onNickname(e.target.value)} /></label>
          <label>密码<input type="password" value={password} placeholder="≥ 6 位"
            onChange={(e) => onPassword(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && password && !authBusy) { setBusyAction("login"); onLogin(password); } }} /></label>
          {/* 「登录」按钮强制要求密码非空——空密码只能走下方「免密登录」明示入口（且需后端 -dev-login），
              避免开发期免密开关下点「登录」变成静默走免密（iOS 端登录页也是这样，密码不填直接走不通）。 */}
          <button className="login-submit" disabled={authBusy || !password}
            onClick={() => { setBusyAction("login"); onLogin(password); }}>{label("login", "登录", "登录中…")}</button>
          <button className="login-submit secondary" disabled={authBusy}
            onClick={() => { setBusyAction("register"); onRegister(); }}>{label("register", "注册并登录", "注册中…")}</button>
          <p className="hint">
            真账号密码登录。先启动后端 <code>go run ./cmd/imserver</code>。<br />
            仅调试：<button className="link-inline" disabled={authBusy}
              onClick={() => { setBusyAction("dev"); onLogin(""); }}>{label("dev", "免密登录", "登录中…")}</button>（需后端开启 dev-login）。
          </p>
        </>
      ) : (
        <QRLoginTab onLogin={onQRLogin} />
      )}
    </div>
  );
}
