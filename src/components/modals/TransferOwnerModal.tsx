import { useMemo, useState } from "react";
import type { GroupMember } from "../../sdk/protocol";
import { filterByQuery } from "../../listSearch";
import { memberSubtitle } from "../../groupAdmin";
import { ListSearchInput, isSearching } from "../ListSearchInput";
import { Modal } from "../Modal";
import { Avatar } from "../Avatar";

/**
 * 选择新群主：**单选即确认**——点中一行立刻走二次确认，不再要求点一次「确定」。
 * 转让是"选谁"而不是"选一批"，多一步确认按钮只会让人以为还能多选。
 */
export function TransferOwnerModal({ candidates, memberLabel, onPick, onCancel }: {
  candidates: GroupMember[];
  /** 本机显示名（备注 > 群昵称 > 昵称）；确认文案也用它，纯本机渲染。 */
  memberLabel: (m: GroupMember) => string;
  /** 点中某人：调用方弹二次确认，确认后才发 transferGroup。 */
  onPick: (m: GroupMember) => void;
  onCancel: () => void;
}) {
  const [q, setQ] = useState("");
  const visible = useMemo(
    () => filterByQuery(candidates, q, (m) => [memberLabel(m), m.username, m.group_nickname]),
    [candidates, q, memberLabel]);

  return (
    <Modal onClose={onCancel}>
      <h3>选择新群主</h3>
      {candidates.length > 0 && <ListSearchInput value={q} onChange={setQ} placeholder="搜索群成员" />}
      {visible.length === 0 && (
        <div className="empty">{isSearching(q) ? "没有匹配的成员" : "群里还没有其他成员"}</div>
      )}
      <div className="modal-list">
        {visible.map((m) => {
          const sub = memberSubtitle(m);
          return (
            <button key={m.user_id} className="check-row" onClick={() => onPick(m)}>
              <Avatar url={m.avatar_url} label={memberLabel(m)} seed={m.user_id} />
              <span className="row-label">{sub ? `${memberLabel(m)}  ${sub}` : memberLabel(m)}</span>
              {m.role === "admin" && <span className="role-badge">管理员</span>}
            </button>
          );
        })}
      </div>
      <div className="detail-foot-note">转让后你将立即变为普通成员，且不可撤销。</div>
      <div className="modal-actions">
        <button className="link" onClick={onCancel}>取消</button>
      </div>
    </Modal>
  );
}
