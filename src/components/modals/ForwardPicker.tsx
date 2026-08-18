import { Check } from "lucide-react";
import type { Conversation } from "../../sdk/protocol";
import { Avatar } from "../Avatar";
import { Modal } from "../Modal";

/** 转发会话选择器（M4-3）：默认单选点一下即发；「多选」切换成勾选态，底部「发送(N)」批量转发（上限 9，对齐 iOS）。
 *  纯展示：会话列表与显示名/头像解析、动作全部由 App 注入。 */
export function ForwardPicker({
  count, conversations, multi, mode, targets, convAvatarUrl, convDisplayLabel,
  onToggleMulti, onSetMode, onToggleTarget, onForward, onClose,
}: {
  count: number; // 待转发消息条数
  conversations: Conversation[];
  multi: boolean;
  mode: "each" | "merged";
  targets: string[];
  convAvatarUrl: (c: Conversation) => string | undefined;
  convDisplayLabel: (c: Conversation) => string;
  onToggleMulti: () => void;
  onSetMode: (mode: "each" | "merged") => void;
  onToggleTarget: (convId: string) => void;
  onForward: (convs: Conversation[]) => void; // 单选传 [c]；多选传选中的会话集
  onClose: () => void;
}) {
  return (
    <Modal className="modal fwd-picker" onClose={onClose}>
        <div className="modal-title fwd-title">
          <span>转发到（{count} 条）</span>
          <button className="section-action" onClick={onToggleMulti}>
            {multi ? "取消多选" : "多选"}
          </button>
        </div>
        {count > 1 && (
          <div className="fwd-mode">
            <button className={mode === "each" ? "on" : ""} onClick={() => onSetMode("each")}>逐条转发</button>
            <button className={mode === "merged" ? "on" : ""} onClick={() => onSetMode("merged")}>合并转发</button>
          </div>
        )}
        <div className="fwd-list">
          {conversations.length === 0 && <div className="fwd-empty">暂无会话</div>}
          {conversations.map((c) => {
            const on = targets.includes(c.conv_id);
            return (
              <button key={c.conv_id} className="fwd-item"
                onClick={() => multi ? onToggleTarget(c.conv_id) : onForward([c])}>
                {multi && <span className={`checkbox${on ? " on" : ""}`}>{on && <Check size={13} />}</span>}
                <Avatar url={convAvatarUrl(c)} label={convDisplayLabel(c)} seed={c.is_group ? c.conv_id : c.peer} />
                <span className="fwd-item-label">{convDisplayLabel(c)}</span>
              </button>
            );
          })}
        </div>
        {multi ? (
          <div className="fwd-actions">
            <button className="link" onClick={onClose}>取消</button>
            <button className="mini-btn" disabled={targets.length === 0}
              onClick={() => onForward(conversations.filter((c) => targets.includes(c.conv_id)))}>
              发送{targets.length > 0 ? `(${targets.length})` : ""}
            </button>
          </div>
        ) : (
          <button className="modal-close" onClick={onClose}>取消</button>
        )}
    </Modal>
  );
}
