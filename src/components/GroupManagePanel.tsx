import { ChevronLeft, Camera, SquarePen, Info, Megaphone, Lock, BellOff, UserPlus, Pin, Eye, Ban, ChevronRight, ShieldCheck, Crown } from "lucide-react";
import type { GroupInfo, GroupBan } from "../sdk/protocol";
import { useAppServices } from "../AppServicesContext";
import { useGroupActions } from "../useGroupActions";
import { adminCountText } from "../groupAdmin";
import { Avatar } from "./Avatar";
import { useT } from "../i18n";

// 群管理二级视图（改名/头像/简介/公告/禁言/治理开关/待审/黑名单）。从 App 详情抽屉抽出的展示组件。
// **群写操作走 useAppServices()+useGroupActions**（只依赖稳定服务，不再逐层传）；碰 App UI 态的动作
// （选群头像 setCropReq、开待审/黑名单弹窗）由 props 注入。DOM/className/结构与原内联逐字一致（行为等价）。
export function GroupManagePanel({ gp, groupBans, onBack, onPickAvatar, onOpenJoinRequests, onOpenBans, onOpenAdmins, onOpenTransfer }: {
  gp: GroupInfo;
  groupBans: GroupBan[] | null;
  onBack: () => void;
  onPickAvatar: (gp: GroupInfo) => void;
  onOpenJoinRequests: (cid: string) => void;
  onOpenBans: (cid: string) => void;
  /** 打开「管理员」二级面板（群主可增删、管理员只读）。 */
  onOpenAdmins: (cid: string) => void;
  /** 打开「选择新群主」弹窗（仅群主可见此行）。 */
  onOpenTransfer: (cid: string) => void;
}) {
  const { doRenameGroup, doEditIntro, doEditAnnouncement, doToggleGroupSetting, doToggleGroupMute } = useGroupActions(useAppServices());
  const tr = useT();
  return (
    <div className="detail-manage">
      <div className="detail-manage-head">
        <button className="icon-btn" onClick={onBack}><ChevronLeft size={20} /></button>
        <span>{tr("group.manage.title")}</span>
      </div>
      <div className="detail-manage-avatar">
        <button className="detail-manage-avatar-btn" onClick={() => onPickAvatar(gp)}>
          <Avatar url={gp.avatar_url} label={gp.name} seed={gp.conv_id} cls="detail-avatar" />
          <span className="detail-manage-cam"><Camera size={18} /></span>
        </button>
        <div className="detail-manage-caption">{tr("group.avatar.set_new")}</div>
      </div>
      <div className="detail-card">
        <button className="detail-row" onClick={() => void doRenameGroup(gp)}>
          <span className="detail-row-ic"><SquarePen size={18} /></span><span>{tr("group.create.name_label")}</span>
          <span className="detail-row-val">{gp.name}</span><ChevronRight size={16} className="detail-row-chev" />
        </button>
        <button className="detail-row" onClick={() => void doEditIntro(gp)}>
          <span className="detail-row-ic"><Info size={18} /></span><span>{tr("group.manage.intro_label")}</span>
          <span className="detail-row-val">{gp.intro || tr("group.manage.intro_empty")}</span><ChevronRight size={16} className="detail-row-chev" />
        </button>
        <button className="detail-row" onClick={() => void doEditAnnouncement(gp)}>
          <span className="detail-row-ic"><Megaphone size={18} /></span><span>{tr("group.text.announcement")}</span>
          <span className="detail-row-val">{gp.announcement ? tr("group.manage.announcement_published") : tr("group.manage.announcement_unpublished")}</span><ChevronRight size={16} className="detail-row-chev" />
        </button>
      </div>
      <div className="detail-card-title">{tr("group.manage.section_join")}</div>
      <div className="detail-card">
        <div className="detail-row"><span className="detail-row-ic"><Lock size={18} /></span><span>{tr("group.manage.join_approval")}</span>
          <button className={`switch ${gp.join_approval ? "on" : ""}`}
            onClick={() => void doToggleGroupSetting(gp, "join_approval")} /></div>
        <div className="detail-row"><span className="detail-row-ic"><BellOff size={18} /></span><span>{tr("group.manage.mute_all")}</span>
          <button className={`switch ${(gp.mute_until ?? 0) > Date.now() ? "on" : ""}`}
            onClick={() => void doToggleGroupMute(gp, !((gp.mute_until ?? 0) > Date.now()))} /></div>
      </div>
      <div className="detail-card-title">{tr("group.manage.section_permissions")}</div>
      <div className="detail-card">
        <div className="detail-row"><span className="detail-row-ic"><UserPlus size={18} /></span><span>{tr("group.manage.perm_invite")}</span>
          <button className={`switch ${gp.perm_invite ? "on" : ""}`}
            onClick={() => void doToggleGroupSetting(gp, "perm_invite")} /></div>
        <div className="detail-row"><span className="detail-row-ic"><SquarePen size={18} /></span><span>{tr("group.manage.perm_edit_info")}</span>
          <button className={`switch ${gp.perm_edit_info ? "on" : ""}`}
            onClick={() => void doToggleGroupSetting(gp, "perm_edit_info")} /></div>
        <div className="detail-row"><span className="detail-row-ic"><Pin size={18} /></span><span>{tr("group.manage.perm_pin")}</span>
          <button className={`switch ${gp.perm_pin ? "on" : ""}`}
            onClick={() => void doToggleGroupSetting(gp, "perm_pin")} /></div>
        <div className="detail-row"><span className="detail-row-ic"><Eye size={18} /></span><span>{tr("group.manage.history_visible")}</span>
          <button className={`switch ${gp.history_visible ? "on" : ""}`}
            onClick={() => void doToggleGroupSetting(gp, "history_visible")} /></div>
      </div>
      <div className="detail-card-title">{tr("group.manage.section_governance")}</div>
      <div className="detail-card">
        <button className="detail-row" onClick={() => void onOpenJoinRequests(gp.conv_id)}>
          <span className="detail-row-ic"><UserPlus size={18} /></span><span>{tr("qr.join_req.list_title")}</span>
          <span className="detail-row-val">{gp.pending_count ? tr("group.manage.pending_count", { count: gp.pending_count }) : tr("group.manage.pending_none")}</span><ChevronRight size={16} className="detail-row-chev" />
        </button>
        <button className="detail-row" onClick={() => void onOpenBans(gp.conv_id)}>
          <span className="detail-row-ic"><Ban size={18} /></span><span>{tr("group.manage.blacklist")}</span>
          <span className="detail-row-val">{groupBans ? tr("group.manage.ban_count", { count: groupBans.length }) : ""}</span><ChevronRight size={16} className="detail-row-chev" />
        </button>
      </div>
      <div className="detail-foot-note">{tr("group.manage.history_note")}</div>
      {/* 管理员：群主可增删、管理员只读。此前「设为管理员」只藏在成员行的 ⋯ 菜单里，
          既不好发现，也没有任何一处能回答"这个群有几个管理员"。 */}
      <div className="detail-card-title">{tr("group.role.admin")}</div>
      <div className="detail-card">
        <button className="detail-row" onClick={() => onOpenAdmins(gp.conv_id)}>
          <span className="detail-row-ic"><ShieldCheck size={18} /></span><span>{tr("group.role.admin")}</span>
          <span className="detail-row-val">{adminCountText(gp)}</span>
          <ChevronRight size={16} className="detail-row-chev" />
        </button>
      </div>
      <div className="detail-foot-note">{tr("group.manage.permission_note")}</div>
      {/* 转让群组：**仅群主**。单开一张带红字的卡，与「解散群组」同族——不可逆的一次性操作
          不该和会反复进出的「治理」项混在一张卡里（手指一滑就点到旁边）。 */}
      {gp.my_role === "owner" && (<>
        <div className="detail-card-title">{tr("group.role.owner")}</div>
        <div className="detail-card">
          <button className="detail-row danger" onClick={() => onOpenTransfer(gp.conv_id)}>
            <span className="detail-row-ic"><Crown size={18} /></span><span>{tr("group.manage.transfer_group")}</span>
            <ChevronRight size={16} className="detail-row-chev end" />
          </button>
        </div>
        <div className="detail-foot-note">{tr("group.manage.transfer_warning")}</div>
      </>)}
    </div>
  );
}
