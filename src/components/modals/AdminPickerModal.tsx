import { useMemo, useState } from "react";
import type { GroupMember } from "../../sdk/protocol";
import { filterByQuery } from "../../listSearch";
import { MAX_ADMIN_BATCH, memberSubtitle } from "../../groupAdmin";
import { ListSearchInput, isSearching } from "../ListSearchInput";
import { Modal } from "../Modal";
import { CheckRow } from "../rows";
import { useT } from "../../i18n";

/**
 * 添加管理员弹窗：**群成员**多选（≤5），骨架与 FriendPickerModal 同族（Modal + ListSearchInput + CheckRow）。
 * 不复用那一个是因为候选类型不同——它吃 FriendEntry（我的好友），而管理员候选是群成员（可能不是我的好友）。
 * 上限 5 的原因见 groupAdmin.ts MAX_ADMIN_BATCH（每人一条系统消息，且后端无批量接口）。
 */
export function AdminPickerModal({ candidates, selected, memberLabel, onToggle, onConfirm, onCancel, remote }: {
  candidates: GroupMember[];
  selected: string[];
  /** 本机显示名（备注 > 群昵称 > 昵称）。备注只在本机渲染，发出去的字节只有 uid。 */
  memberLabel: (m: GroupMember) => string;
  onToggle: (userId: string) => void;
  onConfirm: () => void;
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
  // 匹配口径 = 显示名 + @句柄，**不含 user_id**：10 位随机内部 ID 既记不住也不该被搜，
  // 收它只会把搜索框变成 ID 探测器（设计 §1.3）。
  // 远端模式下服务端已按 q 过滤过，再本地过一遍会**二次收窄**。
  const visible = useMemo(
    () => (remote ? candidates
                  : filterByQuery(candidates, q, (m) => [memberLabel(m), m.username, m.group_nickname])),
    [candidates, q, memberLabel, remote]);

  return (
    <Modal onClose={onCancel}>
      <h3>{tr("group.admin_picker.title")}</h3>
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
        <div className="detail-foot-note">{tr("group.admin_picker.limit_note", { max: MAX_ADMIN_BATCH })}</div>
      )}
      <div className="modal-actions">
        <button className="link" onClick={onCancel}>{tr("common.cancel")}</button>
        <button className="mini-btn" disabled={selected.length === 0} onClick={onConfirm}>
          {selected.length > 0 ? tr("group.admin_picker.add_count", { selected: selected.length, max: MAX_ADMIN_BATCH }) : tr("common.add")}
        </button>
      </div>
    </Modal>
  );
}
