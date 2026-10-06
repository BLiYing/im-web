import { useMemo, useState } from "react";
import { Camera } from "lucide-react";
import type { FriendEntry } from "../../sdk/protocol";
import { filterByQuery } from "../../listSearch";
import { ListSearchInput, isSearching } from "../ListSearchInput";
import { Modal } from "../Modal";
import { CheckRow } from "../rows";
import { Avatar } from "../Avatar";
import { defaultGroupName, publicNameOf, runeLength, truncateRunes, MAX_GROUP_NAME_LEN } from "../../groupName";
import { useT } from "../../i18n";

export type CreateGroupDraft = {
  name: string;
  selected: string[];
  /** 已上传的群头像 URL（选图 → 裁切 → 上传拿到），随建群请求一起发。 */
  avatarUrl?: string;
  /** 用户是否手改过群名：改过就再不用预填名覆盖（增删成员时也不覆盖）。 */
  nameEdited?: boolean;
};

/**
 * 建群弹窗**两步**（与 iOS `IMGroupCreateViewController` 对齐，见
 * docs/design/sketches/GROUP_CREATE_UX_SKETCH.html）：
 *   ① 好友多选（原样保留：搜索 / 全选按上限截断 / 群主占 1 席）→「下一步」
 *   ② 群资料：头像（可选）+ 群名（必填，预填「我、A、B」）+ 成员回显（可 ✕，不可删到 0）
 *
 * 「＋ 添加」与「上一步」是同一个动作——回到第一步，勾选就是 draft.selected，
 * 不另做一套加人 UI（那等于把搜索/全选/上限截断再抄一遍，两份迟早分叉）。
 */
