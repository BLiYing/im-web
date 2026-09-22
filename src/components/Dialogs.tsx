import type { ConfirmDlg, PromptDlg } from "../useDialogs";
import { Modal } from "./Modal";
import { useT } from "../i18n";

// 应用内确认/输入弹窗的渲染层（状态与 askConfirm/askPrompt 在 useDialogs）。
// 从 App.tsx 抽出：props 直接接 useDialogs 的 dlg + setter，交互逐字一致。

/** 应用内确认框（替代 window.confirm，统一 .modal 风格）。点遮罩 = 取消。 */
export function ConfirmDialog({ dlg, set }: { dlg: ConfirmDlg; set: (v: ConfirmDlg | null) => void }) {
  return (
    <Modal className="modal confirm-modal" onClose={() => { dlg.resolve(false); set(null); }}>
        <div className="confirm-msg">{dlg.message}</div>
        <div className="modal-actions">
          <button className="link" onClick={() => { dlg.resolve(false); set(null); }}>
            {dlg.cancelText}
          </button>
          <button className={`mini-btn${dlg.danger ? " danger" : ""}`} autoFocus
                  onClick={() => { dlg.resolve(true); set(null); }}>
            {dlg.okText}
          </button>
        </div>
    </Modal>
  );
}

/** 应用内输入框（替代 window.prompt）。单行=回车确定；多行=textarea + 字数计数（决策 18）。Esc/遮罩取消。 */
export function PromptDialog({ dlg, set }: { dlg: PromptDlg; set: (v: PromptDlg | null) => void }) {
  const tr = useT();
  return (
    <Modal onClose={() => { dlg.resolve(null); set(null); }}>
        <h3>{dlg.title}</h3>
        {dlg.multiline ? (
          <textarea autoFocus className="modal-textarea" value={dlg.value} placeholder={dlg.placeholder} maxLength={dlg.maxLength}
                    onChange={(e) => set({ ...dlg, value: e.target.value })}
                    onKeyDown={(e) => { if (e.key === "Escape") { dlg.resolve(null); set(null); } }} />
        ) : (
          <input autoFocus value={dlg.value} placeholder={dlg.placeholder} maxLength={dlg.maxLength}
                 onChange={(e) => set({ ...dlg, value: e.target.value })}
                 onKeyDown={(e) => {
                   if (e.key === "Enter") { dlg.resolve(dlg.value); set(null); }
                   else if (e.key === "Escape") { dlg.resolve(null); set(null); }
                 }} />
        )}
        {dlg.maxLength && (
          <div className="modal-counter">{dlg.value.length}/{dlg.maxLength}</div>
        )}
        <div className="modal-actions">
          <button className="link" onClick={() => { dlg.resolve(null); set(null); }}>{tr("common.cancel")}</button>
          {dlg.extraAction && (
            <button className={`mini-btn${dlg.extraAction.danger ? " danger" : " ghost"}`}
                    onClick={() => { dlg.resolve(dlg.extraAction!.value); set(null); }}>
              {dlg.extraAction.label}
            </button>
          )}
          <button className="mini-btn" onClick={() => { dlg.resolve(dlg.value); set(null); }}>
            {dlg.okText}
          </button>
        </div>
    </Modal>
  );
}
