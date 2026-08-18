import { useRef } from "react";
import { Check, SquarePen } from "lucide-react";
import { Avatar } from "../Avatar";
import { SubPanel } from "./SubPanel";

export type ProfileDraft = { nickname: string; avatar_url: string; phone: string; tags: string };

/** 编辑资料面板：经设置页铅笔进入，叠在设置面板之上（对齐 Telegram Web「Edit profile」）。
 *  纯展示：草稿状态与保存/选头像动作由 App 注入；隐藏 file input 的 ref 归本组件私有。 */
export function EditProfilePanel({ draft, uid, busy, onChange, onSave, onPickAvatar, onBack }: {
  draft: ProfileDraft;
  uid: string;
  busy: boolean;
  onChange: (next: ProfileDraft) => void;
  onSave: () => void;
  onPickAvatar: (file?: File) => void;
  onBack: () => void;
}) {
  const avatarFileRef = useRef<HTMLInputElement>(null); // 隐藏的本机图片选择 input
  return (
    <SubPanel className="edit-panel" title="编辑资料" onBack={onBack}
      right={<button className="icon-btn save" title="保存" disabled={busy} onClick={onSave}><Check size={22} /></button>}>
        {/* 点头像 → 选本机图片（隐藏的 file input，浏览器自动用系统原生文件框，跨平台无需检测系统）。 */}
        <button className="edit-avatar" title="更换头像" onClick={() => avatarFileRef.current?.click()}>
          <Avatar url={draft.avatar_url} label={draft.nickname || uid} seed={uid} cls="edit-avatar-inner" />
          <span className="edit-cam"><SquarePen size={15} /></span>
        </button>
        <input ref={avatarFileRef} type="file" accept="image/*" hidden
          onChange={(e) => { onPickAvatar(e.target.files?.[0]); e.target.value = ""; }} />
        <div className="settings-group edit-fields">
          <label className="edit-field"><span>昵称</span>
            <input value={draft.nickname} maxLength={32}
              onChange={(e) => onChange({ ...draft, nickname: e.target.value })} /></label>
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
