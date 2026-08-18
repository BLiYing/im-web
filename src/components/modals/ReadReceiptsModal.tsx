import type { GroupMember } from "../../sdk/protocol";
import { Avatar } from "../Avatar";

export type ReadReceipts = { read: string[]; unread: string[]; tab: "read" | "unread" };

/** 已读名单（M4-8）：已读/未读两栏切换，**不显读取时刻**（位点语义给不出可靠单条时间）。 */
export function ReadReceiptsModal({ data, lookupMember, onTab, onClose }: {
  data: ReadReceipts;
  lookupMember: (id: string) => GroupMember | undefined;
  onTab: (tab: "read" | "unread") => void;
  onClose: () => void;
}) {
  const ids = data.tab === "read" ? data.read : data.unread;
  return (
    <div className="modal-mask" onClick={onClose}>
      <div className="modal readby-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-title">已读详情</div>
        <div className="readby-tabs">
          <button className={data.tab === "read" ? "on" : ""} onClick={() => onTab("read")}>
            已读 {data.read.length}
          </button>
          <button className={data.tab === "unread" ? "on" : ""} onClick={() => onTab("unread")}>
            未读 {data.unread.length}
          </button>
        </div>
        <div className="readby-list">
          {ids.map((memberId) => {
            const gm = lookupMember(memberId);
            const label = gm?.nickname || memberId;
            return (
              <div key={memberId} className="readby-row">
                <Avatar label={label} seed={memberId} url={gm?.avatar_url} cls="avatar mention-avatar" />
                <span className="mention-name">{label}</span>
                {gm?.role === "owner" && <span className="role-badge owner">群主</span>}
                {gm?.role === "admin" && <span className="role-badge">管理员</span>}
              </div>
            );
          })}
          {ids.length === 0 && (
            <div className="readby-empty">
              {data.tab === "read" ? "还没有人读过这条消息" : "所有人都已读"}
            </div>
          )}
        </div>
        <button className="modal-close" onClick={onClose}>关闭</button>
      </div>
    </div>
  );
}
