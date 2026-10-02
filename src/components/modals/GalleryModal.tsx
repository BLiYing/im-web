import type { ChatMessage } from "../../sdk/protocol";
import type { DownloadState } from "../../download";
import { msgKey } from "../../album";
import { MediaTile } from "../MediaTile";
import { useEffect, useRef } from "react";
import { Modal } from "../Modal";
import { useT } from "../../i18n";

/** 会话媒体库：蒙层 + 时间序网格；点击复用查看器（fromGallery=不再显示媒体库按钮）。
 *  与资料卡片「媒体」页签同款门控（未下载磨砂 + ↓ + 尺寸，点=就地下载；就绪进查看器；右键=文件菜单）。
 *  纯展示：门控判定与动作由 App 注入；items 为已过滤+倒序（最新在前）的可视媒体。 */
export function GalleryModal({ items, hasMore, loadingMore, onLoadMore, gateOf, onGate, onOpen, onMenu, onMediaError, onClose }: {
  items: ChatMessage[];
  /** 服务端还有更旧的（本地有缺口时由服务端分页供给）；网格滚到末尾哨兵进视野就续要。 */
  hasMore?: boolean;
  loadingMore?: boolean;
  onLoadMore?: () => void;
  gateOf: (m: ChatMessage) => DownloadState | undefined;
  onGate: (m: ChatMessage) => void; // 未下载格点击 = 就地下载
  onOpen: (m: ChatMessage) => void; // 就绪格点击 = 打开查看器
  onMenu: (e: React.MouseEvent, m: ChatMessage) => void;
  onMediaError: (m: ChatMessage) => void;
  onClose: () => void;
}) {
  const tr = useT();
  // 末尾哨兵：进视野就续要一页。jsdom / 老环境没有 IntersectionObserver 就不续（不报错）。
  const sentinel = useRef<HTMLDivElement>(null);
  const loadRef = useRef(onLoadMore);
  loadRef.current = onLoadMore;
  useEffect(() => {
    const el = sentinel.current;
    if (!hasMore || !el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver((es) => { if (es.some((e) => e.isIntersecting)) loadRef.current?.(); });
    io.observe(el);
    return () => io.disconnect();
  }, [hasMore, items.length, loadingMore]); // loadingMore 进依赖：一页回来哨兵若仍可见，重新观察会立刻再触发一次，不停滞
  return (
    <Modal className="gallery-panel" onClose={onClose}>
        <div className="modal-title">{tr("gallery.title")}</div>
        <div className="gallery-grid">
          {items.length === 0 && (
            <div className="fwd-empty">{tr("gallery.empty")}</div>
          )}
          {items.map((mm) => {
            const gate = gateOf(mm);
            return (
              <MediaTile key={msgKey(mm)} variant="gallery" m={mm} gate={gate}
                onClick={(m) => { if (gate) { onGate(m); return; } onOpen(m); }}
                onMenu={onMenu} onMediaError={onMediaError} />
            );
          })}
          {hasMore && <div ref={sentinel} className="fwd-empty" aria-hidden>{loadingMore ? "…" : ""}</div>}
        </div>
    </Modal>
  );
}
