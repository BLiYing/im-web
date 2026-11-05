// 分享 / 转发选择页的零件（SHARE_PICKER_UX_SKETCH ①–④）：会话行、入口行、分组标题、底部已选栏、发送确认面板。
// 纯展示，数据与动作全部由 ForwardPicker 注入。
import { Check, ChevronRight, User, Users } from "lucide-react";
import type { Conversation } from "../../sdk/protocol";
import { Avatar } from "../Avatar";
import { MemberChips, type MemberChipItem } from "../MemberChips";
import { useT } from "../../i18n";

export type PickRowProps = {
  c: Conversation;
  multi: boolean;
  on: boolean;
  label: string;
  avatarUrl: string | undefined;
  onClick: () => void;
};

/** 一行可选目标（会话 / 好友 / 群）。多选态行首出勾选框。 */
export function PickRow({ c, multi, on, label, avatarUrl, onClick }: PickRowProps) {
  return (
    <button className="fwd-item" onClick={onClick}>
      {multi && <span className={`checkbox${on ? " on" : ""}`}>{on && <Check size={13} />}</span>}
      <Avatar url={avatarUrl} label={label} seed={c.is_group ? c.conv_id : c.peer} />
      <span className="fwd-item-label">{label}</span>
    </button>
  );
}

/** 「我的好友」「我的群聊」入口行：单选、多选都显示，没有勾选框，点了切子视图。 */
export function SourceEntries({ onFriends, onGroups }: { onFriends: () => void; onGroups: () => void }) {
  const tr = useT();
  return (
    <>
      <button className="fwd-item fwd-entry" onClick={onFriends}>
        <span className="fwd-entry-ic friends"><User size={18} /></span>
        <span className="fwd-item-label">{tr("share.picker.my_friends")}</span>
        <ChevronRight size={16} className="fwd-entry-chev" />
      </button>
      <button className="fwd-item fwd-entry" onClick={onGroups}>
        <span className="fwd-entry-ic groups"><Users size={18} /></span>
        <span className="fwd-item-label">{tr("share.picker.my_groups")}</span>
        <ChevronRight size={16} className="fwd-entry-chev" />
      </button>
    </>
  );
}

export function SectionHead({ text }: { text: string }) {
  return <div className="fwd-sec">{text}</div>;
}

/** 底部已选栏（多选态常驻）：横向滚动的已选头像条（复用建群成员条 MemberChips）+「发送(N)」。 */
export function SelectedBar({ chips, max, onRemove, onSend }: {
  chips: MemberChipItem[];
  max: number;
  onRemove: (id: string) => void;
  onSend: () => void;
}) {
  const tr = useT();
  const n = chips.length;
  return (
    <div className="fwd-bar" data-testid="fwd-bar">
      {n > 0
        ? <MemberChips className="member-chips fwd-strip" items={chips} onRemove={onRemove} />
        : <span className="fwd-bar-hint">{tr("share.picker.bar_hint", { count: max })}</span>}
      <button className="mini-btn fwd-bar-send" disabled={n === 0} onClick={onSend}>
        {n > 0 ? tr("forward.picker.send_count", { count: n }) : tr("common.send")}
      </button>
    </div>
  );
}

/** 发送确认面板（弹窗内从底部滑出）：目标可删（删到 0 由调用方关面板）+ 内容预览 + 发送。 */
export function ConfirmPanel({ chips, preview, onRemove, onCancel, onSend }: {
  chips: MemberChipItem[];
  preview?: string;
  onRemove: (id: string) => void;
  onCancel: () => void;
  onSend: () => void;
}) {
  const tr = useT();
  return (
    <div className="fwd-confirm-mask" onClick={onCancel}>
      <div className="fwd-confirm" role="dialog" data-testid="fwd-confirm" onClick={(e) => e.stopPropagation()}>
        <div className="fwd-confirm-head">
          <span>{tr("share.picker.confirm_title", { count: chips.length })}</span>
          <button className="link" onClick={onCancel}>{tr("common.cancel")}</button>
        </div>
        <MemberChips className="member-chips fwd-confirm-grid" items={chips} onRemove={onRemove} />
        {preview && <div className="fwd-preview" data-testid="fwd-preview">{preview}</div>}
        <button className="mini-btn fwd-confirm-send" onClick={onSend}>{tr("common.send")}</button>
      </div>
    </div>
  );
}
