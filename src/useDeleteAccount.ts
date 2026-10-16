// 注销账号：面板状态簇 + 登录页「冷静期恢复」流程（DELETE_ACCOUNT_DESIGN §3 / §3.5）。
// 全是可注入依赖的逻辑，面板与 App 只接线；网络调用走 sdk/accountApi.ts。
import { useCallback, useState } from "react";
import { t } from "./i18n";
import {
  CODE_ACCOUNT_PENDING_DELETION, deleteAtMs, restoreAccount,
  type AccountError, type OwnedGroup,
} from "./sdk/accountApi";

type AskConfirm = (message: string, opts?: { title?: string; okText?: string; danger?: boolean }) => Promise<boolean>;

/** 阻断态群名列表：最多 3 个，其余折成「等 N 个」。 */
export function ownedGroupsLine(groups: readonly OwnedGroup[]): string {
  const shown = groups.slice(0, 3).map((g) => g.name).join(" · ");
  return groups.length > 3 ? `${shown} · ${t("delete_account.owned_groups_more", { n: groups.length - 3 })}` : shown;
}

export interface DeleteAccountState {
  password: string;
  setPassword: (v: string) => void;
  busy: boolean;
  error: string;
  ownedGroups: OwnedGroup[];
  /** 红按钮可点：已填密码、不在提交中、不是群主阻断态。 */
  canSubmit: boolean;
  submit: () => Promise<void>;
}

export function useDeleteAccount(deps: {
  run: (password: string) => Promise<void>; // 调后端；抛 AccountError
  askConfirm: AskConfirm;
  onDeleted: () => void; // 成功：清本机 + 回登录页（由 App 接线）
}): DeleteAccountState {
  const { run, askConfirm, onDeleted } = deps;
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [ownedGroups, setOwnedGroups] = useState<OwnedGroup[]>([]);
  const canSubmit = password.length > 0 && !busy && ownedGroups.length === 0;

  const submit = useCallback(async () => {
    if (!canSubmit) return;
    const ok = await askConfirm(t("delete_account.confirm_message"), {
      title: t("delete_account.confirm_title"), okText: t("delete_account.confirm_action"), danger: true,
    });
    if (!ok) return;
    setBusy(true); setError("");
    try {
      await run(password);
      onDeleted();
    } catch (e) {
      const err = e as AccountError;
      if (err.ownedGroups?.length) setOwnedGroups(err.ownedGroups);
      else setError(err.message || t("net.error.cannot_connect"));
    } finally {
      setBusy(false);
    }
  }, [canSubmit, askConfirm, run, password, onDeleted]);

  return { password, setPassword, busy, error, ownedGroups, canSubmit, submit };
}

/** 登录遇 AccountPendingDeletion 的恢复流程。返回 true=已恢复，调用方应重新走登录；false=不是冷静期错误 / 用户取消 / 恢复失败（失败文案走 onError）。 */
export function useRestoreOffer(deps: { askConfirm: AskConfirm; onError: (msg: string) => void }) {
  const { askConfirm, onError } = deps;
  return useCallback(async (e: unknown, username: string, password: string): Promise<boolean> => {
    const err = e as AccountError;
    if (err?.code !== CODE_ACCOUNT_PENDING_DELETION) return false;
    const date = err.deleteAt
      ? new Date(deleteAtMs(err.deleteAt)).toLocaleDateString(undefined, { month: "long", day: "numeric" })
      : "";
    const ok = await askConfirm(t("delete_account.restore_message", { date }), {
      title: t("delete_account.restore_title"), okText: t("delete_account.restore_action"),
    });
    if (!ok) return false;
    try { await restoreAccount(username, password); return true; }
    catch (re) { onError((re as Error).message); return false; }
  }, [askConfirm, onError]);
}
