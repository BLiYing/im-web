import { ChevronRight, Check } from "lucide-react";
import type { CSSProperties } from "react";
import type { LucideIcon } from "lucide-react";
import { Avatar } from "./Avatar";

// 通用菜单行：图标可选、右侧值/箭头可选、danger 红色。account card / settings / contacts entries 共用。
// iconTint：设置 iOS 风格圆角色块（对齐 IMSettingsViewController 的 systemColor 分色）；不给则渲染裸图标（账号气泡卡沿用旧样式）。
export type Row = { id: string; label: string; icon?: LucideIcon; iconTint?: string; value?: string; danger?: boolean; muted?: boolean; chevron?: boolean; onClick: () => void };

// 通用行渲染（cls 区分容器样式）。muted=灰置占位（标题/右值半档灰，图标保留全彩）。
export const renderRow = (r: Row, cls: string) => (
  <button key={r.id} className={`${cls}${r.danger ? " danger" : ""}${r.muted ? " muted" : ""}`} onClick={r.onClick}>
    {r.icon && (r.iconTint
      ? <span className={`row-icon-tile ${r.iconTint}`}><r.icon size={17} /></span>
      : <r.icon size={20} className="row-icon" />)}
    <span className="row-label">{r.label}</span>
    {r.value && <span className="row-value">{r.value}</span>}
    {r.chevron && <ChevronRight size={18} className="row-chevron" />}
  </button>
);

// 多选用户行：勾选框 + 头像 + 名称。建群 / 邀请成员共用（转发选择器结构略异，未走此路）。
export function CheckRow({ selected, url, label, seed, onClick, style }: {
  selected: boolean;
  url?: string;
  label: string;
  seed: string;
  onClick: () => void;
  /** 可选行内样式（分享名片达选择上限时把未选中行置灰）。 */
  style?: CSSProperties;
}) {
  return (
    <button className="check-row" onClick={onClick} style={style}>
      <span className={`checkbox${selected ? " on" : ""}`}>{selected && <Check size={13} />}</span>
      <Avatar url={url} label={label} seed={seed} />
      <span className="row-label">{label}</span>
    </button>
  );
}
