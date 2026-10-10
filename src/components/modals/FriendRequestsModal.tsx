import type { FriendEntry } from "../../sdk/protocol";
import { Avatar } from "../Avatar";
import { Modal } from "../Modal";
import { useT } from "../../i18n";

/** 「新的朋友」弹窗（通讯录入口，群聊下方）：待我确认的申请 + 我发出去还没被通过的申请。
 *
 *  为什么独立成页而不是继续挂在通讯录列表里（2026-09-05 改）：原来它是好友列表上方的一段，
 *  好友一多就被挤到看不见，而"有人加我"恰恰是需要主动去处理的事——微信也是给它一个固定入口。
 *
 *  **三段**：待我确认 / 已发出 / 已添加（最近 30 天，设计 NEW_FRIENDS_DESIGN）。
 *  已发出**不能省**：只显示 incoming 的话，发起方点完「加好友」就再也看不到这件事的下文，
 *  既不知道自己写了什么理由，也不知道对方还没通过。 */
export function FriendRequestsModal({ incoming, outgoing, added, labelOf, busyUser, onAccept, onReject, onOpenProfile, onClose }: {
  incoming: FriendEntry[];   // status=pending：别人申请加我
  outgoing: FriendEntry[];   // status=requested：我申请加别人，待对方通过
  added: FriendEntry[];      // status=accepted 且最近 30 天（friendRequests.ts#recentAdded）：刚加上的人
  labelOf: (f: FriendEntry) => string;
  busyUser: string | null;
  onAccept: (userId: string) => void;
  onReject: (userId: string) => void;
  onOpenProfile: (userId: string) => void;   // 点「已添加」行：关弹窗并进对方资料页
  onClose: () => void;
}) {
  const tr = useT();
  const row = (f: FriendEntry, actions: React.ReactNode, opts?: { subtitle?: string; onClick?: () => void }) => (
    <div key={f.user_id} className={opts?.onClick ? "convitem" : "convitem static"} onClick={opts?.onClick}>
      <Avatar url={f.avatar_url} label={labelOf(f)} seed={f.user_id} />
      <div className="convbody">
        <div className="convpeer">{labelOf(f)}</div>
        {/* 验证消息就是这个页面存在的理由：没有它，收件人只能看着一个名字决定同不同意。
            对方没写（或老数据没有这个字段）时给一句中性说明，不显示空行也不编造内容。 */}
        {opts ? (opts.subtitle && <div className="convlast">{opts.subtitle}</div>)
          : <div className="convlast friendreq-hello">{f.hello?.trim() || tr("friend.requests.no_hello")}</div>}
      </div>
      <div className="row-actions">{actions}</div>
    </div>
  );
  return (
    <Modal onClose={onClose}>
      <h3>{tr("friend.requests.title")}</h3>
      {incoming.length === 0 && outgoing.length === 0 && added.length === 0 && <div className="empty">{tr("friend.requests.empty")}</div>}
      <div className="modal-list">
        {incoming.length > 0 && <div className="section-label">{tr("friend.requests.incoming", { count: incoming.length })}</div>}
        {incoming.map((f) => row(f, (
          <>
            <button className="mini-btn" disabled={busyUser === f.user_id} onClick={() => onAccept(f.user_id)}>{tr("common.agree")}</button>
            <button className="mini-btn ghost" disabled={busyUser === f.user_id} onClick={() => onReject(f.user_id)}>{tr("common.reject")}</button>
          </>
        )))}
        {outgoing.length > 0 && <div className="section-label">{tr("friend.requests.outgoing", { count: outgoing.length })}</div>}
        {outgoing.map((f) => row(f, <button className="mini-btn ghost" disabled>{tr("friend.requests.waiting")}</button>))}
        {added.length > 0 && <div className="section-label">{tr("friend.requests.added", { count: added.length })}</div>}
        {added.map((f) => row(
          f,
          <button className="mini-btn ghost" disabled>{tr("friend.requests.added_tag")}</button>,
          { subtitle: f.username ? `@${f.username}` : "", onClick: () => { onClose(); onOpenProfile(f.user_id); } },
        ))}
      </div>
      <div className="modal-actions">
        <button className="link" onClick={onClose}>{tr("common.close")}</button>
      </div>
    </Modal>
  );
}
