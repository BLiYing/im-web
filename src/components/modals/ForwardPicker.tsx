import { useMemo, useState } from "react";
import { Check } from "lucide-react";
import { SYSTEM_UID, type Conversation } from "../../sdk/protocol";
import { Avatar } from "../Avatar";
import { ListSearchInput, isSearching } from "../ListSearchInput";
import { filterByQuery } from "../../listSearch";
import { Modal } from "../Modal";

/** 转发会话选择器（M4-3）：默认单选点一下即发；「多选」切换成勾选态，底部「发送(N)」批量转发（上限 9，对齐 iOS）。
 *  纯展示：会话列表与显示名/头像解析、动作全部由 App 注入。
 *  例外是搜索词：纯 UI 局部状态（关窗即弃），没有跨组件消费者，不必上提到 App。 */
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
  const [q, setQ] = useState("");
  // 可转发目标 = 会话全集减去「系统通知」单聊：那是只读会话，服务端直接拒 send_msg to=system
  // （护栏见 IMServer/docs/design/SYSTEM_NOTICE_SESSION_DESIGN.md §2.2），列出来只会点了报错。
  // **过滤放在这一层**：转发消息 / 收藏转发 / 推荐名片三个入口都汇到本组件，一处挡住即可。
  const selectable = useMemo(
    () => conversations.filter((c) => c.is_group || c.peer !== SYSTEM_UID),
    [conversations]);
  // 可见行 = 按显示名（会话备注 > 好友备注 > 昵称 > 群名）与单聊对端 uid 子串匹配。
  // 备注参与匹配是安全的：本选择器只在本机显示，转发出去的是消息本身、不含任何名字。
  const visible = useMemo(
    () => filterByQuery(selectable, q, (c) => [convDisplayLabel(c), c.peer]),
    [q, selectable, convDisplayLabel]);

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
        <ListSearchInput value={q} onChange={setQ} placeholder="搜索会话" />
        <div className="fwd-list">
          {visible.length === 0 && <div className="fwd-empty">{isSearching(q) ? "无匹配会话" : "暂无会话"}</div>}
          {visible.map((c) => {
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
              // 刻意遍历 selectable（可转发全集）而非 visible：先勾选、再输入搜索词把它过滤掉的会话
              // 仍在 targets 里，按 visible 取就会静默少发一个人。
              onClick={() => onForward(selectable.filter((c) => targets.includes(c.conv_id)))}>
              发送{targets.length > 0 ? `(${targets.length})` : ""}
            </button>
          </div>
        ) : (
          <button className="modal-close" onClick={onClose}>取消</button>
        )}
    </Modal>
  );
}
