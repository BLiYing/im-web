import { ChevronLeft, SquarePen } from "lucide-react";
import { Avatar } from "../Avatar";
import { renderRow, type Row } from "../rows";

/** 设置面板主页：占据侧栏列（绝对定位），右侧聊天 .main 保持不动、可继续聊（对齐 Telegram Web）。
 *  纯展示：行数据（infoRows/groups）与全部动作由 App 组装传入。 */
export function SettingsPanel({ avatarUrl, name, seed, stateText, infoRows, groups, onBack, onEditProfile, onLogout }: {
  avatarUrl?: string;
  name: string;
  seed: string;
  stateText: string;
  infoRows: Row[];
  groups: Row[][];
  onBack: () => void;
  onEditProfile: () => void;
  onLogout: () => void;
}) {
  return (
    <div className="settings-panel">
      <header className="settings-head">
        <button className="icon-btn" title="返回" onClick={onBack}><ChevronLeft size={27} /></button>
        <span className="settings-title">设置</span>
        <button className="icon-btn" title="编辑资料" onClick={onEditProfile}><SquarePen size={24} /></button>
      </header>
      <div className="settings-body">
        <div className="settings-profile">
          <Avatar url={avatarUrl} label={name} seed={seed} cls="settings-avatar" />
          <div className="settings-name">{name}</div>
          <div className="settings-status">{stateText}</div>
        </div>
        <div className="settings-group">
          {infoRows.map((r) => renderRow(r, "settings-row info"))}
        </div>
        {groups.map((group, gi) => (
          <div key={gi} className="settings-group">
            {group.map((r) => renderRow(r, "settings-row"))}
          </div>
        ))}
        <button className="settings-logout" onClick={onLogout}>退出登录</button>
      </div>
    </div>
  );
}
