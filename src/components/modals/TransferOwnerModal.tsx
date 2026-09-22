import { useMemo, useState } from "react";
import type { GroupMember } from "../../sdk/protocol";
import { filterByQuery } from "../../listSearch";
import { memberSubtitle } from "../../groupAdmin";
import { ListSearchInput, isSearching } from "../ListSearchInput";
import { Modal } from "../Modal";
import { Avatar } from "../Avatar";
import { useT } from "../../i18n";

/**
 * 选择新群主：**单选即确认**——点中一行立刻走二次确认，不再要求点一次「确定」。
 * 转让是"选谁"而不是"选一批"，多一步确认按钮只会让人以为还能多选。
 */
export function TransferOwnerModal({ candidates, memberLabel, onPick, onCancel, remote }: {
  candidates: GroupMember[];
  /** 本机显示名（备注 > 群昵称 > 昵称）；确认文案也用它，纯本机渲染。 */
  memberLabel: (m: GroupMember) => string;
  /** 点中某人：调用方弹二次确认，确认后才发 transferGroup。 */
  onPick: (m: GroupMember) => void;
  onCancel: () => void;
  /**
   * **远端搜索模式**（超级群）：给了它就不做本地过滤——`candidates` 已经是服务端按 query
   * 命中的结果。超级群的成员是 2 万人，端上只有治理集，本地过滤等于"在几个人里搜 2 万人"。
   */
  remote?: { query: string; setQuery: (v: string) => void; failed: boolean };
}) {
  const tr = useT();
  const [localQ, setLocalQ] = useState("");
  const q = remote ? remote.query : localQ;
  const setQ = remote ? remote.setQuery : setLocalQ;
  // 远端模式下服务端已按 q 过滤过，再本地过一遍会**二次收窄**（服务端三源命中，本地只认两源）。
  const visible = useMemo(
    () => (remote ? candidates
                  : filterByQuery(candidates, q, (m) => [memberLabel(m), m.username, m.group_nickname])),
    [candidates, q, memberLabel, remote]);

  return (
    <Modal onClose={onCancel}>
      <h3>{tr("group.transfer_owner.title")}</h3>
      {(remote || candidates.length > 0) && <ListSearchInput value={q} onChange={setQ} placeholder={tr("group.picker.search_placeholder")} />}
      {visible.length === 0 && (
        <div className="empty">
          {remote?.failed ? tr("group.picker.search_failed")
            : isSearching(q) ? tr("group.picker.no_match")
            : remote ? tr("group.picker.search_hint") : tr("group.picker.no_others")}
        </div>
      )}
      <div className="modal-list">
        {visible.map((m) => {
          const sub = memberSubtitle(m);
          return (
            <button key={m.user_id} className="check-row" onClick={() => onPick(m)}>
              <Avatar url={m.avatar_url} label={memberLabel(m)} seed={m.user_id} />
              <span className="row-label">{sub ? `${memberLabel(m)}  ${sub}` : memberLabel(m)}</span>
              {m.role === "admin" && <span className="role-badge">{tr("group.role.admin")}</span>}
            </button>
          );
        })}
      </div>
      <div className="detail-foot-note">{tr("group.transfer_owner.warning")}</div>
      <div className="modal-actions">
        <button className="link" onClick={onCancel}>{tr("common.cancel")}</button>
      </div>
    </Modal>
  );
}
