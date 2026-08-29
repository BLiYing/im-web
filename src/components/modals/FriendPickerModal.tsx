import { useMemo, useState } from "react";
import type { FriendEntry } from "../../sdk/protocol";
import { filterByQuery } from "../../listSearch";
import { ListSearchInput, isSearching } from "../ListSearchInput";
import { Modal } from "../Modal";
import { CheckRow } from "../rows";

/**
 * **通用好友多选弹窗**：群邀请成员 / 分享个人名片共用（镜像 iOS IMGroupMemberPickerViewController 的多用途）。
 * 原名 InviteMembersModal——只有标题 / 按钮 / 空态三处是群语境的硬编码文案，提成 prop 后即可复用，
 * 不必新建一个 ContactPickerModal（两份必然漂移，尤其是下面那条"先勾选再搜索"的坑）。
 */
export function FriendPickerModal({
  selected, candidates, friendLabel, onToggle, onInvite, onCancel,
  title = "邀请成员", confirmLabel = "邀请", emptyText = "好友都已在群里了", maxSelection = 0,
}: {
  selected: string[];
  candidates: FriendEntry[]; // 群场景=已排除在群内的好友；名片场景=全部好友
  friendLabel: (f: FriendEntry) => string;
  onToggle: (userId: string) => void;
  onInvite: () => void;
  onCancel: () => void;
  title?: string;
  confirmLabel?: string;
  emptyText?: string;
  /** 最多可选人数；**0 = 不限**（默认，群邀请场景）。分享名片传 9，与转发选择页多选上限一致。 */
  maxSelection?: number;
}) {
  const [q, setQ] = useState("");
  // 可见行按显示名（含好友备注）与 uid 匹配；选中集 selected 存的是 uid、与过滤无关，
  // 先勾选再搜索把人过滤掉，点「邀请」时仍会带上他。
  const visible = useMemo(() => filterByQuery(candidates, q, (f) => [friendLabel(f), f.user_id]),
    [candidates, q, friendLabel]);

  return (
    <Modal onClose={onCancel}>
        <h3>{title}</h3>
        {candidates.length > 0 && <ListSearchInput value={q} onChange={setQ} placeholder="搜索好友" />}
        {visible.length === 0 && (
          <div className="empty">{isSearching(q) ? "没有匹配的好友" : emptyText}</div>
        )}
        <div className="modal-list">
          {visible.map((f) => {
            const on = selected.includes(f.user_id);
            // 达上限后**未选中**行置灰不可点（已选中的仍可点=取消，否则用户卡死在满选态）。
            const atCap = maxSelection > 0 && selected.length >= maxSelection && !on;
            return (
              <CheckRow key={f.user_id} selected={on} url={f.avatar_url}
                label={friendLabel(f)} seed={f.user_id}
                onClick={atCap ? () => {} : () => onToggle(f.user_id)}
                style={atCap ? { opacity: 0.4, cursor: "not-allowed" } : undefined} />
            );
          })}
        </div>
        <div className="modal-actions">
          <button className="link" onClick={onCancel}>取消</button>
          <button className="mini-btn" disabled={selected.length === 0} onClick={onInvite}>
            {confirmLabel}{selected.length > 0
              ? `（${selected.length}${maxSelection > 0 ? `/${maxSelection}` : ""}）` : ""}
          </button>
        </div>
    </Modal>
  );
}
