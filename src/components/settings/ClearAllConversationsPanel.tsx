import { useT } from "../../i18n";
import { useClearAllConversations, type ClearAllState } from "../../useClearAllConversations";
import { DangerConfirmPage } from "./DangerConfirmPage";

/** 清除所有对话二级页（CLEAR_ALL_CONVERSATIONS_DESIGN §1，草图 CLEAR_ALL_CONVERSATIONS_UX_SKETCH）。
 *  版式与「注销账号」页共用 DangerConfirmPage；无密码框，红按钮直接可点（点后走系统二次确认）。纯展示，状态在 hook。 */
export function ClearAllConversationsPanel({ state, onBack }: { state: ClearAllState; onBack: () => void }) {
  const t = useT();
  return (
    <DangerConfirmPage
      className="clear-all-panel" title={t("privacy.clear_all.title")} headline={t("privacy.clear_all.warn_title")}
      bullets={[1, 2, 3, 4].map((n) => t(`privacy.clear_all.b${n}`))} tip={t("privacy.clear_all.tip")}
      error={state.error} errorClass="auth-err" buttonLabel={t("privacy.clear_all.button")}
      busy={state.busy} disabled={state.busy} onSubmit={() => void state.submit()} onBack={onBack}
    />
  );
}

/** 容器：状态簇随面板挂载 / 卸载。 */
export function ClearAllConversationsContainer({ onBack, ...deps }: Parameters<typeof useClearAllConversations>[0] & { onBack: () => void }) {
  const state = useClearAllConversations(deps);
  return <ClearAllConversationsPanel state={state} onBack={onBack} />;
}
