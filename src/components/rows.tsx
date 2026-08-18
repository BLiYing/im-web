import { ChevronRight } from "lucide-react";
import type { LucideIcon } from "lucide-react";

// 通用菜单行：图标可选、右侧值/箭头可选、danger 红色。account card / settings / contacts entries 共用。
// iconTint：设置 iOS 风格圆角色块（对齐 IMSettingsViewController 的 systemColor 分色）；不给则渲染裸图标（账号气泡卡沿用旧样式）。
export type Row = { id: string; label: string; icon?: LucideIcon; iconTint?: string; value?: string; danger?: boolean; chevron?: boolean; onClick: () => void };

// 通用行渲染（cls 区分容器样式）。
export const renderRow = (r: Row, cls: string) => (
  <button key={r.id} className={`${cls}${r.danger ? " danger" : ""}`} onClick={r.onClick}>
    {r.icon && (r.iconTint
      ? <span className={`row-icon-tile ${r.iconTint}`}><r.icon size={17} /></span>
      : <r.icon size={20} className="row-icon" />)}
    <span className="row-label">{r.label}</span>
    {r.value && <span className="row-value">{r.value}</span>}
    {r.chevron && <ChevronRight size={18} className="row-chevron" />}
  </button>
);
