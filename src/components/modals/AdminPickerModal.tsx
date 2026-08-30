import { useMemo, useState } from "react";
import type { GroupMember } from "../../sdk/protocol";
import { filterByQuery } from "../../listSearch";
import { MAX_ADMIN_BATCH, memberSubtitle } from "../../groupAdmin";
import { ListSearchInput, isSearching } from "../ListSearchInput";
import { Modal } from "../Modal";
import { CheckRow } from "../rows";

/**
 * 添加管理员弹窗：**群成员**多选（≤5），骨架与 FriendPickerModal 同族（Modal + ListSearchInput + CheckRow）。
 * 不复用那一个是因为候选类型不同——它吃 FriendEntry（我的好友），而管理员候选是群成员（可能不是我的好友）。
 * 上限 5 的原因见 groupAdmin.ts MAX_ADMIN_BATCH（每人一条系统消息，且后端无批量接口）。
 */
export function AdminPickerModal({ candidates, selected, memberLabel, onToggle, onConfirm, onCancel }: {
  candidates: GroupMember[];
  selected: string[];
  /** 本机显示名（备注 > 群昵称 > 昵称）。备注只在本机渲染，发出去的字节只有 uid。 */
  memberLabel: (m: GroupMember) => string;
  onToggle: (userId: string) => void;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const [q, setQ] = useState("");
  // 匹配口径 = 显示名 + @句柄，**不含 user_id**：10 位随机内部 ID 既记不住也不该被搜，
  // 收它只会把搜索框变成 ID 探测器（设计 §1.3）。
  const visible = useMemo(
    () => filterByQuery(candidates, q, (m) => [memberLabel(m), m.username, m.group_nickname]),
    [candidates, q, memberLabel]);

  return (
    <Modal onClose={onCancel}>
      <h3>添加管理员</h3>
      {candidates.length > 0 && <ListSearchInput value={q} onChange={setQ} placeholder="搜索群成员" />}
      {visible.length === 0 && (
        <div className="empty">{isSearching(q) ? "没有匹配的成员" : "群里还没有其他成员"}</div>
      )}
      <div className="modal-list">
        {visible.map((m) => {
          const on = selected.includes(m.user_id);
          // 达上限后**未选中**行置灰不可点（已选中的仍可点=取消，否则用户卡死在满选态）。
          const atCap = selected.length >= MAX_ADMIN_BATCH && !on;
          const sub = memberSubtitle(m);
          return (
            <CheckRow key={m.user_id} selected={on} url={m.avatar_url} seed={m.user_id}
              label={sub ? `${memberLabel(m)}  ${sub}` : memberLabel(m)}
              onClick={atCap ? () => {} : () => onToggle(m.user_id)}
              style={atCap ? { opacity: 0.4, cursor: "not-allowed" } : undefined} />
          );
        })}
      </div>
      {selected.length >= MAX_ADMIN_BATCH && (
        <div className="detail-foot-note">一次最多添加 {MAX_ADMIN_BATCH} 位管理员。</div>
      )}
      <div className="modal-actions">
        <button className="link" onClick={onCancel}>取消</button>
        <button className="mini-btn" disabled={selected.length === 0} onClick={onConfirm}>
          添加{selected.length > 0 ? `（${selected.length}/${MAX_ADMIN_BATCH}）` : ""}
        </button>
      </div>
    </Modal>
  );
}
