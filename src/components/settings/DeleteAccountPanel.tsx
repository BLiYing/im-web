import { useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import { useT } from "../../i18n";
import { useDeleteAccount, type DeleteAccountState } from "../../useDeleteAccount";
import { DangerConfirmPage } from "./DangerConfirmPage";

/** 注销账号二级页（DELETE_ACCOUNT_DESIGN §3 / §4 Web 列，草图 DELETE_ACCOUNT_UX_SKETCH §C/§D）。
 *  风格参照 ChangePasswordPanel；状态与提交全在 useDeleteAccount，本组件纯展示。
 *  二次确认（Dialogs confirm）与成功后回登录页由 hook / App 接线完成。 */
export function DeleteAccountPanel({ state, onBack, onOpenGroup }: { state: DeleteAccountState; onBack: () => void; onOpenGroup?: (convId: string) => void }) {
  const t = useT();
  const [reveal, setReveal] = useState(false);
  const blocked = state.ownedGroups.length > 0;
  return (
    <DangerConfirmPage
      className="delete-account-panel" title={t("delete_account.title")} headline={t("delete_account.header")}
      bullets={[1, 2, 3, 4].map((n) => t(`delete_account.consequence_${n}`))} tip={t("delete_account.cooldown_hint")}
      error={state.error} errorClass="pwd-error" buttonLabel={t("delete_account.title")}
      busy={state.busy} disabled={!state.canSubmit} onSubmit={() => void state.submit()} onBack={onBack}
    >
      {blocked && (
        <div className="delacct-owned" role="alert">
          {t("delete_account.owned_groups")}<br />
          {state.ownedGroups.slice(0, 3).map((g, i) => (
            <span key={g.conv_id}>{i > 0 && " · "}
              <button type="button" className="delacct-group" onClick={() => onOpenGroup?.(g.conv_id)}>{g.name}</button></span>
          ))}
          {state.ownedGroups.length > 3 && ` · ${t("delete_account.owned_groups_more", { n: state.ownedGroups.length - 3 })}`}
        </div>
      )}
      <div className="settings-group delacct-pwd">
        <input type={reveal ? "text" : "password"} autoComplete="current-password" disabled={blocked || state.busy}
          placeholder={t("delete_account.password_hint")} value={state.password}
          onChange={(e) => state.setPassword(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && state.canSubmit) void state.submit(); }} />
        <button type="button" className="icon-btn" disabled={blocked} onClick={() => setReveal((v) => !v)}
          aria-label={t(reveal ? "password.eye.hide" : "password.eye.show")}>{reveal ? <EyeOff size={18} /> : <Eye size={18} />}</button>
      </div>
    </DangerConfirmPage>
  );
}

/** 容器：状态簇随面板挂载/卸载（关掉即丢密码与阻断态），Host 只传依赖。 */
export function DeleteAccountContainer({ run, askConfirm, onDeleted, onBack, onOpenGroup }: {
  run: (password: string) => Promise<void>;
  askConfirm: Parameters<typeof useDeleteAccount>[0]["askConfirm"];
  onDeleted: () => void;
  onBack: () => void;
  onOpenGroup?: (convId: string) => void;
}) {
  const state = useDeleteAccount({ run, askConfirm, onDeleted });
  return <DeleteAccountPanel state={state} onBack={onBack} onOpenGroup={onOpenGroup} />;
}
