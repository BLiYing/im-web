import { PinOff } from "lucide-react";
import type { PinnedMessage } from "../../sdk/protocol";
import { pinnedPreview, pinnedSenderLabel } from "../../pinned";
import { formatTime } from "../../time";
import { Modal } from "../Modal";

/** 全部置顶消息（G0）：横幅右侧 ☰ 打开。点行跳转；有权限者可就地取消置顶。 */
export function PinnedListModal({ pinned, isGroupChat, timeFormat, canPin, onJump, onUnpin, onClose }: {
  pinned: PinnedMessage[];
  isGroupChat: boolean;
  timeFormat: "12" | "24";
  canPin: boolean;
  onJump: (convSeq: number) => void;
  onUnpin: (convSeq: number) => void;
  onClose: () => void;
}) {
  return (
    <Modal className="modal pinned-modal" onClose={onClose}>
        <div className="modal-title">置顶消息（{pinned.length}）</div>
        <div className="pinned-list">
          {pinned.map((pm) => (
            <div className="pinned-row" key={pm.convSeq}>
              <button className="pinned-row-main"
                onClick={() => { onClose(); onJump(pm.convSeq); }}>
                <span className="pinned-row-from">{pinnedSenderLabel(pm, isGroupChat) || formatTime(pm.timestamp, timeFormat)}</span>
                <span className="pinned-row-text">{pinnedPreview(pm)}</span>
              </button>
              {canPin && (
                <button className="icon-btn" title="取消置顶"
                  onClick={() => onUnpin(pm.convSeq)}><PinOff size={16} /></button>
              )}
            </div>
          ))}
        </div>
        <button className="modal-close" onClick={onClose}>关闭</button>
    </Modal>
  );
}
