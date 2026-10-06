import { ChevronLeft, UserPlus } from "lucide-react";
import type { GroupInfo, GroupMember } from "../sdk/protocol";
import { adminsOf, ownerOf, memberSubtitle } from "../groupAdmin";
import { Avatar } from "./Avatar";
import { useT } from "../i18n";

/**
 * 群管理 →「管理员」二级面板：群主（只读一行）+ 管理员列表（撤销）+「添加管理员」（仅群主）。
 * 沿用群管理面板自身的"抽屉内二级页"范式（.detail-manage-head 粘顶栏 + 返回），**不弹新 modal**——
 * 与 GroupManagePanel 的返回手势一致。在此之前，全站没有任何一处能回答"这个群有几个管理员、分别是谁"。
 */
export function AdminListPanel({ gp, uid, memberLabel, onBack, onAdd, onRevoke, onOpenMember }: {
  gp: GroupInfo;
  uid: string;
  /** 本机显示名（备注 > 群昵称 > 昵称）。 */
  memberLabel: (m: GroupMember) => string;
  onBack: () => void;
  onAdd: () => void;
  onRevoke: (m: GroupMember) => void;
  onOpenMember: (userId: string) => void;
}) {
  const tr = useT();
  const isOwner = gp.my_role === "owner";
  const owner = ownerOf(gp);
  const admins = adminsOf(gp);

  const row = (m: GroupMember, badge: "owner" | "admin") => {
    const sub = memberSubtitle(m); // 群昵称 / @句柄 / 空——绝不显示 10 位内部 ID
    return (
      <div key={m.user_id} className="detail-member" role="button"
        onClick={() => m.user_id !== uid && onOpenMember(m.user_id)}>
        <Avatar url={m.avatar_url} label={memberLabel(m)} seed={m.user_id} />
        <div className="detail-member-body">
          <div className="detail-member-name">
            {memberLabel(m)}{m.user_id === uid && <span className="me-tag">{tr("common.me")}</span>}
          </div>
          <div className="detail-member-sub">{sub}</div>
        </div>
        <span className={`role-badge${badge === "owner" ? " owner" : ""}`}>
          {badge === "owner" ? tr("group.role.owner") : tr("group.role.admin")}
        </span>
        {badge === "admin" && isOwner && (
          <button className="mini-btn danger" title={tr("group.member_action.revoke_admin")}
            onClick={(e) => { e.stopPropagation(); onRevoke(m); }}>{tr("group.admin_list.revoke_btn")}</button>
        )}
      </div>
    );
  };

  return (
    <div className="detail-manage">
      <div className="detail-manage-head">
        <button className="icon-btn" onClick={onBack}><ChevronLeft size={20} /></button>
        <span>{tr("group.role.admin")}</span>
      </div>
      <div className="detail-card-title">{tr("group.role.owner")}</div>
      <div className="detail-card">
        {owner ? row(owner, "owner") : <div className="detail-empty">{tr("group.admin_list.owner_missing")}</div>}
      </div>
      <div className="detail-card-title">{tr("group.admin_list.count_title", { count: admins.length })}</div>
      <div className="detail-card">
        {isOwner && (
          <button className="detail-row accent list-entry" onClick={onAdd}>
            <span className="entry-slot"><UserPlus size={20} /></span><span>{tr("group.admin_picker.title")}</span>
          </button>
        )}
        {admins.length === 0
          ? <div className="detail-empty">{tr("group.admin_list.empty")}</div>
          : admins.map((m) => row(m, "admin"))}
      </div>
      <div className="detail-foot-note">
        {isOwner
          ? tr("group.manage.permission_note")
          : tr("group.admin_list.owner_only_note")}
      </div>
    </div>
  );
}
