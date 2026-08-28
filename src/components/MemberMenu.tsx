import type { Ref } from "react";
import type { GroupInfo, GroupMember, FriendEntry } from "../sdk/protocol";
import { useAppServices } from "../AppServicesContext";
import { useGroupActions } from "../useGroupActions";

// 群成员管理 ⋯ 菜单（按角色矩阵显隐；服务端仍二次校验）。从 App 抽出的展示组件。
// 群写操作走 useAppServices()+useGroupActions（doGroupAction 骨架）；发消息/加好友/禁言时长弹窗等碰 App 态的
// 动作由 props 注入。DOM/className/定位逐字一致（行为等价）。
export function MemberMenu({ menu, gp, uid, friends, menuRef, onClose, onOpenChat, onFriendAction, onMutePick, memberLabel }: {
  menu: { x: number; y: number; convId: string; m: GroupMember };
  gp: GroupInfo;
  uid: string;
  friends: FriendEntry[];
  menuRef: Ref<HTMLDivElement>;
  onClose: () => void;
  onOpenChat: (userId: string) => void;
  onFriendAction: (userId: string, fn: () => Promise<void>) => void;
  /** 成员在本机确认文案里的显示名：备注 > 群昵称 > 昵称 > uid。 */
  memberLabel: (m: GroupMember) => string;
  onMutePick: (sel: { convId: string; m: GroupMember }) => void;
}) {
  const services = useAppServices();
  const { clientRef, setToast, askConfirm } = services;
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
        <button onClick={() => { onClose(); onOpenChat(m.user_id); }}>发送消息</button>
      )}
      {!isSelf && !isMemberFriend && (
        <button onClick={() => { onClose(); onFriendAction(m.user_id, async () => {
          const becameFriend = await clientRef.current!.requestFriend(m.user_id);
          if (!becameFriend) { setToast("已发送好友申请"); } // 直接成为好友时不吐司（见 requestFriend 注释）
        }); }}>添加好友</button>
      )}
      {gp.my_role === "owner" && m.role === "member" && (
        <button onClick={() => run(() => clientRef.current!.setGroupRole(cid, m.user_id, "admin"))}>设为管理员</button>
      )}
      {gp.my_role === "owner" && m.role === "admin" && (
        <button onClick={() => run(() => clientRef.current!.setGroupRole(cid, m.user_id, "member"))}>撤销管理员</button>
      )}
      {gp.my_role === "owner" && (
        <button onClick={() => {
          onClose();
          void askConfirm(`确定把群主转让给 ${memberLabel(m)}？你将变为普通成员。`, { okText: "转让", danger: true }).then((ok) => {
            if (ok) void doGroupAction(cid, () => clientRef.current!.transferGroup(cid, m.user_id));
          });
        }}>转让群主</button>
      )}
      {/* 禁言 / 解禁（G2）：已禁言显解除，否则弹时长选择。 */}
      {(m.mute_until ?? 0) > Date.now() ? (
        <button onClick={() => run(() => clientRef.current!.muteGroupMember(cid, m.user_id, 0))}>解除禁言</button>
      ) : (
        <button onClick={() => { onClose(); onMutePick({ convId: cid, m }); }}>禁言…</button>
      )}
      <button className="danger" onClick={() => {
        onClose();
        void askConfirm(`确定把 ${memberLabel(m)} 移出群聊？24 小时内不可再被邀请。`, { okText: "移出", danger: true }).then((ok) => {
          if (ok) void doGroupAction(cid, () => clientRef.current!.removeGroupMemberWithBan(cid, m.user_id, "cooldown"));
        });
      }}>移出群聊</button>
      <button className="danger" onClick={() => {
        onClose();
        void askConfirm(`确定把 ${memberLabel(m)} 移出并不再允许加入？`, { okText: "移出并拉黑", danger: true }).then((ok) => {
          if (ok) void doGroupAction(cid, () => clientRef.current!.removeGroupMemberWithBan(cid, m.user_id, "forever"));
        });
      }}>移出并不再允许加入</button>
    </div>
  );
}
