import { useState } from "react";
import { errorCode } from "../../qr";
import { validateChangePassword } from "./changePassword";
import { SubPanel } from "./SubPanel";

/** 修改密码子面板（拉齐 iOS IMChangePasswordViewController）：三输入框 + 本地三档校验。
 *  成功后服务端**自动下线其它全部设备**（只留当前，见 imSdk.changePassword）。
 *  纯 UI：提交走 onSubmit（抛错即失败），成功回调 onDone 由 App 弹 toast + 关面板。 */
export function ChangePasswordPanel({ onSubmit, onDone, onBack }: {
  onSubmit: (oldPwd: string, newPwd: string) => Promise<void>; // 抛错=失败
  onDone: () => void; // 成功：App 侧弹「密码已修改，其它设备已下线」+ 返回
  onBack: () => void;
}) {
  const [oldPwd, setOldPwd] = useState("");
  const [newPwd, setNewPwd] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const canSubmit = oldPwd.length > 0 && newPwd.length > 0 && confirm.length > 0 && !busy;

  const submit = async () => {
    // 本地前置校验（纯函数，见 changePassword.ts）：只把「旧密码是否正确」留给服务端。
    const localErr = validateChangePassword(oldPwd, newPwd, confirm);
    if (localErr) { setError(localErr); return; }
    setError("");
    setBusy(true);
    try {
      await onSubmit(oldPwd, newPwd);
      onDone();
    } catch (e) {
      // 200002 = 旧密码错（本地无法预判）；其余用服务端本地化文案兜底。
      setError(errorCode(e) === 200002 ? "当前密码不正确" : ((e as Error).message || "修改失败，请稍后再试"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <SubPanel className="changepwd-panel" title="修改密码" onBack={onBack}>
      <div className="settings-group edit-fields">
        <label className="edit-field"><span>当前密码</span>
          <input type="password" autoComplete="current-password" value={oldPwd}
            onChange={(e) => setOldPwd(e.target.value)} /></label>
        <label className="edit-field"><span>新密码（至少 6 位）</span>
          <input type="password" autoComplete="new-password" value={newPwd}
            onChange={(e) => setNewPwd(e.target.value)} /></label>
        <label className="edit-field"><span>确认新密码</span>
          <input type="password" autoComplete="new-password" value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && canSubmit) void submit(); }} /></label>
      </div>
      {error && <div className="pwd-error">{error}</div>}
      <div className="settings-foot">修改成功后，你在其它设备上的登录会被自动下线，需用新密码重新登录；当前设备保持登录。</div>
      <div className="pwd-actions">
        <button className="mini-btn wide" disabled={!canSubmit} onClick={() => void submit()}>
          {busy ? "提交中…" : "修改密码"}
        </button>
      </div>
    </SubPanel>
  );
}
