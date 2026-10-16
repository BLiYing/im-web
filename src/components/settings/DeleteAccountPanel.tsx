import { useState } from "react";
import { Eye, EyeOff, TriangleAlert } from "lucide-react";
import { useT } from "../../i18n";
import { ownedGroupsLine, useDeleteAccount, type DeleteAccountState } from "../../useDeleteAccount";
import { SubPanel } from "./SubPanel";

/** 注销账号二级页（DELETE_ACCOUNT_DESIGN §3 / §4 Web 列，草图 DELETE_ACCOUNT_UX_SKETCH §C/§D）。
 *  风格参照 ChangePasswordPanel；状态与提交全在 useDeleteAccount，本组件纯展示。
 *  二次确认（Dialogs confirm）与成功后回登录页由 hook / App 接线完成。 */
export function DeleteAccountPanel({ state, onBack }: { state: DeleteAccountState; onBack: () => void }) {
  const t = useT();
  const [reveal, setReveal] = useState(false);
  const blocked = state.ownedGroups.length > 0;
  return (
    <SubPanel className="delete-account-panel" title={t("delete_account.title")} onBack={onBack}>
      <div className="delacct-warn" aria-hidden="true"><TriangleAlert size={30} /></div>
      <div className="delacct-head">{t("delete_account.header")}</div>
      <div className="settings-group">
        {[1, 2, 3, 4].map((n) => (
          <div className="delacct-li" key={n}><span aria-hidden="true">•</span><span>{t(`delete_account.consequence_${n}`)}</span></div>
        ))}
      </div>
      <div className="delacct-tip">{t("delete_account.cooldown_hint")}</div>
      {blocked && (
        <div className="delacct-owned" role="alert">
          {t("delete_account.owned_groups")}<br />{ownedGroupsLine(state.ownedGroups)}
        </div>
      )}
      <div className="settings-group delacct-pwd">
        <input type={reveal ? "text" : "password"} autoComplete="current-password" disabled={blocked || state.busy}
          placeholder={t("delete_account.password_hint")} value={state.password}
          onChange={(e) => state.setPassword(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && state.canSubmit) void state.submit(); }} />
        <button type="button" className="icon-btn" disabled={blocked} onClick={() => setReveal((v) => !v)}
          aria-label={reveal ? "hide" : "show"}>{reveal ? <EyeOff size={18} /> : <Eye size={18} />}</button>
      </div>
      {state.error && <div className="pwd-error">{state.error}</div>}
      <button className="delacct-btn" disabled={!state.canSubmit} onClick={() => void state.submit()}>
        {state.busy ? <span className="btn-spinner keep-anim" aria-hidden="true" /> : null}{t("delete_account.title")}
      </button>
    </SubPanel>
  );
}

/** 容器：状态簇随面板挂载/卸载（关掉即丢密码与阻断态），Host 只传依赖。 */
export function DeleteAccountContainer({ run, askConfirm, onDeleted, onBack }: {
  run: (password: string) => Promise<void>;
  askConfirm: Parameters<typeof useDeleteAccount>[0]["askConfirm"];
  onDeleted: () => void;
  onBack: () => void;
}) {
  const state = useDeleteAccount({ run, askConfirm, onDeleted });
  return <DeleteAccountPanel state={state} onBack={onBack} />;
}
