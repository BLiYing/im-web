import type { Favorite } from "../../sdk/protocol";
import { FileTypeIcon } from "../../FileTypeIcon";
import { fileNameFromContent, isUrlText, videoFrameSrc } from "../../messageContent";

/** 收藏列表（M4-4）：内容快照 + 删除；原消息撤回/删除后仍在。
 *  纯展示：打开查看器（图/视频）经 onOpenMedia 注入，合成消息由 App 构造。 */
export function FavoritesModal({ favorites, onOpenMedia, onRemove, onClose }: {
  favorites: Favorite[];
  onOpenMedia: (fav: Favorite, kind: "image" | "video") => void;
  onRemove: (id: number) => void;
  onClose: () => void;
}) {
  return (
    <div className="modal-mask" onClick={onClose}>
      <div className="modal fav-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-title">我的收藏（{favorites.length}）</div>
        <div className="fav-list">
          {favorites.length === 0 && <div className="fwd-empty">还没有收藏</div>}
          {favorites.map((f) => (
            <div key={f.id} className="fav-item">
              <div className="fav-content">
                {f.content_type === "image" ? (
                  <img className="fav-thumb" src={f.content} alt="图片" onClick={() => onOpenMedia(f, "image")} />
                ) : f.content_type === "video" ? (
                  <span className="fav-thumb-wrap" onClick={() => onOpenMedia(f, "video")}>
                    <video className="fav-thumb" src={videoFrameSrc(f.content)} preload="metadata" muted /><span className="play-badge">▶</span>
                  </span>
                ) : f.content_type === "file" ? (
                  <a className="msg-file" href={f.content} download={fileNameFromContent(f.content)} target="_blank" rel="noreferrer">
                    <FileTypeIcon name={f.content} size={30} />
                    <span>{fileNameFromContent(f.content)}</span>
                  </a>
                ) : isUrlText(f.content) ? (
                  <a className="msg-link" href={f.content} target="_blank" rel="noreferrer">{f.content}</a>
                ) : (
                  f.content
                )}
              </div>
              <button className="fav-del" title="删除收藏" onClick={() => onRemove(f.id)}>✕</button>
            </div>
          ))}
        </div>
        <button className="modal-close" onClick={onClose}>关闭</button>
      </div>
    </div>
  );
}
