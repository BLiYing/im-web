// ModalHead：弹窗内的「页面标题栏」（UI_SPEC §4.5 / PINNED_PANEL_DESIGN §2.1）——左 ✕ 关闭（.icon-btn 38）、
// 标题 17/600 居中（.settings-title）、可选副标题 13 居中；左右各固定 64 占位，标题不随左右内容漂。
// 复用 settings-head 的样式，不把整个 SubPanel 拉进来（Web 聊天头「标题左对齐」是刻意差异，不在复用范围）。
import { X } from "lucide-react";
import { useT } from "../i18n";

export function ModalHead({ title, subtitle, onClose }: { title: string; subtitle?: string; onClose: () => void }) {
  const tr = useT();
  return (
    <header className="settings-head modal-head">
      <span className="modal-head-side">
        <button className="icon-btn" title={tr("common.close")} aria-label={tr("common.close")} onClick={onClose}><X size={20} /></button>
      </span>
      <span className="modal-head-titles">
        <span className="settings-title">{title}</span>
        {subtitle && <span className="modal-head-sub">{subtitle}</span>}
      </span>
      <span className="modal-head-side" />
    </header>
  );
}
