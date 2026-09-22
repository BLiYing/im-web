import { UserPlus } from "lucide-react";
import type { GroupSummary } from "../../sdk/protocol";
import { displayNameOf } from "../../remarks";
import { Avatar } from "../Avatar";
import { Modal } from "../Modal";
import { useT } from "../../i18n";

/** 「群聊」列表弹窗（通讯录入口）：我的群 + 创建群聊。
 *
 *  副标题的群主名走 `备注 → owner_nickname → @owner_username → 未命名用户`；
 *  **绝不显示 `g.owner`**（内部 ID，见 ../IMServer/docs/design/ACCOUNT_IDENTITY_REDESIGN.md §7.5）。 */
export function GroupsModal({ groups, uid, remarks, onCreate, onOpen, onClose }: {
  groups: GroupSummary[];
  uid: string;
  remarks: Map<string, string>;
  onCreate: () => void;
  onOpen: (convId: string) => void;
  onClose: () => void;
}) {
  const tr = useT();
  return (
    <Modal onClose={onClose}>
        <h3>{tr("group.list.title", { count: groups.length })}</h3>
        <button className="mini-btn wide" onClick={onCreate}>
          <UserPlus size={16} className="menu-icon" />{tr("group.create.title")}
        </button>
        {groups.length === 0 && <div className="empty">{tr("group.list.empty")}</div>}
        <div className="modal-list">
          {groups.map((g) => (
            <div key={g.conv_id} className="convitem" onClick={() => onOpen(g.conv_id)}>
              <Avatar url={g.avatar_url} label={g.name} seed={g.conv_id} />
              <div className="convbody">
                <div className="convpeer">{g.name}</div>
                <div className="convlast">
                  {g.owner === uid ? tr("group.list.i_am_owner") : tr("group.list.owner", { name: displayNameOf(g.owner, remarks, g.owner_nickname, g.owner_username) })}
                </div>
              </div>
            </div>
          ))}
        </div>
        <div className="modal-actions">
          <button className="link" onClick={onClose}>{tr("common.close")}</button>
        </div>
    </Modal>
  );
}
