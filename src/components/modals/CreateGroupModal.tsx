import { Check } from "lucide-react";
import type { FriendEntry } from "../../sdk/protocol";
import { Avatar } from "../Avatar";

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
  return (
    <div className="modal-mask" onClick={onCancel}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>创建群聊</h3>
        <label>群名<input value={draft.name} maxLength={30} placeholder="1~30 字" autoFocus
          onChange={(e) => onChange({ ...draft, name: e.target.value })} /></label>
        <div className="section-label with-action">
          <span>选择好友（已选 {draft.selected.length}）</span>
          {accepted.length > 0 && (() => {
            // 可选好友上限 = maxInitialMembers（群主占 1 席）；全选时截断到上限。
            const selectable = accepted.slice(0, maxInitialMembers).map((f) => f.user_id);
            const allOn = selectable.length > 0 && selectable.every((id) => draft.selected.includes(id));
            return (
              <button type="button" className="section-action"
                onClick={() => onChange({ ...draft, selected: allOn ? [] : selectable })}>
                {allOn ? "取消全选" : "全选"}
              </button>
            );
          })()}
        </div>
        {accepted.length === 0 && <div className="empty">还没有好友，先去通讯录添加吧</div>}
        <div className="modal-list">
          {accepted.map((f) => {
            const on = draft.selected.includes(f.user_id);
            return (
              <button key={f.user_id} className="check-row"
                onClick={() => onChange({
                  ...draft,
                  selected: on ? draft.selected.filter((x) => x !== f.user_id) : [...draft.selected, f.user_id],
                })}>
                <span className={`checkbox${on ? " on" : ""}`}>{on && <Check size={13} />}</span>
                <Avatar url={f.avatar_url} label={friendLabel(f)} seed={f.user_id} />
                <span className="row-label">{friendLabel(f)}</span>
              </button>
            );
          })}
        </div>
        <div className="modal-actions">
          <button className="link" onClick={onCancel}>取消</button>
          <button className="mini-btn" disabled={busy} onClick={onCreate}>创建</button>
        </div>
      </div>
    </div>
  );
}
