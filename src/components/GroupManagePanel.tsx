import { ChevronLeft, Camera, SquarePen, Info, Megaphone, Lock, BellOff, UserPlus, Pin, Eye, Ban, ChevronRight } from "lucide-react";
import type { GroupInfo, GroupBan } from "../sdk/protocol";
import { useAppServices } from "../AppServicesContext";
import { useGroupActions } from "../useGroupActions";
import { Avatar } from "./Avatar";

// 群管理二级视图（改名/头像/简介/公告/禁言/治理开关/待审/黑名单）。从 App 详情抽屉抽出的展示组件。
// **群写操作走 useAppServices()+useGroupActions**（只依赖稳定服务，不再逐层传）；碰 App UI 态的动作
// （选群头像 setCropReq、开待审/黑名单弹窗）由 props 注入。DOM/className/结构与原内联逐字一致（行为等价）。
export function GroupManagePanel({ gp, groupBans, onBack, onPickAvatar, onOpenJoinRequests, onOpenBans }: {
  gp: GroupInfo;
  groupBans: GroupBan[] | null;
  onBack: () => void;
  onPickAvatar: (gp: GroupInfo) => void;
  onOpenJoinRequests: (cid: string) => void;
  onOpenBans: (cid: string) => void;
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
    </div>
  );
}
