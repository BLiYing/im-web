// 群通话选人：群成员多选（不含自己），上限 MAX_GROUP_CALL_PICK。骨架与 AdminPickerModal 同族。
import { useMemo, useState, type ReactNode } from "react";
import type { GroupMember } from "../sdk/protocol";
import { filterByQuery } from "../listSearch";
import { ListSearchInput, isSearching } from "../components/ListSearchInput";
import { Modal } from "../components/Modal";
import { CheckRow } from "../components/rows";
import { MAX_GROUP_CALL_PICK } from "./rtcCall";

/** 候选 = 成员表去掉自己；纯函数，便于单测。 */
export function callCandidates(members: readonly GroupMember[], selfUid: string): GroupMember[] {
  return members.filter((m) => m.user_id !== selfUid);
}

/** 勾选 / 取消勾选；达上限后不再加（取消始终可以）。 */
export function togglePick(selected: readonly string[], uid: string, max = MAX_GROUP_CALL_PICK): string[] {
  if (selected.includes(uid)) return selected.filter((u) => u !== uid);
  return selected.length >= max ? [...selected] : [...selected, uid];
}

export function RtcGroupCallPicker({ members, selfUid, memberLabel, onConfirm, onCancel }: {
  members: readonly GroupMember[];
  selfUid: string;
  memberLabel: (m: GroupMember) => string;
  onConfirm: (uids: string[]) => void;
  onCancel: () => void;
}): ReactNode {
  const [q, setQ] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const candidates = useMemo(() => callCandidates(members, selfUid), [members, selfUid]);
  const visible = useMemo(
    () => filterByQuery(candidates, q, (m) => [memberLabel(m), m.username, m.group_nickname]),
    [candidates, q, memberLabel]);
  const atMax = selected.length >= MAX_GROUP_CALL_PICK;

  return (
    <Modal onClose={onCancel}>
      <h3>群通话</h3>
      {candidates.length > 0 && <ListSearchInput value={q} onChange={setQ} placeholder="搜索群成员" />}
      {visible.length === 0 && (
        <div className="empty">{isSearching(q) ? "没有匹配的成员" : "群里还没有其他成员"}</div>
      )}
      <div className="modal-list">
        {visible.map((m) => {
          const on = selected.includes(m.user_id);
          const blocked = atMax && !on;
          return (
            <CheckRow key={m.user_id} selected={on} url={m.avatar_url} seed={m.user_id} label={memberLabel(m)}
              onClick={blocked ? () => {} : () => setSelected((s) => togglePick(s, m.user_id))}
              style={blocked ? { opacity: 0.4, cursor: "not-allowed" } : undefined} />
          );
        })}
      </div>
      {atMax && <div className="detail-foot-note">一次最多邀请 {MAX_GROUP_CALL_PICK} 人。</div>}
      <div className="modal-actions">
        <button className="link" onClick={onCancel}>取消</button>
        <button className="mini-btn" disabled={selected.length === 0} onClick={() => onConfirm(selected)}>
          发起{selected.length > 0 ? `（${selected.length}/${MAX_GROUP_CALL_PICK}）` : ""}
        </button>
      </div>
    </Modal>
  );
}
