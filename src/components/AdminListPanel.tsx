import { ChevronLeft, UserPlus } from "lucide-react";
import type { GroupInfo, GroupMember } from "../sdk/protocol";
import { adminsOf, ownerOf, memberSubtitle } from "../groupAdmin";
import { Avatar } from "./Avatar";

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
            {memberLabel(m)}{m.user_id === uid && <span className="me-tag">我</span>}
          </div>
          <div className="detail-member-sub">{sub}</div>
        </div>
        <span className={`role-badge${badge === "owner" ? " owner" : ""}`}>
          {badge === "owner" ? "群主" : "管理员"}
        </span>
        {badge === "admin" && isOwner && (
          <button className="mini-btn danger" title="撤销管理员"
            onClick={(e) => { e.stopPropagation(); onRevoke(m); }}>撤销</button>
        )}
      </div>
    );
  };

  return (
    <div className="detail-manage">
      <div className="detail-manage-head">
        <button className="icon-btn" onClick={onBack}><ChevronLeft size={20} /></button>
        <span>管理员</span>
      </div>
      <div className="detail-card-title">群主</div>
      <div className="detail-card">
        {owner ? row(owner, "owner") : <div className="detail-empty">群主信息缺失</div>}
      </div>
      <div className="detail-card-title">管理员 · {admins.length}</div>
      <div className="detail-card">
        {isOwner && (
          <button className="detail-row accent" onClick={onAdd}>
            <span className="detail-row-ic"><UserPlus size={18} /></span><span>添加管理员</span>
          </button>
        )}
        {admins.length === 0
          ? <div className="detail-empty">还没有管理员</div>
          : admins.map((m) => row(m, "admin"))}
      </div>
      <div className="detail-foot-note">
        {isOwner
          ? "管理员可审批入群、禁言与移出普通成员，但不能设置管理员或转让群组。"
          : "只有群主可以增减管理员。"}
      </div>
    </div>
  );
}
