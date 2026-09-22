import type { GroupMember } from "../../sdk/protocol";
import { Avatar } from "../Avatar";
import { Modal } from "../Modal";
import { useT } from "../../i18n";

export type ReadReceipts = { read: string[]; unread: string[]; tab: "read" | "unread" };

/** 已读名单（M4-8）：已读/未读两栏切换，**不显读取时刻**（位点语义给不出可靠单条时间）。 */
export function ReadReceiptsModal({ data, lookupMember, memberLabel, onTab, onClose }: {
  data: ReadReceipts;
  lookupMember: (id: string) => GroupMember | undefined;
  /** 成员在本机列表里的显示名：备注 > 群昵称 > 昵称 > uid。 */
  memberLabel: (m: GroupMember) => string;
  onTab: (tab: "read" | "unread") => void;
  onClose: () => void;
}) {
  const tr = useT();
  const ids = data.tab === "read" ? data.read : data.unread;
  return (
    <Modal className="modal readby-modal" onClose={onClose}>
        <div className="modal-title">{tr("receipts.title")}</div>
        <div className="readby-tabs">
          <button className={data.tab === "read" ? "on" : ""} onClick={() => onTab("read")}>
            {tr("receipts.tab_read", { count: data.read.length })}
          </button>
          <button className={data.tab === "unread" ? "on" : ""} onClick={() => onTab("unread")}>
            {tr("receipts.tab_unread", { count: data.unread.length })}
          </button>
        </div>
        <div className="readby-list">
          {ids.map((memberId) => {
            const gm = lookupMember(memberId);
            const label = gm ? memberLabel(gm) : memberId; // 备注 > 群昵称 > 昵称（本机显示）
            return (
              <div key={memberId} className="readby-row">
                <Avatar label={label} seed={memberId} url={gm?.avatar_url} cls="avatar mention-avatar" />
                <span className="mention-name">{label}</span>
                {gm?.role === "owner" && <span className="role-badge owner">{tr("group.role.owner")}</span>}
                {gm?.role === "admin" && <span className="role-badge">{tr("group.role.admin")}</span>}
              </div>
            );
          })}
          {ids.length === 0 && (
            <div className="readby-empty">
              {data.tab === "read" ? tr("receipts.empty_read") : tr("receipts.empty_unread")}
            </div>
          )}
        </div>
        <button className="modal-close" onClick={onClose}>{tr("common.close")}</button>
    </Modal>
  );
}
