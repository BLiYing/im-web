// 会话列表编辑模式的两件 UI：侧栏右上角的「编辑 / 完成」按钮、列表下方的选择栏（全选 / 已选择 N 项 / 已读 / 删除）。
// 设计 IMServer/docs/design/CONV_LIST_EDIT_MODE_DESIGN.md §1/§3；样式沿用聊天多选栏的玻璃钮语言（.sel-action）。
import { useT } from "../i18n";
import type { ConvEditMode } from "../useConvEditMode";

/** 侧栏 header 行最右端的「编辑 / 完成」文字钮（`.link-inline` 同款）。调用方只在「消息」页签、列表非空（或已在编辑）时渲染。 */
export function ConvEditToggle({ edit }: { edit: ConvEditMode }) {
  const t = useT();
  return (
    <button type="button" className="conv-edit-toggle link-inline" onClick={edit.editing ? edit.exit : edit.enter}>
      {t(edit.editing ? "common.done" : "common.edit")}
    </button>
  );
}

/** 选择栏：独立占侧栏底部一条，列表（flex:1）在其上方内部滚动，不与列表重叠。 */
export function ConvEditBar({ edit }: { edit: ConvEditMode }) {
  const t = useT();
  return (
    <footer className="conv-edit-bar" aria-label={t("common.edit")}>
      <button type="button" className="link-inline" disabled={!edit.canSelectAll} onClick={edit.selectAll}>
        {t(edit.allSelected ? "common.deselect_all" : "common.select_all")}
      </button>
      <span className="select-count">{edit.count > 0 ? t("conv.edit.selected_count", { count: edit.count }) : ""}</span>
      <button type="button" className="conv-edit-pill" disabled={!edit.canRead} onClick={() => void edit.markRead()}>
        {t("conv.edit.mark_read")}
      </button>
      <button type="button" className="conv-edit-pill danger" disabled={!edit.canDelete} onClick={() => void edit.removeSelected()}>
        {t("common.delete")}
      </button>
    </footer>
  );
}
