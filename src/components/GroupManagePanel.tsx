import { ChevronLeft, Camera, SquarePen, Info, Megaphone, Lock, BellOff, UserPlus, Pin, Eye, Ban, ChevronRight, ShieldCheck, Crown } from "lucide-react";
import type { GroupInfo, GroupBan } from "../sdk/protocol";
import { useAppServices } from "../AppServicesContext";
import { useGroupActions } from "../useGroupActions";
import { adminCountText } from "../groupAdmin";
import { Avatar } from "./Avatar";

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
  return (
    <div className="detail-manage">
      <div className="detail-manage-head">
        <button className="icon-btn" onClick={onBack}><ChevronLeft size={20} /></button>
        <span>群管理</span>
      </div>
      <div className="detail-manage-avatar">
        <button className="detail-manage-avatar-btn" onClick={() => onPickAvatar(gp)}>
          <Avatar url={gp.avatar_url} label={gp.name} seed={gp.conv_id} cls="detail-avatar" />
          <span className="detail-manage-cam"><Camera size={18} /></span>
        </button>
        <div className="detail-manage-caption">设置新头像</div>
      </div>
      <div className="detail-card">
        <button className="detail-row" onClick={() => void doRenameGroup(gp)}>
          <span className="detail-row-ic"><SquarePen size={18} /></span><span>群名称</span>
          <span className="detail-row-val">{gp.name}</span><ChevronRight size={16} className="detail-row-chev" />
        </button>
        <button className="detail-row" onClick={() => void doEditIntro(gp)}>
          <span className="detail-row-ic"><Info size={18} /></span><span>简介</span>
          <span className="detail-row-val">{gp.intro || "未填写"}</span><ChevronRight size={16} className="detail-row-chev" />
        </button>
        <button className="detail-row" onClick={() => void doEditAnnouncement(gp)}>
          <span className="detail-row-ic"><Megaphone size={18} /></span><span>群公告</span>
          <span className="detail-row-val">{gp.announcement ? "已发布" : "未发布"}</span><ChevronRight size={16} className="detail-row-chev" />
        </button>
      </div>
      <div className="detail-card-title">加入与发言</div>
      <div className="detail-card">
        <div className="detail-row"><span className="detail-row-ic"><Lock size={18} /></span><span>进群确认</span>
          <button className={`switch ${gp.join_approval ? "on" : ""}`}
            onClick={() => void doToggleGroupSetting(gp, "join_approval")} /></div>
        <div className="detail-row"><span className="detail-row-ic"><BellOff size={18} /></span><span>全员禁言</span>
          <button className={`switch ${(gp.mute_until ?? 0) > Date.now() ? "on" : ""}`}
            onClick={() => void doToggleGroupMute(gp, !((gp.mute_until ?? 0) > Date.now()))} /></div>
      </div>
      <div className="detail-card-title">成员权限</div>
      <div className="detail-card">
        <div className="detail-row"><span className="detail-row-ic"><UserPlus size={18} /></span><span>仅管理员可邀请</span>
          <button className={`switch ${gp.perm_invite ? "on" : ""}`}
            onClick={() => void doToggleGroupSetting(gp, "perm_invite")} /></div>
        <div className="detail-row"><span className="detail-row-ic"><SquarePen size={18} /></span><span>仅管理员可改群资料</span>
          <button className={`switch ${gp.perm_edit_info ? "on" : ""}`}
            onClick={() => void doToggleGroupSetting(gp, "perm_edit_info")} /></div>
        <div className="detail-row"><span className="detail-row-ic"><Pin size={18} /></span><span>仅管理员可置顶消息</span>
          <button className={`switch ${gp.perm_pin ? "on" : ""}`}
            onClick={() => void doToggleGroupSetting(gp, "perm_pin")} /></div>
        <div className="detail-row"><span className="detail-row-ic"><Eye size={18} /></span><span>新成员仅可见入群后历史</span>
          <button className={`switch ${gp.history_visible ? "on" : ""}`}
            onClick={() => void doToggleGroupSetting(gp, "history_visible")} /></div>
      </div>
      <div className="detail-card-title">治理</div>
      <div className="detail-card">
        <button className="detail-row" onClick={() => void onOpenJoinRequests(gp.conv_id)}>
          <span className="detail-row-ic"><UserPlus size={18} /></span><span>待审入群申请</span>
          <span className="detail-row-val">{gp.pending_count ? `${gp.pending_count} 待处理` : "无"}</span><ChevronRight size={16} className="detail-row-chev" />
        </button>
        <button className="detail-row" onClick={() => void onOpenBans(gp.conv_id)}>
          <span className="detail-row-ic"><Ban size={18} /></span><span>黑名单</span>
          <span className="detail-row-val">{groupBans ? `${groupBans.length} 人` : ""}</span><ChevronRight size={16} className="detail-row-chev" />
        </button>
      </div>
      <div className="detail-foot-note">「新成员仅可见入群后历史」开启后，新成员看不到加入前的聊天记录。</div>
      {/* 管理员：群主可增删、管理员只读。此前「设为管理员」只藏在成员行的 ⋯ 菜单里，
          既不好发现，也没有任何一处能回答"这个群有几个管理员"。 */}
      <div className="detail-card-title">管理员</div>
      <div className="detail-card">
        <button className="detail-row" onClick={() => onOpenAdmins(gp.conv_id)}>
          <span className="detail-row-ic"><ShieldCheck size={18} /></span><span>管理员</span>
          <span className="detail-row-val">{adminCountText(gp)}</span>
          <ChevronRight size={16} className="detail-row-chev" />
        </button>
      </div>
      <div className="detail-foot-note">管理员可审批入群、禁言与移出普通成员，但不能设置管理员或转让群组。</div>
      {/* 转让群组：**仅群主**。单开一张带红字的卡，与「解散群组」同族——不可逆的一次性操作
          不该和会反复进出的「治理」项混在一张卡里（手指一滑就点到旁边）。 */}
      {gp.my_role === "owner" && (<>
        <div className="detail-card-title">群主</div>
        <div className="detail-card">
          <button className="detail-row danger" onClick={() => onOpenTransfer(gp.conv_id)}>
            <span className="detail-row-ic"><Crown size={18} /></span><span>转让群组</span>
            <ChevronRight size={16} className="detail-row-chev end" />
          </button>
        </div>
        <div className="detail-foot-note">转让后你将立即变为普通成员，且不可撤销。群主不能直接退群，须先转让。</div>
      </>)}
    </div>
  );
}
