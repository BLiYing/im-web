import { QRLoginTab } from "../QRUI";

/**
 * 登录页（含恢复登录过渡态 + 密码/扫码两页签）。从 App.tsx 抽出的纯展示组件：
 * 状态与动作全部由 App 注入，JSX 与原实现逐字一致。
 */
export function LoginView({ restoring, uid, password, authErr, authBusy, loginTab, onUid, onPassword, onLoginTab, onLogin, onRegister, onQRLogin }: {
  restoring: boolean;
  uid: string;
  password: string;
  authErr: string;
  authBusy: boolean;
  loginTab: "password" | "qr";
  onUid: (v: string) => void;
  onPassword: (v: string) => void;
  onLoginTab: (t: "password" | "qr") => void;
  onLogin: (pwd: string) => void; // 密码登录（空串=免密）
  onRegister: () => void;
  onQRLogin: (uid: string, token: string) => void;
}) {
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
          <label>用户名<input value={uid} autoFocus onChange={(e) => onUid(e.target.value.trim())} /></label>
          <label>密码<input type="password" value={password} placeholder="≥ 6 位"
            onChange={(e) => onPassword(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") onLogin(password); }} /></label>
          <button className="login-submit" disabled={authBusy} onClick={() => onLogin(password)}>登录</button>
          <button className="login-submit secondary" disabled={authBusy} onClick={onRegister}>注册并登录</button>
          <p className="hint">
            真账号密码登录。先启动后端 <code>go run ./cmd/imserver</code>。<br />
            仅调试：<button className="link-inline" disabled={authBusy} onClick={() => onLogin("")}>免密登录</button>（需后端开启 dev-login）。
          </p>
        </>
      ) : (
        <QRLoginTab onLogin={onQRLogin} />
      )}
    </div>
  );
}
