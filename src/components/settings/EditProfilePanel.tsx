import { useRef } from "react";
import { AtSign, Check, Phone, SquarePen } from "lucide-react";
import { renderRow } from "../rows";
import { Avatar } from "../Avatar";
import { SubPanel } from "./SubPanel";

// username 是公开句柄（登录名 + 别人搜索到我的凭据，规则严格）；nickname 是显示名（随便填）。
// 两者独立提交：改名走独立接口，见 useProfileEdit.saveProfile。
export type ProfileDraft = { nickname: string; username: string; avatar_url: string; phone: string; tags: string };

/** 我的资料面板，**双态**（2026-08-30，与 iOS IMProfileEditViewController 拉齐）：
 *
 *  - 默认**只读**：大头像 + 昵称 + 在线态 + 一张信息卡（手机 / 用户名）。右上角「编辑」。
 *  - 点编辑才进可修改的表单，右上角变「保存」、左上角变「取消」。
 *
 *  从设置页点头部进来的用户多数只是想看一眼，直接给一屏输入框既突兀又容易误改。
 *  刻意不显示内部 ID（10 位随机数字，见 docs/UI.md「用户标识」）与标签（Telegram 那张卡上无对应物）。
 *
 *  纯展示：草稿状态与保存/选头像动作由 App 注入；隐藏 file input 的 ref 归本组件私有。 */
export function EditProfilePanel({ draft, uid, busy, editing, onEnterEditing, onCancelEditing, onChange, onSave, onPickAvatar, onBack }: {
  draft: ProfileDraft;
  uid: string;
  busy: boolean;
  editing: boolean;
  onEnterEditing: () => void;
  onCancelEditing: () => void;
  onChange: (next: ProfileDraft) => void;
  onSave: () => void;
  onPickAvatar: (file?: File) => void;
  onBack: () => void;
}) {
  const avatarFileRef = useRef<HTMLInputElement>(null); // 隐藏的本机图片选择 input

  if (!editing) {
    return (
      <SubPanel className="edit-panel" title="我的资料" onBack={onBack}
        right={<button className="icon-btn" title="编辑" onClick={onEnterEditing}><SquarePen size={22} /></button>}>
        <div className="settings-profile">
          <Avatar url={draft.avatar_url} label={draft.nickname} seed={uid} cls="settings-avatar" />
          <div className="settings-name">{draft.nickname || (draft.username ? `@${draft.username}` : "未命名用户")}</div>
          <div className="settings-status">在线</div>
        </div>
        {/* 复用设置页的 info 行（左大字=值、右小字=字段名，正是 Telegram 那张卡的布局）。
            没填手机号就整行不占位（Telegram 同款）。点任一行 → 进编辑态。 */}
        <div className="settings-group">
          {draft.phone
            ? renderRow({ id: "phone", label: draft.phone, icon: Phone, iconTint: "green", value: "手机", onClick: onEnterEditing }, "settings-row info")
            : null}
          {renderRow({
            id: "username",
            label: draft.username ? `@${draft.username}` : "未设置",
            icon: AtSign, iconTint: "blue", value: "用户名", onClick: onEnterEditing,
          }, "settings-row info")}
        </div>
      </SubPanel>
    );
  }

  return (
    <SubPanel className="edit-panel" title="编辑资料" onBack={onCancelEditing}
      right={<button className="icon-btn save" title="保存" disabled={busy} onClick={onSave}><Check size={22} /></button>}>
        {/* 点头像 → 选本机图片（隐藏的 file input，浏览器自动用系统原生文件框，跨平台无需检测系统）。 */}
        <button className="edit-avatar" title="更换头像" onClick={() => avatarFileRef.current?.click()}>
          <Avatar url={draft.avatar_url} label={draft.nickname || draft.username} seed={uid} cls="edit-avatar-inner" />
          <span className="edit-cam"><SquarePen size={15} /></span>
        </button>
        <input ref={avatarFileRef} type="file" accept="image/*" hidden
          onChange={(e) => { onPickAvatar(e.target.files?.[0]); e.target.value = ""; }} />
        <div className="settings-group edit-fields">
          <label className="edit-field"><span>昵称</span>
            <input value={draft.nickname} maxLength={32}
              onChange={(e) => onChange({ ...draft, nickname: e.target.value })} /></label>
          <label className="edit-field"><span>用户名</span>
            <input value={draft.username} maxLength={32} placeholder="a-z、0-9、下划线，≥5 位"
              autoCapitalize="none" autoCorrect="off" spellCheck={false}
              onChange={(e) => onChange({ ...draft, username: e.target.value.trim() })} /></label>
          <label className="edit-field"><span>手机号</span>
            <input value={draft.phone}
              onChange={(e) => onChange({ ...draft, phone: e.target.value })} /></label>
          <label className="edit-field"><span>标签</span>
            <input value={draft.tags} placeholder="空格或逗号分隔"
              onChange={(e) => onChange({ ...draft, tags: e.target.value })} /></label>
        </div>
    </SubPanel>
  );
}