export function CreateGroupModal({ draft, accepted, friendLabel, myPublicName, busy, avatarBusy, maxInitialMembers,
  onChange, onPickAvatar, onCreate, onCancel }: {
  draft: CreateGroupDraft;
  accepted: FriendEntry[];
  /** 列表/成员条上显示的名字：**认备注**（本机渲染）。 */
  friendLabel: (f: FriendEntry) => string;
  /** 我自己的**公开名**（昵称，非备注）：预填群名的第一位。 */
  myPublicName: string;
  busy: boolean;
  avatarBusy: boolean;
  maxInitialMembers: number;
  onChange: (next: CreateGroupDraft) => void;
  onPickAvatar: () => void;
  onCreate: () => void;
  onCancel: () => void;
}) {
  const tr = useT();
  const [q, setQ] = useState("");
  const [step, setStep] = useState<1 | 2>(1);
  const [hint, setHint] = useState("");
  // 可见行按显示名（含好友备注）与 uid 匹配；选中集存的是 uid、与过滤无关，
  // 先勾选再搜索把人过滤掉，点「创建」时仍会带上他。
  const visible = useMemo(() => filterByQuery(accepted, q, (f) => [friendLabel(f), f.user_id]),
    [accepted, q, friendLabel]);
  const byId = useMemo(() => new Map(accepted.map((f) => [f.user_id, f])), [accepted]);

  /** 预填群名：我打头，其余按**勾选顺序**。一律用公开名——群名会广播给全群（见 groupName.ts 文件头）。 */
  const suggestName = (selected: string[]) =>
    defaultGroupName([myPublicName, ...selected.map((id) => { const f = byId.get(id); return f ? publicNameOf(f) : id; })]);

  /** 进第二步：没手改过群名就（重新）填上默认名。「＋ 添加」回到第一步再进来同样走这里。 */
  const goStep2 = (next: CreateGroupDraft) => {
    onChange(next.nameEdited ? next : { ...next, name: suggestName(next.selected) });
    setHint("");
    setStep(2);
  };

  const removeMember = (id: string) => {
    // 不允许删到 0：与第一步「选 0 人不能下一步」同口径。让用户先删空再报错，是把错误留到最后一步。
    if (draft.selected.length <= 1) { setHint(tr("group.create.min_friends")); return; }
    const selected = draft.selected.filter((x) => x !== id);
    setHint("");
    onChange(draft.nameEdited ? { ...draft, selected } : { ...draft, selected, name: suggestName(selected) });
  };

  if (step === 2) {
    const nameEmpty = draft.name.trim().length === 0;
    return (
      <Modal className="modal create-modal" onClose={onCancel}>
        <h3 className="create-head">{tr("group.create.title")}<span className="create-step">2 / 2</span></h3>
        <div className="create-profile">
          <button className="edit-avatar sm" title={tr("group.create.set_avatar")} disabled={avatarBusy} onClick={onPickAvatar}>
            {/* 没设头像时圈里就是群名首字——建成后会话列表看到的正是这个样子。
                seed 用**固定串**而不是群名：群名每敲一个字都会换一次底色，看着像闪。
                建成后列表按 conv_id 重新播种，颜色会变一次，这是可接受的。 */}
            <Avatar url={draft.avatarUrl} label={draft.name} seed="new-group" cls="edit-avatar-inner" />
            <span className="edit-cam"><Camera size={13} /></span>
          </button>
          <label className="create-name">
            <span className="section-label">{tr("group.create.name_label")}</span>
            <input className="create-name-input" value={draft.name} autoFocus={false} placeholder={tr("group.create.name_placeholder")}
              onChange={(e) => {
                setHint("");   // 别让「至少选择一位好友」那句停在屏幕上（浏览器实测发现它会滞留）
                onChange({ ...draft, name: truncateRunes(e.target.value, MAX_GROUP_NAME_LEN), nameEdited: true });
              }} />
            <span className="field-count">{runeLength(draft.name)}/{MAX_GROUP_NAME_LEN}</span>
          </label>
        </div>
        <div className="section-label">{tr("group.create.members_summary", { count: draft.selected.length, total: draft.selected.length + 1 })}</div>
        <div className="member-chips">
          {draft.selected.map((id) => {
            const f = byId.get(id);
            const label = f ? friendLabel(f) : id;
            return (
              <span className="member-chip" key={id}>
                <Avatar url={f?.avatar_url} label={label} seed={id} cls="avatar chip-av" />
                <span className="chip-name">{label}</span>
                <button className="chip-x" title={tr("common.remove")} onClick={() => removeMember(id)}>✕</button>
              </span>
            );
          })}
          <button className="member-chip add" onClick={() => setStep(1)}>{tr("group.create.add_more")}</button>
        </div>
        {hint && <p className="create-hint">{hint}</p>}
        <div className="modal-actions">
          <button className="link" onClick={() => setStep(1)}>{tr("common.previous")}</button>
          <button className="link" onClick={onCancel}>{tr("common.cancel")}</button>
          <button className="mini-btn" disabled={busy || nameEmpty} onClick={onCreate}>{tr("common.create")}</button>
        </div>
      </Modal>
    );
  }

  // 群主占 1 席：最多选 maxInitialMembers 人；配置没拉到时 App 传回退值，故恒有上限（≤0 才不限）。
  const atCap = maxInitialMembers > 0 && draft.selected.length >= maxInitialMembers;
  return (
    <Modal onClose={onCancel}>
        <h3 className="create-head">{tr("group.create.title")}<span className="create-step">1 / 2</span></h3>
        <div className="section-label with-action">
          <span>{tr("group.create.select_friends", { count: draft.selected.length })}</span>
          {visible.length > 0 && (() => {
            // 全选只作用于**当前可见行**：搜了「张」还去勾上没显示的两百人，用户不会预期。
            // 无搜索词时 visible === accepted，行为与加搜索前一致。
            // 上限 = maxInitialMembers（群主占 1 席）：并集后截断，已选的人不会被全选清掉。
            const visibleIds = visible.map((f) => f.user_id);
            const allOn = visibleIds.every((id) => draft.selected.includes(id));
            const next = allOn
              ? draft.selected.filter((id) => !visibleIds.includes(id))
              // 已选整体保留（手点行没有上限拦截，selected 可能已超限，不能 slice 掉已选），
              // 只在剩余席位内按可见顺序补新人。
              : [...draft.selected, ...visibleIds.filter((id) => !draft.selected.includes(id))
                  .slice(0, Math.max(0, maxInitialMembers - draft.selected.length))];
            return (
              <button type="button" className="section-action"
                onClick={() => onChange({ ...draft, selected: next })}>
                {allOn ? tr("common.deselect_all") : tr("common.select_all")}
              </button>
            );
          })()}
        </div>
        {accepted.length > 0 && <ListSearchInput value={q} onChange={setQ} placeholder={tr("friend.picker.search_placeholder")} />}
        {visible.length === 0 && (
          <div className="empty">{isSearching(q) ? tr("friend.picker.no_match") : tr("group.create.no_friends")}</div>
        )}
        <div className="modal-list">
          {visible.map((f) => {
            const on = draft.selected.includes(f.user_id);
            return (
              <CheckRow key={f.user_id} selected={on} url={f.avatar_url} label={friendLabel(f)} seed={f.user_id}
                onClick={() => {
                  // 手点与全选同一个上限（已达上限只允许取消），免得点过上限到创建才被服务端拒。
                  if (!on && atCap) return;
                  onChange({
                    ...draft,
                    selected: on ? draft.selected.filter((x) => x !== f.user_id) : [...draft.selected, f.user_id],
                  });
                }} />
            );
          })}
        </div>
        {atCap && <p className="create-hint">{tr("group.create.limit_reached", { max: maxInitialMembers + 1 })}</p>}
        <div className="modal-actions">
          <button className="link" onClick={onCancel}>{tr("common.cancel")}</button>
          <button className="mini-btn" disabled={draft.selected.length === 0} onClick={() => goStep2(draft)}>{tr("common.next")}</button>
        </div>
    </Modal>
  );
}
