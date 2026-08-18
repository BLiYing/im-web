import { UserPlus } from "lucide-react";
import type { GroupSummary } from "../../sdk/protocol";
import { Avatar } from "../Avatar";
import { Modal } from "../Modal";

/** 「群聊」列表弹窗（通讯录入口）：我的群 + 创建群聊。 */
export function GroupsModal({ groups, uid, onCreate, onOpen, onClose }: {
  groups: GroupSummary[];
  uid: string;
  onCreate: () => void;
  onOpen: (convId: string) => void;
  onClose: () => void;
}) {
  return (
    <Modal onClose={onClose}>
        <h3>群聊（{groups.length}）</h3>
        <button className="mini-btn wide" onClick={onCreate}>
          <UserPlus size={16} className="menu-icon" />创建群聊
        </button>
        {groups.length === 0 && <div className="empty">还没有加入任何群聊</div>}
        <div className="modal-list">
          {groups.map((g) => (
            <div key={g.conv_id} className="convitem" onClick={() => onOpen(g.conv_id)}>
              <Avatar url={g.avatar_url} label={g.name} seed={g.conv_id} />
              <div className="convbody">
                <div className="convpeer">{g.name}</div>
                <div className="convlast">{g.owner === uid ? "我是群主" : `群主 ${g.owner}`}</div>
              </div>
            </div>
          ))}
        </div>
        <div className="modal-actions">
          <button className="link" onClick={onClose}>关闭</button>
        </div>
    </Modal>
  );
}
