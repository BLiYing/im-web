import type { ChatMessage } from "../../sdk/protocol";
import type { DownloadState } from "../../download";
import { formatFileSize } from "../../fileMetadata";
import { videoFrameSrc } from "../../messageContent";
import { mediaIdentity } from "../../album";

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
    <div className="modal-mask" onClick={onClose}>
      <div className="gallery-panel" onClick={(e) => e.stopPropagation()}>
        <div className="modal-title">图片与视频</div>
        <div className="gallery-grid">
          {items.length === 0 && (
            <div className="fwd-empty">暂无图片或视频</div>
          )}
          {items.map((mm) => {
            const gate = gateOf(mm);
            const sizeText = formatFileSize(mm.fileSize);
            return (
            <div key={mediaIdentity(mm)} className="gallery-item"
                 onClick={() => { if (gate) { onGate(mm); return; } onOpen(mm); }}
                 onContextMenu={(e) => { e.preventDefault(); onMenu(e, mm); }}
                 title={gate ? (sizeText ? `${sizeText} · 点击下载` : "点击下载") : undefined}>
              {gate
                ? (mm.thumb ? <img className="gate-blur" src={mm.thumb} alt="未下载" /> : <span className="gate-empty" />)
                : (mm.contentType === "video"
                    ? (mm.posterUrl ? <img src={mm.posterUrl} alt="" onError={() => onMediaError(mm)} /> : <video src={videoFrameSrc(mm.content)} preload="metadata" muted onError={() => onMediaError(mm)} />)
                    : <img src={mm.content} alt="" onError={() => onMediaError(mm)} />)}
              {gate
                ? (gate.phase === "expired" ? <span className="play-badge expired" title="已失效">⊘</span> : <span className="detail-media-dl">↓</span>)
                : mm.contentType === "video" && <span className="play-badge">▶</span>}
              {gate && gate.phase !== "expired" && sizeText && <span className="detail-media-size">{sizeText}</span>}
            </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
