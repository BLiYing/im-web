import { useMemo, useState } from "react";
import type { FriendEntry } from "../../sdk/protocol";
import { filterByQuery } from "../../listSearch";
import { ListSearchInput, isSearching } from "../ListSearchInput";
import { Modal } from "../Modal";
import { CheckRow } from "../rows";

export type CreateGroupDraft = { name: string; selected: string[] };

/** 建群弹窗：群名 + 好友多选（全选按上限截断，群主占 1 席）。 */
export function CreateGroupModal({ draft, accepted, friendLabel, busy, maxInitialMembers, onChange, onCreate, onCancel }: {
  draft: CreateGroupDraft;
  accepted: FriendEntry[];
  friendLabel: (f: FriendEntry) => string;
  busy: boolean;
  maxInitialMembers: number;
  onChange: (next: CreateGroupDraft) => void;
  onCreate: () => void;
  onCancel: () => void;
}) {
  const [q, setQ] = useState("");
  // 可见行按显示名（含好友备注）与 uid 匹配；选中集存的是 uid、与过滤无关，
  // 先勾选再搜索把人过滤掉，点「创建」时仍会带上他。
  const visible = useMemo(() => filterByQuery(accepted, q, (f) => [friendLabel(f), f.user_id]),
    [accepted, q, friendLabel]);

  return (
    <Modal onClose={onCancel}>
        <h3>创建群聊</h3>
        <label>群名<input value={draft.name} maxLength={30} placeholder="1~30 字" autoFocus
          onChange={(e) => onChange({ ...draft, name: e.target.value })} /></label>
        <div className="section-label with-action">
          <span>选择好友（已选 {draft.selected.length}）</span>
          {visible.length > 0 && (() => {
            // 全选只作用于**当前可见行**：搜了「张」还去勾上没显示的两百人，用户不会预期。
            // 无搜索词时 visible === accepted，行为与加搜索前一致。
            // 上限 = maxInitialMembers（群主占 1 席）：并集后截断，已选的人不会被全选清掉。
            const visibleIds = visible.map((f) => f.user_id);
            const allOn = visibleIds.every((id) => draft.selected.includes(id));
            const next = allOn
              ? draft.selected.filter((id) => !visibleIds.includes(id))
              : [...new Set([...draft.selected, ...visibleIds])].slice(0, maxInitialMembers);
            return (
              <button type="button" className="section-action"
                onClick={() => onChange({ ...draft, selected: next })}>
                {allOn ? "取消全选" : "全选"}
              </button>
            );
          })()}
        </div>
        {accepted.length > 0 && <ListSearchInput value={q} onChange={setQ} placeholder="搜索好友" />}
        {visible.length === 0 && (
          <div className="empty">{isSearching(q) ? "没有匹配的好友" : "还没有好友，先去通讯录添加吧"}</div>
        )}
        <div className="modal-list">
          {visible.map((f) => {
            const on = draft.selected.includes(f.user_id);
            return (
              <CheckRow key={f.user_id} selected={on} url={f.avatar_url} label={friendLabel(f)} seed={f.user_id}
                onClick={() => onChange({
                  ...draft,
                  selected: on ? draft.selected.filter((x) => x !== f.user_id) : [...draft.selected, f.user_id],
                })} />
            );
          })}
        </div>
        <div className="modal-actions">
          <button className="link" onClick={onCancel}>取消</button>
          <button className="mini-btn" disabled={busy} onClick={onCreate}>创建</button>
        </div>
    </Modal>
  );
}
