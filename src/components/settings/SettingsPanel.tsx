import { SquarePen } from "lucide-react";
import { Avatar } from "../Avatar";
import { renderRow, type Row } from "../rows";
import { SubPanel } from "./SubPanel";
import { useT } from "../../i18n";

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
  const t = useT();
  return (
    <SubPanel title={t("settings.title")} onBack={onBack}
      right={<button className="icon-btn" title={t("settings.edit_profile")} onClick={onEditProfile}><SquarePen size={24} /></button>}>
        {/* 点头部（头像/昵称/状态）→ 我的资料页，与 iOS 的「点头部进资料页」拉齐。
            右上角铅笔仍在（直接进编辑态的快捷方式）。 */}
        <div className="settings-profile settings-profile-tappable" role="button" tabIndex={0}
          onClick={onEditProfile}
          onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onEditProfile(); } }}>
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
        <button className="settings-logout" onClick={onLogout}>{t("settings.logout")}</button>
    </SubPanel>
  );
}
