import type { GroupBan } from "../../sdk/protocol";

/** 群黑名单弹窗（G2）：解除拉黑。 */
export function GroupBansModal({ bans, onUnban, onClose }: {
  bans: GroupBan[];
  onUnban: (userId: string) => void;
  onClose: () => void;
}) {
  return (
    <div className="modal-mask" onClick={onClose}>
      <div className="modal pinned-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-title">黑名单（{bans.length}）</div>
        <div className="pinned-list">
          {bans.length === 0 ? (
            <div className="detail-empty">暂无被拉黑成员</div>
          ) : bans.map((b) => (
            <div className="pinned-row" key={b.user_id}>
              <div className="pinned-row-main" style={{ cursor: "default" }}>
                <span className="pinned-row-from">{b.user_id}</span>
                <span className="pinned-row-text">{b.expires_at === 0 ? "永久" : "冷却中"}</span>
              </div>
              <button className="mini-btn danger" onClick={() => onUnban(b.user_id)}>解除</button>
            </div>
          ))}
        </div>
        <button className="modal-close" onClick={onClose}>关闭</button>
      </div>
    </div>
  );
}
