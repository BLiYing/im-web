import type { GroupBan } from "../../sdk/protocol";
import { displayNameOf } from "../../remarks";
import { Modal } from "../Modal";
import { useT } from "../../i18n";

/** 群黑名单弹窗（G2）：解除拉黑。
 *
 *  显示口径同群成员列表：主标题 `备注 → 昵称 → @username → 未命名用户`，副标题 `@username`。
 *  **不得显示 `user_id`**——它是 10 位随机内部 ID，管理员根本认不出拉黑的是谁
 *  （见 ../IMServer/docs/design/ACCOUNT_IDENTITY_REDESIGN.md §7.5）。 */
export function GroupBansModal({ bans, remarks, onUnban, onClose }: {
  bans: GroupBan[];
  remarks: Map<string, string>;
  onUnban: (userId: string) => void;
  onClose: () => void;
}) {
  const tr = useT();
  return (
    <Modal className="modal pinned-modal" onClose={onClose}>
        <div className="modal-title">{tr("group.bans.title", { count: bans.length })}</div>
        <div className="pinned-list">
          {bans.length === 0 ? (
            <div className="detail-empty">{tr("group.bans.empty")}</div>
          ) : bans.map((b) => (
            <div className="pinned-row" key={b.user_id}>
              <div className="pinned-row-main" style={{ cursor: "default" }}>
                <span className="pinned-row-from">{displayNameOf(b.user_id, remarks, b.nickname, b.username)}</span>
                <span className="pinned-row-text">
                  {b.username ? `@${b.username} · ` : ""}{b.expires_at === 0 ? tr("common.permanent") : tr("group.bans.cooling")}
                </span>
              </div>
              <button className="mini-btn danger" onClick={() => onUnban(b.user_id)}>{tr("group.bans.unban")}</button>
            </div>
          ))}
        </div>
        <button className="modal-close" onClick={onClose}>{tr("common.close")}</button>
    </Modal>
  );
}
