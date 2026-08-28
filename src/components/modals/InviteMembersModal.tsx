import { useMemo, useState } from "react";
import type { FriendEntry } from "../../sdk/protocol";
import { filterByQuery } from "../../listSearch";
import { ListSearchInput, isSearching } from "../ListSearchInput";
import { Modal } from "../Modal";
import { CheckRow } from "../rows";

/** 邀请成员弹窗：不在群内的好友多选。 */
export function InviteMembersModal({ selected, candidates, friendLabel, onToggle, onInvite, onCancel }: {
  selected: string[];
  candidates: FriendEntry[]; // 已排除在群内的好友
  friendLabel: (f: FriendEntry) => string;
  onToggle: (userId: string) => void;
  onInvite: () => void;
  onCancel: () => void;
}) {
  const [q, setQ] = useState("");
  // 可见行按显示名（含好友备注）与 uid 匹配；选中集 selected 存的是 uid、与过滤无关，
  // 先勾选再搜索把人过滤掉，点「邀请」时仍会带上他。
  const visible = useMemo(() => filterByQuery(candidates, q, (f) => [friendLabel(f), f.user_id]),
    [candidates, q, friendLabel]);

  return (
    <Modal onClose={onCancel}>
        <h3>邀请成员</h3>
        {candidates.length > 0 && <ListSearchInput value={q} onChange={setQ} placeholder="搜索好友" />}
        {visible.length === 0 && (
          <div className="empty">{isSearching(q) ? "没有匹配的好友" : "好友都已在群里了"}</div>
        )}
        <div className="modal-list">
          {visible.map((f) => (
            <CheckRow key={f.user_id} selected={selected.includes(f.user_id)} url={f.avatar_url}
              label={friendLabel(f)} seed={f.user_id} onClick={() => onToggle(f.user_id)} />
          ))}
        </div>
        <div className="modal-actions">
          <button className="link" onClick={onCancel}>取消</button>
          <button className="mini-btn" disabled={selected.length === 0} onClick={onInvite}>
            邀请{selected.length > 0 ? `（${selected.length}）` : ""}
          </button>
        </div>
    </Modal>
  );
}
