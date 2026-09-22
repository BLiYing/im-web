import type { Ref } from "react";
import type { GroupInfo, GroupMember, FriendEntry } from "../sdk/protocol";
import { useAppServices } from "../AppServicesContext";
import { useGroupActions } from "../useGroupActions";
import { useT } from "../i18n";

// 群成员管理 ⋯ 菜单（按角色矩阵显隐；服务端仍二次校验）。从 App 抽出的展示组件。
// 群写操作走 useAppServices()+useGroupActions（doGroupAction 骨架）；发消息/加好友/禁言时长弹窗等碰 App 态的
// 动作由 props 注入。DOM/className/定位逐字一致（行为等价）。
export function MemberMenu({ menu, gp, uid, friends, menuRef, onClose, onOpenChat, onMutePick, memberLabel }: {
  menu: { x: number; y: number; convId: string; m: GroupMember };
  gp: GroupInfo;
  uid: string;
  friends: FriendEntry[];
  menuRef: Ref<HTMLDivElement>;
  onClose: () => void;
  onOpenChat: (userId: string) => void;
  /** 成员在本机确认文案里的显示名：备注 > 群昵称 > 昵称 > uid。 */
  memberLabel: (m: GroupMember) => string;
  onMutePick: (sel: { convId: string; m: GroupMember }) => void;
}) {
  const tr = useT();
  const services = useAppServices();
  const { clientRef, askConfirm, askFriendRequest } = services;
  const { doGroupAction } = useGroupActions(services);
  const cid = menu.convId;
  const m = menu.m;
  const run = (fn: () => Promise<void>) => { onClose(); void doGroupAction(cid, fn); };
  // 好友准入（微信式，任务一 P0）：好友 → 「发送消息」；非好友 → 「添加好友」（非好友发消息会被 200103 拒收）。
  const isSelf = m.user_id === uid;
  const isMemberFriend = friends.some((f) => f.user_id === m.user_id && f.status === "accepted");
  return (
    // 锚定在点击点的左上方（right/bottom 定位，菜单向左上展开）：⋯ 按钮贴屏幕右缘、成员行偏下，
    // 原 left/top 向右下展开会把菜单推出视口（选项被截断看不到）。
    <div ref={menuRef} className="ctx-menu" style={{ right: window.innerWidth - menu.x, bottom: window.innerHeight - menu.y }} onClick={(e) => e.stopPropagation()}>
      {!isSelf && isMemberFriend && (
        <button onClick={() => { onClose(); onOpenChat(m.user_id); }}>{tr("group.member_action.send_message")}</button>
      )}
      {/* 加好友走全站统一的「发好友申请」弹窗（填验证消息），不直接调接口。 */}
      {!isSelf && !isMemberFriend && (
        <button onClick={() => { onClose(); askFriendRequest(m.user_id, memberLabel(m)); }}>{tr("common.add_friend")}</button>
      )}
      {gp.my_role === "owner" && m.role === "member" && (
        <button onClick={() => run(() => clientRef.current!.setGroupRole(cid, m.user_id, "admin"))}>{tr("group.member_action.make_admin")}</button>
      )}
      {gp.my_role === "owner" && m.role === "admin" && (
        <button onClick={() => run(() => clientRef.current!.setGroupRole(cid, m.user_id, "member"))}>{tr("group.member_action.revoke_admin")}</button>
      )}
      {gp.my_role === "owner" && (
        <button onClick={() => {
          onClose();
          void askConfirm(tr("group.transfer_owner.message", { name: memberLabel(m) }), { okText: tr("group.transfer_owner.confirm"), danger: true }).then((ok) => {
            if (ok) void doGroupAction(cid, () => clientRef.current!.transferGroup(cid, m.user_id));
          });
        }}>{tr("group.member_action.transfer_owner")}</button>
      )}
      {/* 禁言 / 解禁（G2）：已禁言显解除，否则弹时长选择。 */}
      {(m.mute_until ?? 0) > Date.now() ? (
        <button onClick={() => run(() => clientRef.current!.muteGroupMember(cid, m.user_id, 0))}>{tr("group.member_action.unmute")}</button>
      ) : (
        <button onClick={() => { onClose(); onMutePick({ convId: cid, m }); }}>{tr("group.member_action.mute")}</button>
      )}
      <button className="danger" onClick={() => {
        onClose();
        void askConfirm(tr("group.member_action.remove_confirm_message", { name: memberLabel(m) }), { okText: tr("group.member_action.remove_confirm_ok"), danger: true }).then((ok) => {
          if (ok) void doGroupAction(cid, () => clientRef.current!.removeGroupMemberWithBan(cid, m.user_id, "cooldown"));
        });
      }}>{tr("group.member_action.remove")}</button>
      <button className="danger" onClick={() => {
        onClose();
        void askConfirm(tr("group.member_action.remove_and_ban_confirm_message", { name: memberLabel(m) }), { okText: tr("group.member_action.remove_and_ban_confirm_ok"), danger: true }).then((ok) => {
          if (ok) void doGroupAction(cid, () => clientRef.current!.removeGroupMemberWithBan(cid, m.user_id, "forever"));
        });
      }}>{tr("group.member_action.remove_and_ban")}</button>
    </div>
  );
}
