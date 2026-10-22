import { useEffect } from "react";
import { Check } from "lucide-react";
import { Modal } from "./Modal";
import { AUTO_DELETE_CUSTOM_TIERS, tierLabel } from "../autoDelete";
import { useT } from "../i18n";

/** 「自定义时间」底部弹窗（复用 MuteDurationModal 的 Modal 壳 + modal-title / modal-close）：18 档升序、可滚动、带取消；
 *  当前档位打 ✓，点行即选中并关闭（选到与固定行相同的值如 1 天也行，列表里的 ✓ 归固定行）。 */
export function AutoDeleteCustomSheet({ value, onPick, onCancel }: {
  value: number;
  onPick: (sec: number) => void;
  onCancel: () => void;
}) {
  const t = useT();
  useEffect(() => { // Esc 关闭（同 Dialogs / PinnedListModal）
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onCancel(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onCancel]);
  return (
    <Modal className="modal autodel-sheet" onClose={onCancel} maskClassName="autodel-mask">
      <div className="modal-title">{t("autodel.custom.title")}</div>
      <div className="autodel-sheet-list" role="radiogroup">
        {AUTO_DELETE_CUSTOM_TIERS.map((sec) => (
          <button key={sec} className="radio-row autodel-row" role="radio" aria-checked={value === sec} onClick={() => onPick(sec)}>
            <span className="row-label">{tierLabel(t, sec)}</span>
            {value === sec && <Check size={18} className="autodel-check" />}
          </button>
        ))}
      </div>
      <button className="modal-close" onClick={onCancel}>{t("common.cancel")}</button>
    </Modal>
  );
}
