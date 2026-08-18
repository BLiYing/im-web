import type { ChatMessage } from "../../sdk/protocol";
import type { DownloadState } from "../../download";
import { mediaIdentity } from "../../album";
import { MediaTile } from "../MediaTile";
import { Modal } from "../Modal";

/** 会话媒体库：蒙层 + 时间序网格；点击复用查看器（fromGallery=不再显示媒体库按钮）。
 *  与资料卡片「媒体」页签同款门控（未下载磨砂 + ↓ + 尺寸，点=就地下载；就绪进查看器；右键=文件菜单）。
 *  纯展示：门控判定与动作由 App 注入；items 为已过滤+倒序（最新在前）的可视媒体。 */
export function GalleryModal({ items, gateOf, onGate, onOpen, onMenu, onMediaError, onClose }: {
  items: ChatMessage[];
  gateOf: (m: ChatMessage) => DownloadState | undefined;
  onGate: (m: ChatMessage) => void; // 未下载格点击 = 就地下载
  onOpen: (m: ChatMessage) => void; // 就绪格点击 = 打开查看器
  onMenu: (e: React.MouseEvent, m: ChatMessage) => void;
  onMediaError: (m: ChatMessage) => void;
  onClose: () => void;
}) {
  return (
    <Modal className="gallery-panel" onClose={onClose}>
        <div className="modal-title">图片与视频</div>
        <div className="gallery-grid">
          {items.length === 0 && (
            <div className="fwd-empty">暂无图片或视频</div>
          )}
          {items.map((mm) => {
            const gate = gateOf(mm);
            return (
              <MediaTile key={mediaIdentity(mm)} variant="gallery" m={mm} gate={gate}
                onClick={(m) => { if (gate) { onGate(m); return; } onOpen(m); }}
                onMenu={onMenu} onMediaError={onMediaError} />
            );
          })}
        </div>
    </Modal>
  );
}
