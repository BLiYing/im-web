import { X, Megaphone, Info, Copy, SquarePen, UsersRound } from "lucide-react";
import { Modal } from "../Modal";
import { useT } from "../../i18n";

/** 群资料卡三行共用的全文视图（决策 16/17 + 大群说明）：只读全文 + 复制 +（管理员，仅公告）编辑。
 *
 *  kind 从原先的 isAnnouncement 布尔换成三值：加大群说明时若继续用布尔，就得再加一个
 *  isSuper 布尔，两个布尔能拼出四种状态而实际只有三种——那种"不可能的组合"迟早被人写出来。
 *
 *  纯展示：文本/发布者元信息/权限与动作由 App 注入（meta 已在 App 侧格式化，避免依赖内部时间函数）。 */
export type GroupTextKind = "announcement" | "intro" | "super";

const TITLES: Record<GroupTextKind, string> = { announcement: "group.text.announcement", intro: "group.text.intro", super: "group.text.super" };
const EMPTY: Record<GroupTextKind, string> = { announcement: "group.text.empty_announcement", intro: "group.text.empty_intro", super: "" };

export function GroupTextModal({ kind, text, meta, canEdit, onCopy, onEdit, onClose }: {
  kind: GroupTextKind;
  text: string;
  meta?: string; // 公告：「发布者 · 时间 发布」；大群：一句副标题。有值才显示
  canEdit: boolean;
  onCopy: () => void;
  onEdit: () => void;
  onClose: () => void;
}) {
  const tr = useT();
  const Icon = kind === "announcement" ? Megaphone : kind === "super" ? UsersRound : Info;
  return (
    <Modal className="modal grouptext-modal" onClose={onClose}>
        <button className="qr-close" onClick={onClose} aria-label={tr("common.close")}><X size={18} /></button>
        <h3 className="modal-title"><Icon size={18} /> {tr(TITLES[kind])}</h3>
        {meta && <div className="grouptext-meta">{meta}</div>}
        <div className="grouptext-body">{text || (EMPTY[kind] ? tr(EMPTY[kind]) : "")}</div>
        <div className="modal-actions">
          <button className="mini-btn ghost" onClick={onCopy}><Copy size={15} /> {tr("common.copy")}</button>
          {canEdit && (
            <button className="mini-btn" onClick={onEdit}><SquarePen size={15} /> {tr("common.edit")}</button>
          )}
        </div>
    </Modal>
  );
}
