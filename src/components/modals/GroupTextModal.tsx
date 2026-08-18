import { X, Megaphone, Info, Copy, SquarePen } from "lucide-react";

/** 群公告 / 群简介全文视图（决策 16/17）：三入口共用；只读全文 + 复制 +（管理员，仅公告）编辑。
 *  纯展示：文本/发布者元信息/权限与动作由 App 注入（meta 已在 App 侧格式化，避免依赖内部时间函数）。 */
export function GroupTextModal({ isAnnouncement, text, meta, canEdit, onCopy, onEdit, onClose }: {
  isAnnouncement: boolean;
  text: string;
  meta?: string; // 「发布者 · 时间 发布」，仅公告且有值时显示
  canEdit: boolean;
  onCopy: () => void;
  onEdit: () => void;
  onClose: () => void;
}) {
  return (
    <div className="modal-mask" onClick={onClose}>
      <div className="modal grouptext-modal" onClick={(e) => e.stopPropagation()}>
        <button className="qr-close" onClick={onClose} aria-label="关闭"><X size={18} /></button>
        <h3 className="modal-title">{isAnnouncement ? <Megaphone size={18} /> : <Info size={18} />} {isAnnouncement ? "群公告" : "群简介"}</h3>
        {isAnnouncement && meta && (
          <div className="grouptext-meta">{meta}</div>
        )}
        <div className="grouptext-body">{text || (isAnnouncement ? "暂无公告" : "暂无简介")}</div>
        <div className="modal-actions">
          <button className="mini-btn ghost" onClick={onCopy}><Copy size={15} /> 复制</button>
          {canEdit && (
            <button className="mini-btn" onClick={onEdit}><SquarePen size={15} /> 编辑</button>
          )}
        </div>
      </div>
    </div>
  );
}
